import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable, pipeline } from 'node:stream';
import type { Response } from '@chubbyts/chubbyts-undici-server/dist/server';
import { ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';

const defaultHttpPort = 80;
const defaultHttpsPort = 443;

const nodeRequestToUndiciHeadersInit = (nodeRequest: IncomingMessage): [string, string][] => {
  const headers: [string, string][] = [];
  const { rawHeaders } = nodeRequest;

  // oxlint-disable-next-line functional/no-let
  for (let i = 0; i < rawHeaders.length; i += 2) {
    // oxlint-disable-next-line functional/immutable-data
    headers.push([rawHeaders[i], rawHeaders[i + 1]]);
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
): NodeRequestToUndiciRequestFactory => {
  return (nodeRequest: IncomingMessage): ServerRequest => {
    const method = nodeRequest.method ?? 'GET';
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

    return new ServerRequest(url, {
      method,
      headers,
      body: Readable.toWeb(nodeRequest),
      duplex: 'half',
    });
  };
};

type UndiciResponseToNodeResponseEmitter = (undiciResponse: Response, nodeResponse: ServerResponse) => void;

export const createUndiciResponseToNodeResponseEmitter = (): UndiciResponseToNodeResponseEmitter => {
  return (undiciResponse: Response, nodeResponse: ServerResponse): void => {
    const headers = undiciResponseToNodeHeaders(undiciResponse);

    nodeResponse.writeHead(undiciResponse.status, undiciResponse.statusText, headers);

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
