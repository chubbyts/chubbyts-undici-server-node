/* eslint-disable functional/immutable-data */

import type { OutgoingHttpHeader, OutgoingHttpHeaders, ServerResponse, IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { Readable, Writable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { Response, ServerRequest } from '@chubbyts/chubbyts-undici-server/dist/server';
import {
  createNodeRequestToUndiciRequestFactory,
  createUndiciResponseToNodeResponseEmitter,
  getUrl,
} from '../../src/node.js';

const mockIncomingMessage = (
  options: {
    method?: string;
    url?: string;
    headers?: Record<string, Array<string> | string>;
    body?: Buffer | string;
    localAddress?: string;
    localPort?: number;
    encrypted?: boolean;
  } = {},
) => {
  const { method, url, headers = {}, body = null, localAddress, localPort, encrypted = false } = options;

  const stream = new Readable({
    read() {
      if (body == null) {
        this.push(null);

        return;
      }

      this.push(Buffer.isBuffer(body) ? body : String(body));
      this.push(null);
    },
  }) as IncomingMessage;

  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  stream.httpVersion = '1.1';
  stream.socket = { localAddress, localPort, encrypted } as TLSSocket;

  return stream;
};

const mockServerResponse = (
  error: Error | string | undefined = undefined,
): ServerResponse & {
  headers?: OutgoingHttpHeaders | Array<OutgoingHttpHeader>;
  chunks: Array<Buffer>;
  destroyedError: Error | null;
} => {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      if (error) {
        callback(error as Error);
      } else {
        // @ts-expect-error chunks does not exist
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      }
    },
    final(callback) {
      callback();
    },
    destroy(err, callback) {
      // @ts-expect-error destroyedError does not exist
      this.destroyedError = err;
      callback(err);
    },
  }) as ServerResponse & {
    headers?: OutgoingHttpHeaders | Array<OutgoingHttpHeader>;
    chunks: Array<Buffer>;
    destroyedError: Error | null;
  };

  stream.chunks = [];
  stream.destroyedError = null;

  stream.writeHead = (statusCode, statusMessage, headers = undefined) => {
    stream.statusCode = statusCode;
    stream.statusMessage = statusMessage ?? '';
    stream.headers = headers;

    return stream;
  };

  return stream;
};

describe('node', () => {
  describe('getUrl', () => {
    test('with base url', () => {
      const nodeRequest = mockIncomingMessage();

      expect(getUrl(nodeRequest, 'https://example.com')).toMatchInlineSnapshot('"https://example.com/"');
    });

    test('without base url, with encryption, with localAddress, with localPort', () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        localAddress: '192.168.1.5',
        localPort: 8443,
        encrypted: true,
      });

      expect(getUrl(nodeRequest)).toMatchInlineSnapshot('"https://192.168.1.5:8443/path/to/route"');
    });

    test('without base url, with encryption, with default localAddress, with default localPort', () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        localAddress: '127.0.0.1',
        localPort: 443,
        encrypted: true,
      });

      expect(getUrl(nodeRequest)).toMatchInlineSnapshot('"https://127.0.0.1/path/to/route"');
    });

    test('without base url, with encryption, without default localAddress, without default localPort', () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        encrypted: true,
      });

      expect(getUrl(nodeRequest)).toMatchInlineSnapshot('"https://127.0.0.1/path/to/route"');
    });

    test('without base url, without encryption, with localAddress, with localPort', () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        localAddress: '192.168.1.5',
        localPort: 8080,
      });

      expect(getUrl(nodeRequest)).toMatchInlineSnapshot('"http://192.168.1.5:8080/path/to/route"');
    });

    test('without base url, without encryption, with default localAddress, with default localPort', () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        localAddress: '127.0.0.1',
        localPort: 80,
      });

      expect(getUrl(nodeRequest)).toMatchInlineSnapshot('"http://127.0.0.1/path/to/route"');
    });

    test('without base url, without encryption, without default localAddress, without default localPort', () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
      });

      expect(getUrl(nodeRequest)).toMatchInlineSnapshot('"http://127.0.0.1/path/to/route"');
    });
  });

  describe('createNodeRequestToUndiciRequestFactory', () => {
    test('without method, without base url', async () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        localAddress: '192.168.1.5',
        localPort: 443,
        encrypted: true,
      });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory();

      const serverRequest = nodeRequestToUndiciRequestFactory(nodeRequest);

      expect(serverRequest).toBeInstanceOf(ServerRequest);

      expect(serverRequest.method).toBe('GET');
      expect(serverRequest.url).toMatchInlineSnapshot('"https://192.168.1.5/path/to/route"');
      expect([...serverRequest.headers.entries()]).toMatchInlineSnapshot('[]');
      expect(serverRequest.body).toBeNull();
    });

    test('with method, with base url', async () => {
      const body = [
        '--WebKitFormBoundary7MA4YWxkTrZu0gW',
        'Content-Disposition: form-data; name="textField"',
        '',
        'example text',
        '--WebKitFormBoundary7MA4YWxkTrZu0gW',
        'Content-Disposition: form-data; name="fileField"; filename="red.png"',
        'Content-Type: image/png',
        'Content-Transfer-Encoding: base64',
        '',
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z/C/HwAF/gJ+QqzUAAAAAElFTkSuQmCC',
        '--WebKitFormBoundary7MA4YWxkTrZu0gW--',
      ].join('\r\n');

      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=WebKitFormBoundary7MA4YWxkTrZu0gW',
          'x-custom': ['value1', 'value2'],
        },
        body,
      });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

      const serverRequest = nodeRequestToUndiciRequestFactory(nodeRequest);

      expect(serverRequest).toBeInstanceOf(ServerRequest);

      expect(serverRequest.method).toBe('POST');
      expect(serverRequest.url).toMatchInlineSnapshot('"https://example.com/path/to/route"');
      expect([...serverRequest.headers.entries()]).toMatchInlineSnapshot(`
        [
          [
            "content-type",
            "multipart/form-data; boundary=WebKitFormBoundary7MA4YWxkTrZu0gW",
          ],
          [
            "x-custom",
            "value1, value2",
          ],
        ]
      `);
      expect(serverRequest.body).not.toBeNull();

      const formData = await serverRequest.formData();

      expect(formData.has('textField')).toBe(true);

      const textField = formData.get('textField');

      expect(typeof textField).toBe('string');

      expect(formData.has('fileField')).toBe(true);

      const fileField = formData.get('fileField');

      expect(fileField).toBeInstanceOf(File);

      expect((fileField as File).name).toBe('red.png');
      expect((fileField as File).size).toBe(69);
    });
  });

  describe('createUndiciResponseToNodeResponseEmitter', () => {
    test('without body', async () => {
      const nodeResponse = mockServerResponse();

      const undiciResponse = new Response(null, {
        status: 201,
        statusText: 'Created',
        headers: [
          ['x-custom', 'some-value1'],
          ['x-custom', 'some-value2'],
          ['set-cookie', 'sessionId=abc123; Path=/; HttpOnly; Secure; SameSite=Lax'],
          ['set-cookie', 'ui_lang=en-US; Path=/; Max-Age=31536000; SameSite=Lax'],
        ],
      });

      const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter();

      undiciResponseToNodeResponseEmitter(undiciResponse, nodeResponse);

      expect(nodeResponse.statusCode).toBe(201);
      expect(nodeResponse.statusMessage).toBe('Created');
      expect(nodeResponse.headers).toMatchInlineSnapshot(`
        {
          "set-cookie": [
            "sessionId=abc123; Path=/; HttpOnly; Secure; SameSite=Lax",
            "ui_lang=en-US; Path=/; Max-Age=31536000; SameSite=Lax",
          ],
          "x-custom": "some-value1, some-value2",
        }
      `);
    });

    test('with body', async () => {
      const nodeResponse = mockServerResponse();

      const undiciResponse = new Response(JSON.stringify({ name: 'test' }), {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'json']],
      });

      const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter();

      undiciResponseToNodeResponseEmitter(undiciResponse, nodeResponse);

      expect(nodeResponse.statusCode).toBe(200);
      expect(nodeResponse.statusMessage).toBe('OK');
      expect(nodeResponse.headers).toMatchInlineSnapshot(`
        {
          "content-type": "json",
        }
      `);

      const body = await new Promise<string>((resolve) => {
        nodeResponse.on('finish', () => {
          resolve(Buffer.concat(nodeResponse.chunks.map((c) => Buffer.from(c))).toString('utf8'));
        });
      });

      expect(body).toMatchInlineSnapshot('"{"name":"test"}"');
    });
  });
});
