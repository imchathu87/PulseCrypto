import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createWsSocket } from './upstream-socket.ts';

describe('createWsSocket with real servers on 127.0.0.1', () => {
  const cleanupTasks: (() => Promise<void>)[] = [];

  afterEach(async () => {
    while (cleanupTasks.length > 0) {
      const cleanup = cleanupTasks.pop()!;
      await cleanup();
    }
  });

  it('connects to a local WebSocket server, receives open, text and binary messages, and terminates', async () => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    cleanupTasks.push(async () => {
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const messagesReceived: (string | null)[] = [];
    let opened = false;
    let closed = false;

    wss.on('connection', (ws) => {
      ws.send('text payload');
      ws.send(Buffer.from([0x01, 0x02, 0x03]));
    });

    const socket = createWsSocket(`ws://127.0.0.1:${port}`);
    cleanupTasks.push(async () => {
      socket.terminate();
    });

    await new Promise<void>((resolve) => {
      socket.on('open', () => {
        opened = true;
      });

      socket.on('message', (text) => {
        messagesReceived.push(text);
        if (messagesReceived.length === 2) {
          resolve();
        }
      });
    });

    expect(opened).toBe(true);
    expect(messagesReceived).toEqual(['text payload', null]);

    await new Promise<void>((resolve) => {
      socket.on('close', () => {
        closed = true;
        resolve();
      });
      socket.terminate();
    });

    expect(closed).toBe(true);
  });

  it('emits unexpected-response with HTTP 451 status code and terminates socket', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(451, { 'Content-Type': 'text/plain' });
      res.end('Unavailable For Legal Reasons');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    cleanupTasks.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const socket = createWsSocket(`ws://127.0.0.1:${port}`);
    cleanupTasks.push(async () => {
      socket.terminate();
    });

    let closed = false;
    const [status] = await Promise.all([
      new Promise<number>((resolve) => {
        socket.on('unexpected-response', (statusCode) => {
          resolve(statusCode);
        });
      }),
      new Promise<void>((resolve) => {
        socket.on('close', () => {
          closed = true;
          resolve();
        });
      }),
    ]);

    expect(status).toBe(451);
    expect(closed).toBe(true);
  });

  it('emits error on connection failure', async () => {
    // Port 1 is reserved and not listening
    const socket = createWsSocket('ws://127.0.0.1:1');
    cleanupTasks.push(async () => {
      socket.terminate();
    });

    const err = await new Promise<Error>((resolve) => {
      socket.on('error', (e) => {
        resolve(e);
      });
    });

    expect(err).toBeInstanceOf(Error);
  });
});
