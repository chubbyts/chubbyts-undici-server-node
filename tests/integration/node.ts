import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { Handler, ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';
import { Response } from '@chubbyts/chubbyts-undici-server/dist/server';
import { createNodeRequestToUndiciRequestFactory, createUndiciResponseToNodeResponseEmitter } from '../../src/node.js';

const serverHost = process.env.SERVER_HOST as string;
const serverPort = parseInt(process.env.SERVER_PORT as string);

const shutdownServer = (server: Server) => {
  server.close((err) => {
    if (err) {
      console.warn(`Shutdown server with error: ${err}`);
      process.exit(1);
    }

    console.log('Shutdown server');
    process.exit(0);
  });
};

const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

const handler: Handler = async (serverRequest: ServerRequest): Promise<Response> => {
  const headers = Object.fromEntries(serverRequest.headers.entries());

  const { host: _, ...otherHeaders } = headers;

  return new Response(
    JSON.stringify({
      method: serverRequest.method,
      url: serverRequest.url,
      headers: otherHeaders,
      body: await serverRequest.text(),
    }),
    {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' },
    },
  );
};

const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter();

const server = createServer(async (req, res) => {
  const serverRequest = nodeRequestToUndiciRequestFactory(req);
  const response = await handler(serverRequest);
  undiciResponseToNodeResponseEmitter(response, res);
});

server.listen(serverPort, serverHost, () => {
  console.log(`Listening to ${serverHost}:${serverPort}`);
});

process.on('SIGINT', () => shutdownServer(server));
process.on('SIGTERM', () => shutdownServer(server));
