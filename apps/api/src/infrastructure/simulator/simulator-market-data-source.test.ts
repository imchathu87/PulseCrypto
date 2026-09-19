import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidBook } from '../../domain/book.ts';
import type { MarketEvent } from '../../domain/market-event.ts';
import { SimulatorMarketDataSource } from './simulator-market-data-source.ts';

const FIVE_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT'] as const;

describe('infrastructure/simulator SimulatorMarketDataSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has kind "simulator"', () => {
    const source = new SimulatorMarketDataSource({
      pairs: FIVE_PAIRS,
      ratePerSecond: 1000,
    });
    expect(source.kind).toBe('simulator');
  });

  it('validates ratePerSecond and pairs in constructor', () => {
    expect(
      () =>
        new SimulatorMarketDataSource({
          pairs: [],
          ratePerSecond: 1000,
        }),
    ).toThrow(/requires at least one pair/);

    // Duplicate pairs
    expect(
      () =>
        new SimulatorMarketDataSource({
          pairs: ['BTCUSDT', 'ETHUSDT', 'BTCUSDT'],
          ratePerSecond: 1000,
        }),
    ).toThrow(/does not allow duplicate pairs/);

    // Not a multiple of 10 * 5 = 50
    expect(
      () =>
        new SimulatorMarketDataSource({
          pairs: FIVE_PAIRS,
          ratePerSecond: 1025,
        }),
    ).toThrow(/multiple of 10 × pairs.length/);

    // k = 50 / 50 = 1 < 2
    expect(
      () =>
        new SimulatorMarketDataSource({
          pairs: FIVE_PAIRS,
          ratePerSecond: 50,
        }),
    ).toThrow(/k = ratePerSecond \/ \(10 × pairs\.length\) must be >= 2/);
  });

  it('uses fallback base price of 100 for unknown pairs', async () => {
    const source = new SimulatorMarketDataSource({
      pairs: ['UNKNOWNPAIR'],
      ratePerSecond: 20, // 1 pair * 10 = 10 => 20 is multiple, k = 2
      seed: 42,
      now: () => 1000,
    });

    const events: MarketEvent[] = [];
    source.start((e) => events.push(e));

    vi.advanceTimersByTime(100);
    await source.stop();

    // The first tick emits depth updates and 1 ticker (tick 1 is ticker tick)
    const ticker = events.find((e) => e.kind === 'ticker');
    expect(ticker).toBeDefined();
    if (ticker && ticker.kind === 'ticker') {
      expect(ticker.price).toBeGreaterThan(90);
      expect(ticker.price).toBeLessThan(110);
    }

    const depth = events.find((e) => e.kind === 'depth');
    expect(depth).toBeDefined();
    if (depth && depth.kind === 'depth') {
      expect(depth.bids[0]![0]).toBeLessThan(100.1);
      expect(depth.asks[0]![0]).toBeGreaterThan(99.9);
    }
  });

  it('throws if start is called twice', async () => {
    const source = new SimulatorMarketDataSource({
      pairs: FIVE_PAIRS,
      ratePerSecond: 1000,
    });
    source.start(() => {});
    expect(() => source.start(() => {})).toThrow(/already started/);
    await source.stop();
  });

  it('emits {connected: true} as first event, stops cleanly with 0 timers and no further events', async () => {
    const source = new SimulatorMarketDataSource({
      pairs: FIVE_PAIRS,
      ratePerSecond: 1000,
    });

    const events: MarketEvent[] = [];
    source.start((e) => events.push(e));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: 'status',
      connected: true,
      at: expect.any(Number),
    });

    expect(vi.getTimerCount()).toBe(1);

    await source.stop();
    expect(vi.getTimerCount()).toBe(0);

    const lengthAfterStop = events.length;
    vi.advanceTimersByTime(500);
    expect(events).toHaveLength(lengthAfterStop);
  });

  it('produces identical sequences across two runs with the same seed and fixed now', async () => {
    const fixedNow = () => 1700000000000;

    const source1 = new SimulatorMarketDataSource({
      pairs: FIVE_PAIRS,
      ratePerSecond: 1000,
      seed: 12345,
      now: fixedNow,
    });
    const source2 = new SimulatorMarketDataSource({
      pairs: FIVE_PAIRS,
      ratePerSecond: 1000,
      seed: 12345,
      now: fixedNow,
    });

    const events1: MarketEvent[] = [];
    const events2: MarketEvent[] = [];

    source1.start((e) => events1.push(e));
    source2.start((e) => events2.push(e));

    vi.advanceTimersByTime(300); // 3 ticks

    await source1.stop();
    await source2.stop();

    expect(events1.length).toBeGreaterThan(1);
    expect(events1).toEqual(events2);
  });

  it('emits >= 1 depth per 100ms per pair, equal per-pair event counts, valid books, and tickers on 10th ticks', async () => {
    let mockTime = 1000;
    const source = new SimulatorMarketDataSource({
      pairs: FIVE_PAIRS,
      ratePerSecond: 1000, // 5 pairs => divisor 50 => k = 20 events per pair per 100ms
      seed: 999,
      now: () => mockTime,
    });

    const events: MarketEvent[] = [];
    source.start((e) => events.push(e));

    // First event is connected status
    expect(events[0]?.kind).toBe('status');

    // Run for 15 ticks (1500 ms)
    for (let tick = 1; tick <= 15; tick++) {
      mockTime += 100;
      const countBefore = events.length;
      vi.advanceTimersByTime(100);
      const tickEvents = events.slice(countBefore);

      // Total events per tick = k * pairs.length = 20 * 5 = 100
      expect(tickEvents).toHaveLength(100);

      // Check per-pair breakdown in this tick
      for (const pair of FIVE_PAIRS) {
        const pairEvents = tickEvents.filter(
          (e) => e.kind !== 'status' && 'pair' in e && e.pair === pair,
        );
        expect(pairEvents).toHaveLength(20);

        const depthEvents = pairEvents.filter((e) => e.kind === 'depth');
        const tickerEvents = pairEvents.filter((e) => e.kind === 'ticker');

        // Every pair gets >= 1 depth per 100ms
        expect(depthEvents.length).toBeGreaterThanOrEqual(1);

        const isTickerTick = (tick - 1) % 10 === 0; // tick 1, 11
        if (isTickerTick) {
          expect(tickerEvents).toHaveLength(1);
          expect(depthEvents).toHaveLength(19);
          // Last event for this pair is the ticker
          expect(pairEvents[pairEvents.length - 1]?.kind).toBe('ticker');
        } else {
          expect(tickerEvents).toHaveLength(0);
          expect(depthEvents).toHaveLength(20);
        }

        // Every generated book passes isValidBook
        for (const d of depthEvents) {
          if (d.kind === 'depth') {
            expect(isValidBook(d.bids, d.asks)).toBe(true);
            expect(d.bids).toHaveLength(20);
            expect(d.asks).toHaveLength(20);
          }
        }
      }
    }

    await source.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
