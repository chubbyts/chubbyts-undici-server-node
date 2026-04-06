import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Response } from '@chubbyts/chubbyts-undici-server/dist/server';
import { ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';

const defaultHttpPort = 80;
const defaultHttpsPort = 443;

const nodeRequestToUndiciHeadersInit = (nodeRequest: IncomingMessage): [string, string][] => {
  const headers: [string, string][] = [];
  const { rawHeaders } = nodeRequest;

  // eslint-disable-next-line functional/no-let
  for (let i = 0; i < rawHeaders.length; i += 2) {
    // eslint-disable-next-line functional/immutable-data
    headers.push([rawHeaders[i], rawHeaders[i + 1]]);
  }

  return headers;
};

const undiciResponseToNodeHeaders = (undiciResponse: Response): Record<string, string | string[]> => {
  const headers: Record<string, string | string[]> = {};
  const setCookies: string[] = [];

  for (const [key, value] of undiciResponse.headers.entries()) {
    if (key === 'set-cookie') {
      // eslint-disable-next-line functional/immutable-data
      setCookies.push(value);
    } else {
      // eslint-disable-next-line functional/immutable-data
      headers[key] = value;
    }
  }

  if (setCookies.length > 0) {
    // eslint-disable-next-line functional/immutable-data
    headers['set-cookie'] = setCookies;
  }

  return headers;
};

export const getUrl = (nodeRequest: IncomingMessage, baseUrl: string | undefined = undefined): string => {
  const path = nodeRequest.url ?? '/';

  if (baseUrl) {
    return baseUrl + path;
  }

  const { socket } = nodeRequest;
  const encrypted = 'encrypted' in socket && socket.encrypted === true;
  const schema = encrypted ? 'https' : 'http';
  const address = socket.localAddress ?? '127.0.0.1';
  const port = socket.localPort ?? (encrypted ? defaultHttpsPort : defaultHttpPort);
  const isDefaultPort = encrypted ? port === defaultHttpsPort : port === defaultHttpPort;

  return isDefaultPort ? `${schema}://${address}${path}` : `${schema}://${address}:${port}${path}`;
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

    Readable.fromWeb(undiciResponse.body).pipe(nodeResponse);
  };
};
