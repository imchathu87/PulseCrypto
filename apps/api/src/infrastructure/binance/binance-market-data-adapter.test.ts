import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Counters } from '../../application/counters.ts';
import { DEFAULT_PAIRS } from '../../config.ts';
import type { MarketEvent } from '../../domain/market-event.ts';
import { SAMPLE_DEPTH_FRAME } from './__fixtures__/frames.ts';
import {
  type AdapterLogger,
  BinanceMarketDataAdapter,
} from './binance-market-data-adapter.ts';
import type { UpstreamSocket } from './upstream-socket.ts';

class FakeUpstreamSocket implements UpstreamSocket {
  openListeners: (() => void)[] = [];
  messageListeners: ((text: string | null) => void)[] = [];
  errorListeners: ((err: Error) => void)[] = [];
  closeListeners: (() => void)[] = [];
  unexpectedResponseListeners: ((status: number) => void)[] = [];
  terminated = false;

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
    if (event === 'open') {
      this.openListeners.push(listener as () => void);
    } else if (event === 'message') {
      this.messageListeners.push(listener as (text: string | null) => void);
    } else if (event === 'error') {
      this.errorListeners.push(listener as (err: Error) => void);
    } else if (event === 'close') {
      this.closeListeners.push(listener as () => void);
    } else if (event === 'unexpected-response') {
      this.unexpectedResponseListeners.push(listener as (status: number) => void);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  fireOpen(): void {
    for (const fn of this.openListeners) fn();
  }
  fireMessage(text: string | null): void {
    for (const fn of this.messageListeners) fn(text);
  }
  fireError(err: Error = new Error('simulated error')): void {
    for (const fn of this.errorListeners) fn(err);
  }
  fireClose(): void {
    for (const fn of this.closeListeners) fn();
  }
  fireUnexpectedResponse(status: number): void {
    for (const fn of this.unexpectedResponseListeners) fn(status);
  }
}

describe('BinanceMarketDataAdapter', () => {
  let createdSockets: FakeUpstreamSocket[];
  let socketUrls: string[];
  let counters: Counters;
  let loggedWarns: string[];
  let loggedInfos: string[];
  let logger: AdapterLogger;
  let mockNow: number;

  beforeEach(() => {
    vi.useFakeTimers();
    createdSockets = [];
    socketUrls = [];
    counters = new Counters();
    loggedWarns = [];
    loggedInfos = [];
    logger = {
      warn: (msg: string) => loggedWarns.push(msg),
      info: (msg: string) => loggedInfos.push(msg),
    };
    mockNow = 1700000000000;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function createSocketFactory() {
    return (url: string): UpstreamSocket => {
      socketUrls.push(url);
      const socket = new FakeUpstreamSocket();
      createdSockets.push(socket);
      return socket;
    };
  }

  it('connects to exactly one URL listing 10 lower-case streams for default pairs and strips trailing slash', () => {
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      binanceWsUrl: 'wss://stream.binance.com:9443/',
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 0.5,
    });

    adapter.start(() => {});

    expect(socketUrls.length).toBe(1);
    const expectedUrl =
      'wss://stream.binance.com:9443/stream?streams=btcusdt@depth20@100ms/btcusdt@ticker/ethusdt@depth20@100ms/ethusdt@ticker/solusdt@depth20@100ms/solusdt@ticker/dogeusdt@depth20@100ms/dogeusdt@ticker/xrpusdt@depth20@100ms/xrpusdt@ticker';
    expect(socketUrls[0]).toBe(expectedUrl);
  });

  it('emits {connected:true} on open before first data event, and {connected:false} on loss once', () => {
    const events: MarketEvent[] = [];
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 0.5,
    });

    adapter.start((e) => events.push(e));

    const socket = createdSockets[0]!;
    expect(events.length).toBe(0);

    socket.fireOpen();

    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      kind: 'status',
      connected: true,
      at: mockNow,
    });

    socket.fireMessage(JSON.stringify(SAMPLE_DEPTH_FRAME));

    expect(events.length).toBe(2);
    expect(events[1]?.kind).toBe('depth');

    // Simulate loss: socket closes
    socket.fireClose();

    expect(events.length).toBe(3);
    expect(events[2]).toEqual({
      kind: 'status',
      connected: false,
      at: mockNow,
    });

    // When the reconnect attempt fails, {connected:false} must NOT be emitted again
    const delay = Math.floor(0.5 * 1000); // 500 ms
    vi.advanceTimersByTime(delay);

    expect(createdSockets.length).toBe(2);
    const secondSocket = createdSockets[1]!;
    secondSocket.fireError(new Error('fail during handshake'));
    secondSocket.fireClose();

    // Still only 3 events; no duplicate {connected:false}
    expect(events.length).toBe(3);
  });

  it('handles double end (error then close) with only one end and one reconnect scheduled', () => {
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 0.5,
    });

    adapter.start(() => {});

    const socket = createdSockets[0]!;
    socket.fireError(new Error('connection failed'));
    socket.fireClose();

    const snapshot = counters.snapshot();
    expect(snapshot['upstream.reconnects']).toBe(1);
    expect(snapshot['upstream.connect.failed']).toBe(1);

    const delay = Math.floor(0.5 * 1000); // 500 ms
    vi.advanceTimersByTime(delay);

    expect(createdSockets.length).toBe(2);
  });

  it('handles connect timeout: terminates socket, marks connect.failed, and reconnects at backoffDelay', () => {
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      upstreamConnectTimeoutMs: 5000,
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 0.5,
    });

    adapter.start(() => {});

    const socket = createdSockets[0]!;
    expect(socket.terminated).toBe(false);

    vi.advanceTimersByTime(5000);

    expect(socket.terminated).toBe(true);
    const snapshot = counters.snapshot();
    expect(snapshot['upstream.connect.failed']).toBe(1);
    expect(snapshot['upstream.reconnects']).toBe(1);

    // Socket emits close after being terminated; stale generation callback is ignored
    socket.fireClose();
    expect(counters.snapshot()['upstream.reconnects']).toBe(1);

    // Advance backoff time
    vi.advanceTimersByTime(500);
    expect(createdSockets.length).toBe(2);
  });

  it('does not increment connect.failed if open already fired before loss', () => {
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 0.5,
    });

    adapter.start(() => {});

    const socket = createdSockets[0]!;
    socket.fireOpen();
    socket.fireClose();

    const snapshot = counters.snapshot();
    expect(snapshot['upstream.reconnects']).toBe(1);
    expect(snapshot['upstream.connect.failed']).toBe(0);
  });

  it('resets backoff attempt counter after 60s connected, but keeps growing if lost before 60s', () => {
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      upstreamSilenceMs: 120000,
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 1.0, // max backoff: min(30000, 1000 * 2^attempt)
    });

    adapter.start(() => {});

    // Attempt 0 connects
    createdSockets[0]!.fireOpen();

    // Stays connected for 30s (< 60s), then drops
    vi.advanceTimersByTime(30000);
    createdSockets[0]!.fireClose();

    // Attempt 0 failed to reach 60s -> delay was 1000 * 2^0 = 1000ms. Attempt counter now 1.
    vi.advanceTimersByTime(1000);
    expect(createdSockets.length).toBe(2);

    // Attempt 1 connects
    createdSockets[1]!.fireOpen();

    // Stays connected for 20s (< 60s), then drops
    vi.advanceTimersByTime(20000);
    createdSockets[1]!.fireClose();

    // Attempt counter was 1 -> delay is 1000 * 2^1 = 2000ms. Attempt counter now 2.
    vi.advanceTimersByTime(1999);
    expect(createdSockets.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(createdSockets.length).toBe(3);

    // Attempt 2 connects and stays connected for 60s!
    createdSockets[2]!.fireOpen();
    vi.advanceTimersByTime(60000);

    // Drops after 60s
    createdSockets[2]!.fireClose();

    // Attempt counter was reset to 0 by the 60s timer -> delay is back to attempt 0 (1000ms)!
    vi.advanceTimersByTime(999);
    expect(createdSockets.length).toBe(3);
    vi.advanceTimersByTime(1);
    expect(createdSockets.length).toBe(4);
  });

  it('silence watchdog terminates socket and reconnects if open and silent for UPSTREAM_SILENCE_MS', () => {
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      upstreamSilenceMs: 10000,
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 0.5,
    });

    adapter.start(() => {});

    const socket = createdSockets[0]!;
    socket.fireOpen();

    // Message arrives at 6000ms -> postpones silence watchdog
    vi.advanceTimersByTime(6000);
    socket.fireMessage(JSON.stringify(SAMPLE_DEPTH_FRAME));

    // At 15000ms (9000ms after last message), still not timed out
    vi.advanceTimersByTime(9000);
    expect(socket.terminated).toBe(false);

    // At 16001ms (10001ms after last message), silence watchdog triggers
    vi.advanceTimersByTime(1001);
    expect(socket.terminated).toBe(true);

    const snapshot = counters.snapshot();
    expect(snapshot['upstream.reconnects']).toBe(1);

    // Reconnects after backoff
    vi.advanceTimersByTime(500);
    expect(createdSockets.length).toBe(2);
  });

  it('await stop() terminates the socket, clears all timers (timer count 0), and no createSocket follows', async () => {
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 0.5,
    });

    adapter.start(() => {});
    const socket = createdSockets[0]!;
    socket.fireOpen();

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await adapter.stop();

    expect(socket.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(100000);
    expect(createdSockets.length).toBe(1);
  });

  it('logs warn on unexpected-response 451 naming BINANCE_WS_URL and wss://data-stream.binance.vision', () => {
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      binanceWsUrl: 'wss://stream.binance.com:9443',
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 0.5,
    });

    adapter.start(() => {});

    const socket = createdSockets[0]!;
    socket.fireUnexpectedResponse(451);

    expect(loggedWarns.length).toBe(1);
    expect(loggedWarns[0]).toMatch(/BINANCE_WS_URL/);
    expect(loggedWarns[0]).toMatch(/wss:\/\/data-stream\.binance\.vision/);
    expect(counters.snapshot()['upstream.connect.failed']).toBe(1);
  });

  it('throws when start is called twice', () => {
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 0.5,
    });

    adapter.start(() => {});
    expect(() => adapter.start(() => {})).toThrow(/already started/);
  });

  it('increments upstream.frames.received and upstream.frames.invalid for malformed or binary frames without logging', () => {
    const adapter = new BinanceMarketDataAdapter({
      pairs: DEFAULT_PAIRS,
      createSocket: createSocketFactory(),
      counters,
      logger,
      now: () => mockNow,
      random: () => 0.5,
    });

    adapter.start(() => {});
    const socket = createdSockets[0]!;
    socket.fireOpen();

    const infoCountBefore = loggedInfos.length;

    // Binary frame
    socket.fireMessage(null);
    // Malformed JSON frame
    socket.fireMessage('{bad json');

    const snapshot = counters.snapshot();
    expect(snapshot['upstream.frames.received']).toBe(2);
    expect(snapshot['upstream.frames.invalid']).toBe(2);

    // Hot path must NOT log
    expect(loggedInfos.length).toBe(infoCountBefore);
  });
});
