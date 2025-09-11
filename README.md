# chubbyts-undici-server-node

[![CI](https://github.com/chubbyts/chubbyts-undici-server-node/workflows/CI/badge.svg?branch=master)](https://github.com/chubbyts/chubbyts-undici-server-node/actions?query=workflow%3ACI)
[![Coverage Status](https://coveralls.io/repos/github/chubbyts/chubbyts-undici-server-node/badge.svg?branch=master)](https://coveralls.io/github/chubbyts/chubbyts-undici-server-node?branch=master)
[![Mutation testing badge](https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Fchubbyts%2Fchubbyts-undici-server-node%2Fmaster)](https://dashboard.stryker-mutator.io/reports/github.com/chubbyts/chubbyts-undici-server-node/master)
[![npm-version](https://img.shields.io/npm/v/@chubbyts/chubbyts-undici-server-node.svg)](https://www.npmjs.com/package/@chubbyts/chubbyts-undici-server-node)

[![bugs](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=bugs)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)
[![code_smells](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=code_smells)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)
[![coverage](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=coverage)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)
[![duplicated_lines_density](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=duplicated_lines_density)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)
[![ncloc](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=ncloc)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)
[![sqale_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=sqale_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)
[![alert_status](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=alert_status)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)
[![reliability_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=reliability_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)
[![security_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=security_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)
[![sqale_index](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=sqale_index)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)
[![vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-undici-server-node&metric=vulnerabilities)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-undici-server-node)

## Description

Use @chubbyts/chubbyts-undici-server on node.js.

## Requirements

 * node: 20
 * [@chubbyts/chubbyts-undici-server][2]: ^1.0.0

## Installation

Through [NPM](https://www.npmjs.com) as [@chubbyts/chubbyts-undici-server-node][1].

```sh
npm i @chubbyts/chubbyts-undici-server-node@^1.0.0
```

## Usage

```ts
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { Handler, ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';
import { Response } from '@chubbyts/chubbyts-undici-server/dist/server';
import {
  createNodeRequestToUndiciRequestFactory,
  createUndiciResponseToNodeResponseEmitter,
} from '@chubbyts/chubbyts-undici-server-node/dist/node';

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
  return new Response(
    JSON.stringify({
      method: serverRequest.method,
      url: serverRequest.url,
      headers: Object.fromEntries(serverRequest.headers.entries()),
      body: await serverRequest.json(),
    }),
    {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
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
```

## Copyright

2025 Dominik Zogg

[1]: https://www.npmjs.com/package/@chubbyts/chubbyts-undici-server-node
[2]: https://www.npmjs.com/package/@chubbyts/chubbyts-undici-server
