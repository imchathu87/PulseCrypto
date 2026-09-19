import { describe, expect, it } from 'vitest';
import type { DepthUpdate, OrderBookLevel, TickerUpdate } from './market-event.ts';
import {
  applyDepth,
  applyTicker,
  DISPLAY_LEVELS,
  emptyPairState,
  round2,
} from './pair-state.ts';

describe('domain/pair-state', () => {
  it('initializes an empty pair state with rev 0, empty books and null fields', () => {
    const state = emptyPairState('BTCUSDT');
    expect(state).toEqual({
      pair: 'BTCUSDT',
      rev: 0,
      timestamp: null,
      lastDepthAt: null,
      lastTickerAt: null,
      price: null,
      change24hPct: null,
      high24h: null,
      low24h: null,
      volume24h: null,
      bids: [],
      asks: [],
      spread: null,
      buyPressure: null,
      sellPressure: null,
    });
  });

  it('round2 rounds numbers to 2 decimal places', () => {
    expect(round2(12.3456)).toBe(12.35);
    expect(round2(12.344)).toBe(12.34);
    expect(round2(100 - 41.23)).toBe(58.77);
  });

  describe('applyDepth', () => {
    it('folds 20 levels per side, computing pressure over only the first 10 levels', () => {
      const state = emptyPairState('BTCUSDT');

      // Create 20 levels: first 10 have specific quantities, remaining 10 have massive quantities
      // that would distort the ratio if included.
      const bids: OrderBookLevel[] = [];
      const asks: OrderBookLevel[] = [];

      for (let i = 0; i < 20; i++) {
        const bidPrice = 60000 - (i + 1) * 10;
        const askPrice = 60000 + (i + 1) * 10;
        // Levels 0..9: bidQty = 3, askQty = 1 => 30 bids, 10 asks => 75% buy pressure
        // Levels 10..19: bidQty = 0.1, askQty = 1000
        const bidQty = i < DISPLAY_LEVELS ? 3 : 0.1;
        const askQty = i < DISPLAY_LEVELS ? 1 : 1000;
        bids.push([bidPrice, bidQty]);
        asks.push([askPrice, askQty]);
      }

      const event: DepthUpdate = {
        kind: 'depth',
        pair: 'BTCUSDT',
        receivedAt: 1700000001000,
        bids,
        asks,
      };

      const next = applyDepth(state, event);

      expect(next.bids).toBe(bids);
      expect(next.asks).toBe(asks);
      expect(next.lastDepthAt).toBe(1700000001000);
      expect(next.timestamp).toBe(1700000001000);

      // Best bid = 60000 - 10 = 59990, best ask = 60000 + 10 = 60010 => spread = 20
      expect(next.spread).toBe(20);

      // Over first 10 levels: 10 * 3 = 30 bid qty, 10 * 1 = 10 ask qty => total 40
      // buyPressure = 100 * 30 / 40 = 75.00
      // sellPressure = 100 - 75 = 25.00
      expect(next.buyPressure).toBe(75);
      expect(next.sellPressure).toBe(25);
      expect(Math.abs(next.buyPressure! + next.sellPressure! - 100)).toBeLessThan(1e-9);
    });

    it('returns null for spread and pressures when bids is empty', () => {
      const state = emptyPairState('BTCUSDT');
      const event: DepthUpdate = {
        kind: 'depth',
        pair: 'BTCUSDT',
        receivedAt: 1700000002000,
        bids: [],
        asks: [[60010, 1]],
      };

      const next = applyDepth(state, event);
      expect(next.spread).toBeNull();
      expect(next.buyPressure).toBeNull();
      expect(next.sellPressure).toBeNull();
    });

    it('returns null for spread and pressures when asks is empty', () => {
      const state = emptyPairState('BTCUSDT');
      const event: DepthUpdate = {
        kind: 'depth',
        pair: 'BTCUSDT',
        receivedAt: 1700000002000,
        bids: [[59990, 1]],
        asks: [],
      };

      const next = applyDepth(state, event);
      expect(next.spread).toBeNull();
      expect(next.buyPressure).toBeNull();
      expect(next.sellPressure).toBeNull();
    });

    it('returns null for spread and pressures when both sides are empty', () => {
      const state = emptyPairState('BTCUSDT');
      const event: DepthUpdate = {
        kind: 'depth',
        pair: 'BTCUSDT',
        receivedAt: 1700000002000,
        bids: [],
        asks: [],
      };

      const next = applyDepth(state, event);
      expect(next.spread).toBeNull();
      expect(next.buyPressure).toBeNull();
      expect(next.sellPressure).toBeNull();
    });

    it('computes fractional buy and sell pressure rounding correctly with <10 levels', () => {
      const state = emptyPairState('BTCUSDT');
      // 1 bid level with qty 1, 1 ask level with qty 2 => 1/3 buy ratio => 33.33 buy, 66.67 sell
      const event: DepthUpdate = {
        kind: 'depth',
        pair: 'BTCUSDT',
        receivedAt: 1000,
        bids: [[59990, 1]],
        asks: [[60010, 2]],
      };

      const next = applyDepth(state, event);
      expect(next.buyPressure).toBe(33.33);
      expect(next.sellPressure).toBe(66.67);
      expect(Math.abs(next.buyPressure! + next.sellPressure! - 100)).toBeLessThan(1e-9);
    });

    it('preserves all ticker fields when applyDepth is folded onto a state with existing ticker data', () => {
      const initial = emptyPairState('BTCUSDT');
      const withTicker = applyTicker(initial, {
        kind: 'ticker',
        pair: 'BTCUSDT',
        receivedAt: 1000,
        price: 65000.5,
        change24hPct: -1.25,
        high24h: 66000,
        low24h: 64000,
        volume24h: 98765.43,
      });

      const depthEvent: DepthUpdate = {
        kind: 'depth',
        pair: 'BTCUSDT',
        receivedAt: 2000,
        bids: [
          [65000, 2],
          [64990, 3],
        ],
        asks: [
          [65010, 5],
        ],
      };

      const next = applyDepth(withTicker, depthEvent);

      // Verify all ticker fields are strictly preserved
      expect(next.price).toBe(65000.5);
      expect(next.change24hPct).toBe(-1.25);
      expect(next.high24h).toBe(66000);
      expect(next.low24h).toBe(64000);
      expect(next.volume24h).toBe(98765.43);
      expect(next.lastTickerAt).toBe(1000);

      // Book fields are updated
      expect(next.lastDepthAt).toBe(2000);
      expect(next.timestamp).toBe(2000);
      expect(next.spread).toBe(10); // 65010 - 65000
      // 5 bids, 5 asks => total 10 => 50% buy, 50% sell
      expect(next.buyPressure).toBe(50);
      expect(next.sellPressure).toBe(50);
    });

    it('correctly calculates pressure with fewer than 10 levels (<10 levels)', () => {
      const state = emptyPairState('BTCUSDT');
      // 3 bids (qtys 2, 3, 5 = 10), 2 asks (qtys 15, 15 = 30) => total 40 => 25% buy, 75% sell
      const event: DepthUpdate = {
        kind: 'depth',
        pair: 'BTCUSDT',
        receivedAt: 1000,
        bids: [
          [100, 2],
          [99, 3],
          [98, 5],
        ],
        asks: [
          [101, 15],
          [102, 15],
        ],
      };

      const next = applyDepth(state, event);
      expect(next.bids).toHaveLength(3);
      expect(next.asks).toHaveLength(2);
      expect(next.buyPressure).toBe(25);
      expect(next.sellPressure).toBe(75);
    });

    it('throws if event pair does not match state pair', () => {
      const state = emptyPairState('BTCUSDT');
      const event: DepthUpdate = {
        kind: 'depth',
        pair: 'ETHUSDT',
        receivedAt: 1700000002000,
        bids: [],
        asks: [],
      };

      expect(() => applyDepth(state, event)).toThrow(/Pair mismatch/);
    });
  });

  describe('applyTicker', () => {
    it('folds ticker update, replacing ticker group atomically while leaving book group untouched', () => {
      const initial = emptyPairState('BTCUSDT');
      const depthEvent: DepthUpdate = {
        kind: 'depth',
        pair: 'BTCUSDT',
        receivedAt: 1000,
        bids: [[59990, 2]],
        asks: [[60010, 1]],
      };
      const withDepth = applyDepth(initial, depthEvent);

      const tickerEvent: TickerUpdate = {
        kind: 'ticker',
        pair: 'BTCUSDT',
        receivedAt: 2000,
        price: 60005,
        change24hPct: 2.5,
        high24h: 61000,
        low24h: 58000,
        volume24h: 123456.78,
      };

      const next = applyTicker(withDepth, tickerEvent);

      // Ticker group updated
      expect(next.price).toBe(60005);
      expect(next.change24hPct).toBe(2.5);
      expect(next.high24h).toBe(61000);
      expect(next.low24h).toBe(58000);
      expect(next.volume24h).toBe(123456.78);
      expect(next.lastTickerAt).toBe(2000);

      // Book group untouched
      expect(next.bids).toBe(withDepth.bids);
      expect(next.asks).toBe(withDepth.asks);
      expect(next.spread).toBe(withDepth.spread);
      expect(next.buyPressure).toBe(withDepth.buyPressure);
      expect(next.sellPressure).toBe(withDepth.sellPressure);
      expect(next.lastDepthAt).toBe(1000);

      // Timestamp is max(lastDepthAt, lastTickerAt)
      expect(next.timestamp).toBe(2000);
    });

    it('sets timestamp to max(lastDepthAt, lastTickerAt) when depth is newer than ticker', () => {
      const initial = emptyPairState('BTCUSDT');
      const tickerEvent: TickerUpdate = {
        kind: 'ticker',
        pair: 'BTCUSDT',
        receivedAt: 1000,
        price: 60000,
        change24hPct: 1,
        high24h: 61000,
        low24h: 59000,
        volume24h: 10000,
      };
      const withTicker = applyTicker(initial, tickerEvent);

      const depthEvent: DepthUpdate = {
        kind: 'depth',
        pair: 'BTCUSDT',
        receivedAt: 1500,
        bids: [[59990, 1]],
        asks: [[60010, 1]],
      };
      const withBoth = applyDepth(withTicker, depthEvent);

      expect(withBoth.lastTickerAt).toBe(1000);
      expect(withBoth.lastDepthAt).toBe(1500);
      expect(withBoth.timestamp).toBe(1500);
    });

    it('throws if ticker event pair does not match state pair', () => {
      const state = emptyPairState('BTCUSDT');
      const event: TickerUpdate = {
        kind: 'ticker',
        pair: 'ETHUSDT',
        receivedAt: 1000,
        price: 3000,
        change24hPct: 0,
        high24h: 3100,
        low24h: 2900,
        volume24h: 5000,
      };

      expect(() => applyTicker(state, event)).toThrow(/Pair mismatch/);
    });
  });
});
