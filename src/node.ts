import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Response } from '@chubbyts/chubbyts-undici-server/dist/server';
import { ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';

const defaultHttpPort = 80;
const defaultHttpsPort = 443;

export const getUrl = (nodeRequest: IncomingMessage, baseUrl: string | undefined = undefined): string => {
  const path = nodeRequest.url ?? '/';

  if (baseUrl) {
    return `${baseUrl}${path}`;
  }

  const { socket } = nodeRequest;

  const schema = 'encrypted' in socket && socket.encrypted === true ? 'https' : 'http';
  const address = socket.localAddress ?? '127.0.0.1';
  const port = socket.localPort ?? (schema === 'https' ? defaultHttpsPort : defaultHttpPort);

  if ((schema === 'https' && port === defaultHttpsPort) || (schema === 'http' && port === defaultHttpPort)) {
    return `${schema}://${address}${path}`;
  }

  return `${schema}://${address}:${port}${path}`;
};

type NodeRequestToUndiciRequestFactory = (nodeRequest: IncomingMessage) => ServerRequest;

export const createNodeRequestToUndiciRequestFactory = (
  baseUrl: string | undefined = undefined,
): NodeRequestToUndiciRequestFactory => {
  return (nodeRequest: IncomingMessage): ServerRequest => {
    const method = nodeRequest.method ?? 'GET';

    const headers = Object.entries(nodeRequest.headers).reduce((headers, [name, value]) => {
      if (Array.isArray(value)) {
        value.forEach((valuePart) => {
          headers.append(name, valuePart);
        });
      } else if (value) {
        headers.append(name, value);
      }

      return headers;
    }, new Headers());

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
    const setCookies = undiciResponse.headers.getSetCookie();

    const headers: Record<string, Array<string>> = Object.fromEntries([
      ...Array.from(undiciResponse.headers.entries()).filter(([key]) => key.toLowerCase() !== 'set-cookie'),
      ...(setCookies.length > 0 ? [['set-cookie', setCookies]] : []),
    ]);

    nodeResponse.writeHead(undiciResponse.status, undiciResponse.statusText, headers);

    if (!undiciResponse.body) {
      nodeResponse.end();

      return;
    }

    const undiciResponseBodyStream = Readable.fromWeb(undiciResponse.body);

    undiciResponseBodyStream.pipe(nodeResponse);
  };
};
