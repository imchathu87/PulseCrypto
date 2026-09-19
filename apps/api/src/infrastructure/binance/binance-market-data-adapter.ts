import { backoffDelay } from '@pulsecrypto/contracts';
import type { Counters } from '../../application/counters.ts';
import {
  DEFAULT_BINANCE_WS_URL,
  DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS,
  DEFAULT_UPSTREAM_SILENCE_MS,
} from '../../config.ts';
import type {
  MarketDataSource,
  MarketEventSink,
  Pair,
} from '../../domain/market-event.ts';
import {
  buildStreamTable,
  normalizeFrame,
  type StreamTable,
} from './binance-frames.ts';
import {
  createWsSocket,
  type SocketFactory,
  type UpstreamSocket,
} from './upstream-socket.ts';

export interface AdapterLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface BinanceMarketDataAdapterOptions {
  readonly pairs: readonly Pair[];
  readonly binanceWsUrl?: string;
  readonly upstreamSilenceMs?: number;
  readonly upstreamConnectTimeoutMs?: number;
  readonly counters?: Counters;
  readonly createSocket?: SocketFactory;
  readonly logger?: AdapterLogger;
  readonly now?: () => number;
  readonly random?: () => number;
}

type UpstreamState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export class BinanceMarketDataAdapter implements MarketDataSource {
  readonly kind = 'binance' as const;

  private readonly pairs: readonly Pair[];
  private readonly binanceWsUrl: string;
  private readonly upstreamSilenceMs: number;
  private readonly upstreamConnectTimeoutMs: number;
  private readonly counters: Counters | undefined;
  private readonly createSocket: SocketFactory;
  private readonly logger: AdapterLogger | undefined;
  private readonly now: () => number;
  private readonly random: () => number;

  private readonly streamTable: StreamTable;
  private readonly url: string;

  private sink: MarketEventSink | null = null;
  private started = false;
  private stopped = false;
  private state: UpstreamState = 'idle';

  private generation = 0;
  private attempt = 0;
  private connectedInCurrentAttempt = false;

  private currentSocket: UpstreamSocket | null = null;
  private connectTimeoutTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private stableResetTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: BinanceMarketDataAdapterOptions) {
    const {
      pairs,
      binanceWsUrl = DEFAULT_BINANCE_WS_URL,
      upstreamSilenceMs = DEFAULT_UPSTREAM_SILENCE_MS,
      upstreamConnectTimeoutMs = DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS,
      counters,
      createSocket = createWsSocket,
      logger,
      now = Date.now,
      random = Math.random,
    } = options;

    if (pairs.length === 0) {
      throw new Error('BinanceMarketDataAdapter requires at least one pair');
    }
    const uniquePairs = new Set(pairs);
    if (uniquePairs.size !== pairs.length) {
      throw new Error('BinanceMarketDataAdapter does not allow duplicate pairs');
    }

    this.pairs = [...pairs];
    this.binanceWsUrl = binanceWsUrl;
    this.upstreamSilenceMs = upstreamSilenceMs;
    this.upstreamConnectTimeoutMs = upstreamConnectTimeoutMs;
    this.counters = counters;
    this.createSocket = createSocket;
    this.logger = logger;
    this.now = now;
    this.random = random;

    this.streamTable = buildStreamTable(this.pairs);

    const streamList: string[] = [];
    for (const pair of this.pairs) {
      const lower = pair.toLowerCase();
      streamList.push(`${lower}@depth20@100ms`, `${lower}@ticker`);
    }
    const baseUrl = this.binanceWsUrl.replace(/\/+$/, '');
    this.url = `${baseUrl}/stream?streams=${streamList.join('/')}`;
  }

  start(sink: MarketEventSink): void {
    if (this.started) {
      throw new Error('BinanceMarketDataAdapter already started');
    }
    this.started = true;
    this.sink = sink;

    this.connect();
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.generation += 1;

    this.clearAllTimers();

    if (this.currentSocket !== null) {
      this.currentSocket.terminate();
      this.currentSocket = null;
    }

    return Promise.resolve();
  }

  private connect(): void {
    if (this.stopped) return;

    this.generation += 1;
    const currentGeneration = this.generation;
    this.state = 'connecting';
    this.connectedInCurrentAttempt = false;

    const socket = this.createSocket(this.url);
    this.currentSocket = socket;

    this.connectTimeoutTimer = setTimeout(() => {
      if (this.generation !== currentGeneration || this.stopped) return;
      this.handleAttemptEnd(currentGeneration);
    }, this.upstreamConnectTimeoutMs);

    socket.on('open', () => {
      if (this.generation !== currentGeneration || this.stopped) return;

      if (this.connectTimeoutTimer !== null) {
        clearTimeout(this.connectTimeoutTimer);
        this.connectTimeoutTimer = null;
      }

      this.connectedInCurrentAttempt = true;
      this.state = 'connected';

      this.sink?.({
        kind: 'status',
        connected: true,
        at: this.now(),
      });

      this.logger?.info('Upstream connected to Binance');

      this.stableResetTimer = setTimeout(() => {
        if (this.generation !== currentGeneration || this.stopped) return;
        this.attempt = 0;
      }, 60000);

      this.resetSilenceWatchdog(currentGeneration);
    });

    socket.on('message', (text: string | null) => {
      if (this.generation !== currentGeneration || this.stopped) return;

      this.counters?.increment('upstream.frames.received');
      this.resetSilenceWatchdog(currentGeneration);

      if (text === null) {
        this.counters?.increment('upstream.frames.invalid');
        return;
      }

      const event = normalizeFrame(text, this.streamTable, this.now());
      if (event === null) {
        this.counters?.increment('upstream.frames.invalid');
        return;
      }

      this.sink?.(event);
    });

    socket.on('unexpected-response', (status: number) => {
      if (this.generation !== currentGeneration || this.stopped) return;

      if (status === 451) {
        this.logger?.warn(
          `Upstream received HTTP 451 from ${this.binanceWsUrl}. Check BINANCE_WS_URL or consider using wss://data-stream.binance.vision`,
        );
      }

      this.handleAttemptEnd(currentGeneration);
    });

    socket.on('error', () => {
      if (this.generation !== currentGeneration || this.stopped) return;
      this.handleAttemptEnd(currentGeneration);
    });

    socket.on('close', () => {
      if (this.generation !== currentGeneration || this.stopped) return;
      this.handleAttemptEnd(currentGeneration);
    });
  }

  private resetSilenceWatchdog(currentGeneration: number): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
    }
    this.silenceTimer = setTimeout(() => {
      if (this.generation !== currentGeneration || this.stopped) return;
      this.currentSocket?.terminate();
      this.handleAttemptEnd(currentGeneration);
    }, this.upstreamSilenceMs);
  }

  private handleAttemptEnd(currentGeneration: number): void {
    if (this.generation !== currentGeneration || this.stopped) return;

    this.generation += 1;
    this.clearAllTimers();

    if (this.currentSocket !== null) {
      this.currentSocket.terminate();
      this.currentSocket = null;
    }

    if (!this.connectedInCurrentAttempt) {
      this.counters?.increment('upstream.connect.failed');
    }

    const wasConnected = this.state === 'connected';
    this.state = 'disconnected';

    if (wasConnected) {
      this.sink?.({
        kind: 'status',
        connected: false,
        at: this.now(),
      });
      this.logger?.info('Upstream disconnected from Binance');
    }

    this.counters?.increment('upstream.reconnects');

    const delayMs = backoffDelay(
      this.attempt,
      { baseMs: 1000, capMs: 30000 },
      this.random,
    );
    this.attempt += 1;

    this.state = 'reconnecting';
    this.logger?.info(
      `Upstream reconnect scheduled in ${delayMs}ms (attempt ${this.attempt})`,
    );

    const reconnectGeneration = this.generation;
    this.reconnectTimer = setTimeout(() => {
      if (this.generation !== reconnectGeneration || this.stopped) return;
      this.connect();
    }, delayMs);
  }

  private clearAllTimers(): void {
    if (this.connectTimeoutTimer !== null) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.stableResetTimer !== null) {
      clearTimeout(this.stableResetTimer);
      this.stableResetTimer = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
