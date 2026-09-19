import { describe, expect, it } from 'vitest';
import type { DepthUpdate, TickerUpdate } from '../domain/market-event.ts';
import { Counters } from './counters.ts';
import { LatestValueBuffer } from './latest-value-buffer.ts';

const FIVE_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT'] as const;

describe('application/latest-value-buffer', () => {
  it('throws in constructor when pairs array is empty', () => {
    const counters = new Counters();
    expect(() => new LatestValueBuffer([], counters)).toThrow(/requires at least one pair/);
  });

  it('throws in constructor when duplicate pairs are configured', () => {
    const counters = new Counters();
    expect(() => new LatestValueBuffer(['BTCUSDT', 'BTCUSDT'], counters)).toThrow(
      /Duplicate pair configured/,
    );
  });

  it('initializes with empty pair states for each configured pair and rev 0', () => {
    const counters = new Counters();
    const buffer = new LatestValueBuffer(FIVE_PAIRS, counters);

    expect(buffer.currentRev).toBe(0);
    const values = buffer.values();
    expect(values).toHaveLength(5);
    for (const state of values) {
      expect(state.rev).toBe(0);
      expect(state.price).toBeNull();
      expect(state.bids).toEqual([]);
    }
  });

  it('throws on unknown pair in apply without mutating buffer or counter', () => {
    const counters = new Counters();
    const buffer = new LatestValueBuffer(FIVE_PAIRS, counters);

    const event: TickerUpdate = {
      kind: 'ticker',
      pair: 'ADAUSDT',
      receivedAt: 1000,
      price: 1,
      change24hPct: 0,
      high24h: 1,
      low24h: 1,
      volume24h: 100,
    };

    expect(() => buffer.apply(event)).toThrow(/Unknown pair: "ADAUSDT"/);
    expect(buffer.currentRev).toBe(0);
    expect(counters.snapshot()['buffer.mutations']).toBe(0);
  });

  it('throws on unexpected event kind in apply', () => {
    const counters = new Counters();
    const buffer = new LatestValueBuffer(FIVE_PAIRS, counters);

    const invalidEvent = {
      kind: 'status',
      pair: 'BTCUSDT',
    };

    expect(() => buffer.apply(invalidEvent as never)).toThrow(/Unexpected event kind: status/);
    expect(buffer.currentRev).toBe(0);
    expect(counters.snapshot()['buffer.mutations']).toBe(0);
  });

  it('applies 10 000 mixed events: rev strictly increases across pairs, ends at 10000, map size stays 5, mutations counter is 10000', () => {
    const counters = new Counters();
    const buffer = new LatestValueBuffer(FIVE_PAIRS, counters);

    let lastRev = 0;
    const totalEvents = 10000;

    for (let i = 0; i < totalEvents; i++) {
      const pair = FIVE_PAIRS[i % FIVE_PAIRS.length]!;
      const isDepth = i % 2 === 0;

      let next;
      if (isDepth) {
        const event: DepthUpdate = {
          kind: 'depth',
          pair,
          receivedAt: 1000 + i,
          bids: [[60000 - i, 1]],
          asks: [[60001 + i, 1]],
        };
        next = buffer.apply(event);
      } else {
        const event: TickerUpdate = {
          kind: 'ticker',
          pair,
          receivedAt: 1000 + i,
          price: 60000 + (i % 100),
          change24hPct: 1.5,
          high24h: 65000,
          low24h: 55000,
          volume24h: 50000,
        };
        next = buffer.apply(event);
      }

      // rev must strictly increase across all pairs
      expect(next.rev).toBeGreaterThan(lastRev);
      expect(next.rev).toBe(i + 1);
      lastRev = next.rev;
    }

    expect(buffer.currentRev).toBe(totalEvents);
    expect(buffer.values()).toHaveLength(5);
    expect(counters.snapshot()['buffer.mutations']).toBe(totalEvents);

    // Check each pair has latest rev and non-null data
    for (const pair of FIVE_PAIRS) {
      const state = buffer.get(pair);
      expect(state).toBeDefined();
      expect(state!.rev).toBeGreaterThan(0);
      expect(state!.lastDepthAt).not.toBeNull();
      expect(state!.lastTickerAt).not.toBeNull();
    }
  });
});
