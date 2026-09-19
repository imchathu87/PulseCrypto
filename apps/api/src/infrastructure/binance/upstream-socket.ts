import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

export interface UpstreamSocket {
  on(event: 'open', listener: () => void): void;
  on(event: 'message', listener: (text: string | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'unexpected-response', listener: (status: number) => void): void;
  terminate(): void;
}

export type SocketFactory = (url: string) => UpstreamSocket;

export class WsUpstreamSocket implements UpstreamSocket {
  private readonly ws: WebSocket;
  private readonly emitter = new EventEmitter();

  constructor(url: string) {
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.emitter.emit('open');
    });

    this.ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        this.emitter.emit('message', null);
      } else {
        const text = typeof data === 'string' ? data : data.toString('utf-8');
        this.emitter.emit('message', text);
      }
    });

    this.ws.on('unexpected-response', (req, res) => {
      req.destroy();
      this.ws.terminate();
      const status = res.statusCode ?? 0;
      this.emitter.emit('unexpected-response', status);
    });

    this.ws.on('error', (err: Error) => {
      if (this.emitter.listenerCount('error') > 0) {
        this.emitter.emit('error', err);
      }
    });

    this.ws.on('close', () => {
      this.emitter.emit('close');
    });
  }

  on(event: 'open', listener: () => void): void;
  on(event: 'message', listener: (text: string | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'unexpected-response', listener: (status: number) => void): void;
  on(
    event: 'open' | 'message' | 'error' | 'close' | 'unexpected-response',
    listener:
      | (() => void)
      | ((text: string | null) => void)
      | ((err: Error) => void)
      | ((status: number) => void),
  ): void {
    this.emitter.on(event, listener);
  }

  terminate(): void {
    this.ws.terminate();
  }
}

export function createWsSocket(url: string): UpstreamSocket {
  return new WsUpstreamSocket(url);
}
