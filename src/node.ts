import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable, pipeline } from 'node:stream';
import type { Response } from '@chubbyts/chubbyts-undici-server/dist/server';
import { ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';

const defaultHttpPort = 80;
const defaultHttpsPort = 443;

// credentials are singleton fields (RFC 9110 5.5): duplicates cannot be combined, undici's
// Headers would join them with ', ' which confuses downstream auth parsing
const singletonHeaderNames = new Set(['authorization', 'proxy-authorization']);

const nodeRequestToUndiciHeadersInit = (nodeRequest: IncomingMessage): [string, string][] => {
  const headers: [string, string][] = [];
  const seenSingletonHeaderNames = new Set<string>();
  const cookies: string[] = [];
  const { rawHeaders } = nodeRequest;

  // oxlint-disable-next-line functional/no-let
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    const value = rawHeaders[i + 1];

    if (singletonHeaderNames.has(name)) {
      if (seenSingletonHeaderNames.has(name)) {
        throw new Error(`Request contains multiple "${name}" headers`);
      }

      seenSingletonHeaderNames.add(name);
    }

    // cookie pairs get combined with '; ' (RFC 9113 8.2.3) instead of the ', ' undici's Headers
    // would use: ',' is not a valid cookie separator and would corrupt the adjacent pairs
    if (name === 'cookie') {
      // oxlint-disable-next-line functional/immutable-data
      cookies.push(value);
      continue;
    }

    // oxlint-disable-next-line functional/immutable-data
    headers.push([rawHeaders[i], value]);
  }

  if (cookies.length > 0) {
    // oxlint-disable-next-line functional/immutable-data
    headers.push(['cookie', cookies.join('; ')]);
  }

  return headers;
};

const undiciResponseToNodeHeaders = (undiciResponse: Response): Record<string, string | string[]> => {
  const headers: Record<string, string | string[]> = {};
  const setCookies: string[] = [];

  for (const [key, value] of undiciResponse.headers.entries()) {
    if (key === 'set-cookie') {
      // oxlint-disable-next-line functional/immutable-data
      setCookies.push(value);
    } else {
      // oxlint-disable-next-line functional/immutable-data
      headers[key] = value;
    }
  }

  if (setCookies.length > 0) {
    // oxlint-disable-next-line functional/immutable-data
    headers['set-cookie'] = setCookies;
  }

  return headers;
};

const resolveUrl = (path: string, base: string): string => {
  const parsedBase = new URL(base);
  const url = new URL(parsedBase.pathname.replace(/\/$/, '') + path, parsedBase.origin);

  // protocol-relative ('//evil.com/path') and backslash ('/\evil.com/path') targets resolve
  // to a different host than the base url and must not be trusted
  if (url.origin !== parsedBase.origin) {
    throw new Error(
      `Request target "${path}" resolves to origin "${url.origin}" instead of the expected origin "${parsedBase.origin}"`,
    );
  }

  return url.toString();
};

export const getUrl = (nodeRequest: IncomingMessage, baseUrl: string | undefined = undefined): string => {
  const path = nodeRequest.url ?? '/';

  // only origin-form request targets can be safely appended after a host: absolute-form
  // ('http://evil.com/path'), authority-form and asterisk-form targets would end up within
  // the authority part of the built url and allow host spoofing
  if (!path.startsWith('/')) {
    throw new Error(`Unsupported request target "${path}": only origin-form (starting with "/") is supported`);
  }

  if (baseUrl) {
    return resolveUrl(path, baseUrl);
  }

  const { socket } = nodeRequest;
  const encrypted = 'encrypted' in socket && socket.encrypted === true;
  const schema = encrypted ? 'https' : 'http';
  const address = socket.localAddress ?? '127.0.0.1';
  const host = address.includes(':') ? `[${address}]` : address;
  const port = socket.localPort ?? (encrypted ? defaultHttpsPort : defaultHttpPort);

  return resolveUrl(path, `${schema}://${host}:${port}`);
};

type NodeRequestToUndiciRequestFactory = (nodeRequest: IncomingMessage) => ServerRequest;

export const createNodeRequestToUndiciRequestFactory = (
  baseUrl: string | undefined = undefined,
  requestBodyTimeoutMs: number | undefined = undefined,
): NodeRequestToUndiciRequestFactory => {
  return (nodeRequest: IncomingMessage): ServerRequest => {
    const { method } = nodeRequest;

    // node's parser guarantees a method for every parsed request: a missing one means the
    // IncomingMessage was not produced by the parser and must not silently be treated as GET
    if (!method) {
      throw new Error('Request method is missing');
    }

    const headers = nodeRequestToUndiciHeadersInit(nodeRequest);

    const url = getUrl(nodeRequest, baseUrl);

    if (method === 'GET' || method === 'HEAD') {
      return new ServerRequest(url, {
        method,
        headers,
      });
    }

    // a client abort / socket error must not surface as an unhandled 'error' event;
    // Readable.toWeb still propagates the error to the web stream's reader
    nodeRequest.on('error', () => {});

    // slowloris protection: a client sending the body arbitrarily slow would otherwise keep the
    // request (and its socket) alive forever, the error reaches the handler via the web stream
    if (requestBodyTimeoutMs !== undefined) {
      const timeout = setTimeout(() => {
        nodeRequest.destroy(new Error(`Request body has not been fully received within ${requestBodyTimeoutMs}ms`));
      }, requestBodyTimeoutMs);
      timeout.unref();

      nodeRequest.on('close', () => clearTimeout(timeout));
    }

    return new ServerRequest(url, {
      method,
      headers,
      body: Readable.toWeb(nodeRequest),
      duplex: 'half',
    });
  };
};

type UndiciResponseToNodeResponseEmitter = (undiciResponse: Response, nodeResponse: ServerResponse) => void;

export const createUndiciResponseToNodeResponseEmitter = (
  responseSendTimeoutMs: number | undefined = undefined,
): UndiciResponseToNodeResponseEmitter => {
  return (undiciResponse: Response, nodeResponse: ServerResponse): void => {
    const headers = undiciResponseToNodeHeaders(undiciResponse);

    // undici only rejects NUL, CR and LF within header values, node additionally rejects all other
    // control characters: writeHead can therefore throw for a successfully constructed Response
    // (same for a status outside 100-999, e.g. the 0 of Response.error()); cancel the potentially
    // connection-backed body before surfacing the error, nothing has been sent to the client yet
    try {
      nodeResponse.writeHead(undiciResponse.status, undiciResponse.statusText, headers);
    } catch (error) {
      undiciResponse.body?.cancel().catch(() => {});

      throw error;
    }

    // slowloris protection: a client reading the response arbitrarily slow (or a stalling response
    // body stream) would otherwise keep the response (and its socket) alive forever
    if (responseSendTimeoutMs !== undefined) {
      const timeout = setTimeout(() => {
        nodeResponse.destroy(new Error(`Response has not been fully sent within ${responseSendTimeoutMs}ms`));
      }, responseSendTimeoutMs);
      timeout.unref();

      nodeResponse.on('close', () => clearTimeout(timeout));
    }

    if (!undiciResponse.body) {
      nodeResponse.end();

      return;
    }

    pipeline(Readable.fromWeb(undiciResponse.body), nodeResponse, (error) => {
      if (error) {
        nodeResponse.destroy(error);
      }
    });
  };
};
