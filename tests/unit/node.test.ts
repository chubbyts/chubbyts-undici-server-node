/* oxlint-disable functional/immutable-data */

import type { OutgoingHttpHeader, OutgoingHttpHeaders, ServerResponse, IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { Readable, Writable } from 'node:stream';
import { describe, expect, test, vi } from 'vitest';
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
    rawHeaders?: string[];
    body?: Buffer | string;
    bodyDelayMs?: number;
    error?: Error;
    stall?: boolean;
    localAddress?: string;
    localPort?: number;
    encrypted?: boolean;
  } = {},
) => {
  const {
    method,
    url,
    rawHeaders = [],
    body = null,
    bodyDelayMs,
    error,
    stall = false,
    localAddress,
    localPort,
    encrypted = false,
  } = options;

  const delayedPush = { scheduled: false };

  const stream = new Readable({
    read() {
      if (error) {
        this.destroy(error);

        return;
      }

      if (stall) {
        return;
      }

      if (body == null) {
        this.push(null);

        return;
      }

      if (bodyDelayMs !== undefined) {
        if (!delayedPush.scheduled) {
          delayedPush.scheduled = true;

          setTimeout(() => {
            this.push(Buffer.isBuffer(body) ? body : String(body));
            this.push(null);
          }, bodyDelayMs);
        }

        return;
      }

      this.push(Buffer.isBuffer(body) ? body : String(body));
      this.push(null);
    },
  }) as IncomingMessage;

  stream.method = method;
  stream.url = url;
  stream.rawHeaders = rawHeaders;
  stream.httpVersion = '1.1';
  stream.socket = { localAddress, localPort, encrypted } as TLSSocket;

  return stream;
};

const mockServerResponse = (
  error: Error | string | undefined = undefined,
  writeHeadError: Error | undefined = undefined,
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
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[];
    chunks: Array<Buffer>;
    destroyedError: Error | null;
  };

  stream.chunks = [];
  stream.destroyedError = null;

  stream.writeHead = (
    statusCode: number,
    statusMessageOrHeaders?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ) => {
    if (writeHeadError) {
      throw writeHeadError;
    }

    stream.statusCode = statusCode;

    if (typeof statusMessageOrHeaders === 'string') {
      stream.statusMessage = statusMessageOrHeaders;
      stream.headers = headers;
    } else {
      stream.statusMessage = '';
      stream.headers = statusMessageOrHeaders;
    }

    return stream;
  };

  return stream;
};

const trackDestroyErrors = (stream: IncomingMessage | ServerResponse): Array<Error> => {
  const destroyErrors: Array<Error> = [];
  const originalDestroy = stream.destroy.bind(stream);

  stream.destroy = ((error?: Error) => {
    if (error) {
      destroyErrors.push(error);
    }

    return originalDestroy(error);
  }) as typeof stream.destroy;

  return destroyErrors;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('node', () => {
  describe('getUrl', () => {
    test('with base url', () => {
      const nodeRequest = mockIncomingMessage();

      expect(getUrl(nodeRequest, 'https://example.com')).toMatchInlineSnapshot('"https://example.com/"');
    });

    test('with base url, with trailing slash', () => {
      const nodeRequest = mockIncomingMessage({ url: '/path/to/route' });

      expect(getUrl(nodeRequest, 'https://example.com/')).toMatchInlineSnapshot('"https://example.com/path/to/route"');
    });

    test('with base url, with path prefix', () => {
      const nodeRequest = mockIncomingMessage({ url: '/path/to/route' });

      expect(getUrl(nodeRequest, 'https://example.com/app')).toMatchInlineSnapshot(
        '"https://example.com/app/path/to/route"',
      );
    });

    test('with base url, with path prefix, with trailing slash', () => {
      const nodeRequest = mockIncomingMessage({ url: '/path/to/route' });

      expect(getUrl(nodeRequest, 'https://example.com/app/')).toMatchInlineSnapshot(
        '"https://example.com/app/path/to/route"',
      );
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

    test('without base url, with ipv6 localAddress', () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        localAddress: '::1',
        localPort: 8080,
      });

      expect(getUrl(nodeRequest)).toMatchInlineSnapshot('"http://[::1]:8080/path/to/route"');
    });

    test('with base url, with protocol-relative request target', () => {
      const nodeRequest = mockIncomingMessage({ url: '//evil.com/path/to/route' });

      expect(() => getUrl(nodeRequest, 'https://example.com')).toThrow(
        'Request target "//evil.com/path/to/route" resolves to origin "https://evil.com" instead of the expected origin "https://example.com"',
      );
    });

    test('with base url, with backslash protocol-relative request target', () => {
      const nodeRequest = mockIncomingMessage({ url: '/\\evil.com/path/to/route' });

      expect(() => getUrl(nodeRequest, 'https://example.com')).toThrow(
        'Request target "/\\evil.com/path/to/route" resolves to origin "https://evil.com" instead of the expected origin "https://example.com"',
      );
    });

    test('with base url, with absolute-form request target', () => {
      const nodeRequest = mockIncomingMessage({ url: 'http://evil.com/path/to/route' });

      expect(() => getUrl(nodeRequest, 'https://example.com')).toThrow(
        'Unsupported request target "http://evil.com/path/to/route": only origin-form (starting with "/") is supported',
      );
    });

    test('without base url, with authority-form request target', () => {
      const nodeRequest = mockIncomingMessage({ url: 'evil.com:443' });

      expect(() => getUrl(nodeRequest)).toThrow(
        'Unsupported request target "evil.com:443": only origin-form (starting with "/") is supported',
      );
    });

    test('without base url, with asterisk-form request target', () => {
      const nodeRequest = mockIncomingMessage({ url: '*' });

      expect(() => getUrl(nodeRequest)).toThrow(
        'Unsupported request target "*": only origin-form (starting with "/") is supported',
      );
    });
  });

  describe('createNodeRequestToUndiciRequestFactory', () => {
    test('without method', async () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
      });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory();

      expect(() => nodeRequestToUndiciRequestFactory(nodeRequest)).toThrow('Request method is missing');
    });

    test('with method, without base url', async () => {
      const nodeRequest = mockIncomingMessage({
        method: 'GET',
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
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        method: 'HEAD',
        rawHeaders: [
          'content-type',
          'multipart/form-data; boundary=WebKitFormBoundary7MA4YWxkTrZu0gW',
          'x-custom',
          'value1',
          'x-custom',
          'value2',
        ],
      });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

      const serverRequest = nodeRequestToUndiciRequestFactory(nodeRequest);

      expect(serverRequest).toBeInstanceOf(ServerRequest);

      expect(serverRequest.method).toBe('HEAD');
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
      expect(serverRequest.body).toBeNull();
    });

    test('with method, with base url, with body', async () => {
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
        rawHeaders: [
          'content-type',
          'multipart/form-data; boundary=WebKitFormBoundary7MA4YWxkTrZu0gW',
          'x-custom',
          'value1',
          'x-custom',
          'value2',
        ],
        body,
      });

      const destroyErrors = trackDestroyErrors(nodeRequest);

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

      const serverRequest = nodeRequestToUndiciRequestFactory(nodeRequest);

      expect(serverRequest).toBeInstanceOf(ServerRequest);

      // one listener from Readable.toWeb plus the explicit guard against unhandled 'error' events
      expect(nodeRequest.listenerCount('error')).toBe(2);

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

      // no request body timeout is configured: no timer may destroy the request afterwards
      await wait(50);

      expect(destroyErrors).toEqual([]);
    });

    test('with method, with base url, with request stream error', async () => {
      const error = new Error('client aborted');

      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        method: 'POST',
        error,
      });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

      const serverRequest = nodeRequestToUndiciRequestFactory(nodeRequest);

      await expect(serverRequest.text()).rejects.toThrow('client aborted');
    });

    test('with method, with base url, with request body timeout, with stalling request stream', async () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        method: 'POST',
        rawHeaders: ['content-type', 'text/plain'],
        stall: true,
      });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com', 50);

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const serverRequest = nodeRequestToUndiciRequestFactory(nodeRequest);

      // the timeout must not keep the process alive
      expect((setTimeoutSpy.mock.results[0].value as NodeJS.Timeout).hasRef()).toBe(false);

      setTimeoutSpy.mockRestore();

      await expect(serverRequest.text()).rejects.toThrow('Request body has not been fully received within 50ms');
    });

    test('with method, with base url, with request body timeout, with body received in time', async () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        method: 'POST',
        rawHeaders: ['content-type', 'text/plain'],
        body: 'complete',
      });

      const destroyErrors = trackDestroyErrors(nodeRequest);

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com', 100);

      const serverRequest = nodeRequestToUndiciRequestFactory(nodeRequest);

      await expect(serverRequest.text()).resolves.toBe('complete');

      // the body has been fully received: the timeout got cleared and must not destroy the request
      await wait(150);

      expect(destroyErrors).toEqual([]);
    });

    test('with method, with base url, without request body timeout, with slowly received body', async () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        method: 'POST',
        rawHeaders: ['content-type', 'text/plain'],
        body: 'delayed',
        bodyDelayMs: 50,
      });

      const destroyErrors = trackDestroyErrors(nodeRequest);

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

      const serverRequest = nodeRequestToUndiciRequestFactory(nodeRequest);

      // no request body timeout is configured: a slow body must not lead to a destroyed request
      await expect(serverRequest.text()).resolves.toBe('delayed');

      expect(destroyErrors).toEqual([]);
    });

    test('with multiple cookie headers', async () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        method: 'GET',
        rawHeaders: ['Cookie', 'sessionId=abc123', 'Cookie', 'ui_lang=en-US'],
      });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

      const serverRequest = nodeRequestToUndiciRequestFactory(nodeRequest);

      expect([...serverRequest.headers.entries()]).toMatchInlineSnapshot(`
        [
          [
            "cookie",
            "sessionId=abc123; ui_lang=en-US",
          ],
        ]
      `);
    });

    test('with single authorization header', () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        method: 'GET',
        rawHeaders: ['Authorization', 'Bearer token1'],
      });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

      const serverRequest = nodeRequestToUndiciRequestFactory(nodeRequest);

      expect([...serverRequest.headers.entries()]).toMatchInlineSnapshot(`
        [
          [
            "authorization",
            "Bearer token1",
          ],
        ]
      `);
    });

    test('with multiple authorization headers', () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        method: 'GET',
        rawHeaders: ['Authorization', 'Bearer token1', 'Authorization', 'Bearer token2'],
      });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

      expect(() => nodeRequestToUndiciRequestFactory(nodeRequest)).toThrow(
        'Request contains multiple "authorization" headers',
      );
    });

    test('with multiple proxy-authorization headers', () => {
      const nodeRequest = mockIncomingMessage({
        url: '/path/to/route',
        method: 'GET',
        rawHeaders: ['Proxy-Authorization', 'Basic dXNlcjE=', 'Proxy-Authorization', 'Basic dXNlcjI='],
      });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

      expect(() => nodeRequestToUndiciRequestFactory(nodeRequest)).toThrow(
        'Request contains multiple "proxy-authorization" headers',
      );
    });

    test('with absolute-form request target', () => {
      const nodeRequest = mockIncomingMessage({ method: 'GET', url: 'http://evil.com/path/to/route' });

      const nodeRequestToUndiciRequestFactory = createNodeRequestToUndiciRequestFactory('https://example.com');

      expect(() => nodeRequestToUndiciRequestFactory(nodeRequest)).toThrow(
        'Unsupported request target "http://evil.com/path/to/route": only origin-form (starting with "/") is supported',
      );
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

      const destroyErrors = trackDestroyErrors(nodeResponse);

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

      // no response send timeout is configured: no timer may destroy the response afterwards
      await wait(50);

      expect(destroyErrors).toEqual([]);
    });

    test('with body, without response send timeout, with slowly sent body', async () => {
      const nodeResponse = mockServerResponse();

      const destroyErrors = trackDestroyErrors(nodeResponse);

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode('delayed'));
            controller.close();
          }, 50);
        },
      });

      const undiciResponse = new Response(body, {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/plain']],
      });

      const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter();

      undiciResponseToNodeResponseEmitter(undiciResponse, nodeResponse);

      await new Promise<void>((resolve) => {
        nodeResponse.on('close', resolve);
      });

      // no response send timeout is configured: a slow body must not lead to a destroyed response
      expect(destroyErrors).toEqual([]);
      expect(Buffer.concat(nodeResponse.chunks.map((c) => Buffer.from(c))).toString('utf8')).toBe('delayed');
    });

    test('with body, with write error', async () => {
      const error = new Error('write failed');

      const nodeResponse = mockServerResponse(error);

      const undiciResponse = new Response(JSON.stringify({ name: 'test' }), {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'json']],
      });

      const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter();

      undiciResponseToNodeResponseEmitter(undiciResponse, nodeResponse);

      await new Promise<void>((resolve) => {
        nodeResponse.on('close', resolve);
      });

      expect(nodeResponse.destroyedError).toBe(error);
    });

    test('with body, with response body stream error', async () => {
      const nodeResponse = mockServerResponse();

      const error = new Error('upstream failed');

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial'));
          controller.error(error);
        },
      });

      const undiciResponse = new Response(body, {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'json']],
      });

      const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter();

      undiciResponseToNodeResponseEmitter(undiciResponse, nodeResponse);

      await new Promise<void>((resolve) => {
        nodeResponse.on('close', resolve);
      });

      expect(nodeResponse.destroyedError).toBe(error);
    });

    test('without body, with response send timeout', async () => {
      const nodeResponse = mockServerResponse();

      const undiciResponse = new Response(null, {
        status: 204,
        statusText: 'No Content',
      });

      const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter(1000);

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      undiciResponseToNodeResponseEmitter(undiciResponse, nodeResponse);

      // the timeout must not keep the process alive
      expect((setTimeoutSpy.mock.results[0].value as NodeJS.Timeout).hasRef()).toBe(false);

      setTimeoutSpy.mockRestore();

      await new Promise<void>((resolve) => {
        nodeResponse.on('close', resolve);
      });

      expect(nodeResponse.statusCode).toBe(204);
      expect(nodeResponse.destroyedError).toBeNull();
    });

    test('with body, with response send timeout, with stalling response body stream', async () => {
      const nodeResponse = mockServerResponse();

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial'));
          // stays open: never closes and never enqueues again
        },
      });

      const undiciResponse = new Response(body, {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/plain']],
      });

      const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter(50);

      undiciResponseToNodeResponseEmitter(undiciResponse, nodeResponse);

      await new Promise<void>((resolve) => {
        nodeResponse.on('close', resolve);
      });

      expect(nodeResponse.destroyedError?.message).toBe('Response has not been fully sent within 50ms');
    });

    test('with body, with response send timeout, with body sent in time', async () => {
      const nodeResponse = mockServerResponse();

      const destroyErrors = trackDestroyErrors(nodeResponse);

      const undiciResponse = new Response(JSON.stringify({ name: 'test' }), {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'json']],
      });

      const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter(100);

      undiciResponseToNodeResponseEmitter(undiciResponse, nodeResponse);

      const body = await new Promise<string>((resolve) => {
        nodeResponse.on('finish', () => {
          resolve(Buffer.concat(nodeResponse.chunks.map((c) => Buffer.from(c))).toString('utf8'));
        });
      });

      expect(body).toMatchInlineSnapshot('"{"name":"test"}"');
      expect(nodeResponse.destroyedError).toBeNull();

      // the response has been fully sent: the timeout got cleared and must not destroy the response
      await wait(150);

      expect(destroyErrors).toEqual([]);
    });

    test('without body, with writeHead error', async () => {
      const error = new TypeError('Invalid character in header content ["x-custom"]');

      const nodeResponse = mockServerResponse(undefined, error);

      const undiciResponse = new Response(null, {
        status: 200,
        statusText: 'OK',
        headers: [['x-custom', 'somevalue']],
      });

      const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter();

      expect(() => undiciResponseToNodeResponseEmitter(undiciResponse, nodeResponse)).toThrow(
        'Invalid character in header content ["x-custom"]',
      );
    });

    test('with body, with writeHead error', async () => {
      const error = new TypeError('Invalid character in header content ["x-custom"]');

      const nodeResponse = mockServerResponse(undefined, error);

      const undiciResponse = new Response(JSON.stringify({ name: 'test' }), {
        status: 200,
        statusText: 'OK',
        headers: [
          ['content-type', 'json'],
          ['x-custom', 'somevalue'],
        ],
      });

      const undiciResponseToNodeResponseEmitter = createUndiciResponseToNodeResponseEmitter();

      expect(() => undiciResponseToNodeResponseEmitter(undiciResponse, nodeResponse)).toThrow(
        'Invalid character in header content ["x-custom"]',
      );

      expect(undiciResponse.bodyUsed).toBe(true);
    });
  });
});
