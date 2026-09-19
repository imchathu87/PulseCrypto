import { describe, expect, it } from 'vitest';
import { MarketSnapshotSchema } from './index.ts';

describe('MarketSnapshotSchema', () => {
  it('parses a valid snapshot', () => {
    const input = { pair: 'BTCUSDT', price: 64123.45, lastUpdated: 1_726_000_000_000 };
    expect(MarketSnapshotSchema.parse(input)).toEqual(input);
  });

  it('rejects a snapshot whose price is a string', () => {
    const result = MarketSnapshotSchema.safeParse({
      pair: 'BTCUSDT',
      price: '64123.45',
      lastUpdated: 1_726_000_000_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a snapshot missing a required field', () => {
    const result = MarketSnapshotSchema.safeParse({ pair: 'BTCUSDT', price: 64123.45 });
    expect(result.success).toBe(false);
  });
});
