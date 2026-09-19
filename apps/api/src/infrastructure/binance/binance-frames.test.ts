import { describe, expect, it } from 'vitest';
import {
  SAMPLE_DEPTH_FRAME,
  SAMPLE_ETH_TICKER_FRAME,
  SAMPLE_TICKER_FRAME,
} from './__fixtures__/frames.ts';
import { buildStreamTable, normalizeFrame } from './binance-frames.ts';

describe('binance-frames normalization', () => {
  const table = buildStreamTable(['BTCUSDT', 'ETHUSDT']);
  const now = 1789765834000;

  it('normalizes valid depth frame to DepthUpdate with number tuples', () => {
    const update = normalizeFrame(SAMPLE_DEPTH_FRAME, table, now);
    expect(update).toEqual({
      kind: 'depth',
      pair: 'BTCUSDT',
      receivedAt: now,
      bids: [
        [81199.71, 1.20623],
        [81199.7, 0.5],
        [81198.5, 2.345],
      ],
      asks: [
        [81199.72, 3.55133],
        [81199.8, 1.1],
        [81200, 4.2],
      ],
    });
  });

  it('normalizes valid JSON string depth frame', () => {
    const jsonString = JSON.stringify(SAMPLE_DEPTH_FRAME);
    const update = normalizeFrame(jsonString, table, now);
    expect(update).not.toBeNull();
    expect(update?.kind).toBe('depth');
  });

  it('normalizes valid ticker frame with five mapped domain fields', () => {
    const update = normalizeFrame(SAMPLE_TICKER_FRAME, table, now);
    expect(update).toEqual({
      kind: 'ticker',
      pair: 'BTCUSDT',
      receivedAt: now,
      price: 81199.71,
      change24hPct: 6.133,
      high24h: 81400,
      low24h: 76259.98,
      volume24h: 1882000000.5,
    });
  });

  it('normalizes ticker frame with negative change24hPct', () => {
    const update = normalizeFrame(SAMPLE_ETH_TICKER_FRAME, table, now);
    expect(update).toEqual({
      kind: 'ticker',
      pair: 'ETHUSDT',
      receivedAt: now,
      price: 3456.78,
      change24hPct: -2.45,
      high24h: 3550,
      low24h: 3390.2,
      volume24h: 85432100.12,
    });
  });

  it('emits DepthUpdate when one side is empty (e.g. bids: [])', () => {
    const frame = {
      stream: 'btcusdt@depth20@100ms',
      data: {
        lastUpdateId: 100324344395,
        bids: [],
        asks: [['81199.72000000', '3.55133000']],
      },
    };
    const update = normalizeFrame(frame, table, now);
    expect(update).toEqual({
      kind: 'depth',
      pair: 'BTCUSDT',
      receivedAt: now,
      bids: [],
      asks: [[81199.72, 3.55133]],
    });
  });

  it('derives pair from lookup table, never payload symbol', () => {
    const frame = {
      stream: 'ethusdt@ticker',
      data: {
        s: 'DOGEUSDT', // payload says DOGE, but stream is ethusdt@ticker
        c: '3000.0',
        P: '1.0',
        h: '3100.0',
        l: '2900.0',
        q: '100000.0',
      },
    };
    const update = normalizeFrame(frame, table, now);
    expect(update).not.toBeNull();
    expect(update?.pair).toBe('ETHUSDT');
  });

  describe('malformed frame rejection (returns null)', () => {
    it('returns null for invalid JSON string', () => {
      expect(normalizeFrame('{not json', table, now)).toBeNull();
    });

    it('returns null for unknown stream', () => {
      const frame = {
        stream: 'dogeusdt@depth20@100ms', // DOGEUSDT not in table
        data: SAMPLE_DEPTH_FRAME.data,
      };
      expect(normalizeFrame(frame, table, now)).toBeNull();
    });

    it('returns null for non-decimal numeric strings ("abc", "", "1e5")', () => {
      const badStrings = ['abc', '', '1e5', '1.2.3', '.5', '5.', ' 100 '];
      for (const bad of badStrings) {
        const frame = {
          stream: 'btcusdt@ticker',
          data: {
            c: bad,
            P: '1.0',
            h: '2.0',
            l: '1.0',
            q: '10.0',
          },
        };
        expect(normalizeFrame(frame, table, now)).toBeNull();
      }
    });

    it('returns null for zero or negative price/quantity', () => {
      const badValues = ['0', '-10', '0.00000'];
      for (const bad of badValues) {
        const frame = {
          stream: 'btcusdt@ticker',
          data: {
            c: bad,
            P: '1.0',
            h: '2.0',
            l: '1.0',
            q: '10.0',
          },
        };
        expect(normalizeFrame(frame, table, now)).toBeNull();
      }
    });

    it('returns null for crossed book (bestBid >= bestAsk)', () => {
      const crossedFrame = {
        stream: 'btcusdt@depth20@100ms',
        data: {
          lastUpdateId: 100,
          bids: [['100.0', '1.0']],
          asks: [['99.0', '1.0']],
        },
      };
      expect(normalizeFrame(crossedFrame, table, now)).toBeNull();
    });

    it('returns null for mis-ordered book (bids not descending or asks not ascending)', () => {
      const misorderedBids = {
        stream: 'btcusdt@depth20@100ms',
        data: {
          lastUpdateId: 100,
          bids: [
            ['100.0', '1.0'],
            ['101.0', '1.0'],
          ],
          asks: [['105.0', '1.0']],
        },
      };
      expect(normalizeFrame(misorderedBids, table, now)).toBeNull();

      const misorderedAsks = {
        stream: 'btcusdt@depth20@100ms',
        data: {
          lastUpdateId: 100,
          bids: [['100.0', '1.0']],
          asks: [
            ['106.0', '1.0'],
            ['105.0', '1.0'],
          ],
        },
      };
      expect(normalizeFrame(misorderedAsks, table, now)).toBeNull();
    });

    it('returns null for missing required fields', () => {
      const missingTickerField = {
        stream: 'btcusdt@ticker',
        data: {
          c: '100.0',
          P: '1.0',
          // missing h, l, q
        },
      };
      expect(normalizeFrame(missingTickerField, table, now)).toBeNull();

      const missingDepthField = {
        stream: 'btcusdt@depth20@100ms',
        data: {
          bids: [['100.0', '1.0']],
          // missing asks
        },
      };
      expect(normalizeFrame(missingDepthField, table, now)).toBeNull();
    });

    it('returns null for non-object raw input', () => {
      expect(normalizeFrame(null, table, now)).toBeNull();
      expect(normalizeFrame(123, table, now)).toBeNull();
      expect(normalizeFrame(true, table, now)).toBeNull();
      expect(normalizeFrame(undefined, table, now)).toBeNull();
    });
  });
});
