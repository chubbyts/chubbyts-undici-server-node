import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Response } from '@chubbyts/chubbyts-undici-server/dist/server';
import { ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';

const defaultHttpPort = 80;
const defaultHttpsPort = 443;

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
    const headers = new Headers();
    const rawHeaders = nodeRequest.rawHeaders;

    // eslint-disable-next-line functional/no-let
    for (let i = 0; i < rawHeaders.length; i += 2) {
      headers.append(rawHeaders[i], rawHeaders[i + 1]);
    }

    const body = method === 'GET' || method === 'HEAD' ? null : Readable.toWeb(nodeRequest);

    return new ServerRequest(getUrl(nodeRequest, baseUrl), {
      method,
      headers,
      body,
      duplex: 'half',
    });
  };
};

type UndiciResponseToNodeResponseEmitter = (undiciResponse: Response, nodeResponse: ServerResponse) => void;

export const createUndiciResponseToNodeResponseEmitter = (): UndiciResponseToNodeResponseEmitter => {
  return (undiciResponse: Response, nodeResponse: ServerResponse): void => {
    const headers: Record<string, string | string[]> = {};

    undiciResponse.headers.forEach((value, key) => {
      if (key === 'set-cookie') return;
      // eslint-disable-next-line functional/immutable-data
      headers[key] = value;
    });

    const setCookies = undiciResponse.headers.getSetCookie();
    if (setCookies.length > 0) {
      // eslint-disable-next-line functional/immutable-data
      headers['set-cookie'] = setCookies;
    }

    nodeResponse.writeHead(undiciResponse.status, undiciResponse.statusText, headers);

    if (!undiciResponse.body) {
      nodeResponse.end();

      return;
    }

    Readable.fromWeb(undiciResponse.body).pipe(nodeResponse);
  };
};
