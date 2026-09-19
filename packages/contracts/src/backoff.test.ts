import { describe, expect, it } from 'vitest';
import { backoffDelay, type BackoffOptions } from './backoff.ts';

describe('backoffDelay', () => {
  it('returns 0 when random returns 0', () => {
    const upstream: BackoffOptions = { baseMs: 1000, capMs: 30000 };
    const downstream: BackoffOptions = { baseMs: 500, capMs: 5000 };

    expect(backoffDelay(0, upstream, () => 0)).toBe(0);
    expect(backoffDelay(1, upstream, () => 0)).toBe(0);
    expect(backoffDelay(5, upstream, () => 0)).toBe(0);
    expect(backoffDelay(0, downstream, () => 0)).toBe(0);
    expect(backoffDelay(3, downstream, () => 0)).toBe(0);
  });

  it('throws RangeError for negative or non-integer attempts', () => {
    const opts: BackoffOptions = { baseMs: 1000, capMs: 30000 };

    expect(() => backoffDelay(-1, opts)).toThrow(RangeError);
    expect(() => backoffDelay(1.5, opts)).toThrow(RangeError);
    expect(() => backoffDelay(Number.NaN, opts)).toThrow(RangeError);
    expect(() => backoffDelay(Number.POSITIVE_INFINITY, opts)).toThrow(
      RangeError,
    );
  });

  const testVectors: Array<{
    attempt: number;
    opts: BackoffOptions;
    randomVal: number;
    expected: number;
  }> = [
    // Upstream (1000 / 30000)
    {
      attempt: 0,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0,
      expected: 0,
    },
    {
      attempt: 0,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0.5,
      expected: 500,
    },
    {
      attempt: 0,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0.999999,
      expected: 999,
    },
    {
      attempt: 1,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0.5,
      expected: 1000,
    },
    {
      attempt: 2,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0.5,
      expected: 2000,
    },
    {
      attempt: 3,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0.5,
      expected: 4000,
    },
    {
      attempt: 4,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0.5,
      expected: 8000,
    },
    {
      attempt: 5,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0.5,
      expected: 15000, // min(30000, 32000) = 30000; floor(0.5 * 30000) = 15000
    },
    {
      attempt: 6,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0.999999,
      expected: 29999,
    },
    {
      attempt: 20,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0.5,
      expected: 15000,
    },
    {
      attempt: 100,
      opts: { baseMs: 1000, capMs: 30000 },
      randomVal: 0.5,
      expected: 15000,
    },

    // Downstream (500 / 5000)
    {
      attempt: 0,
      opts: { baseMs: 500, capMs: 5000 },
      randomVal: 0,
      expected: 0,
    },
    {
      attempt: 0,
      opts: { baseMs: 500, capMs: 5000 },
      randomVal: 0.5,
      expected: 250,
    },
    {
      attempt: 0,
      opts: { baseMs: 500, capMs: 5000 },
      randomVal: 0.999999,
      expected: 499,
    },
    {
      attempt: 1,
      opts: { baseMs: 500, capMs: 5000 },
      randomVal: 0.5,
      expected: 500,
    },
    {
      attempt: 2,
      opts: { baseMs: 500, capMs: 5000 },
      randomVal: 0.5,
      expected: 1000,
    },
    {
      attempt: 3,
      opts: { baseMs: 500, capMs: 5000 },
      randomVal: 0.5,
      expected: 2000,
    },
    {
      attempt: 4,
      opts: { baseMs: 500, capMs: 5000 },
      randomVal: 0.5,
      expected: 2500, // min(5000, 8000) = 5000; floor(0.5 * 5000) = 2500
    },
    {
      attempt: 5,
      opts: { baseMs: 500, capMs: 5000 },
      randomVal: 0.999999,
      expected: 4999,
    },
    {
      attempt: 50,
      opts: { baseMs: 500, capMs: 5000 },
      randomVal: 0.5,
      expected: 2500,
    },
  ];

  it('matches all test vector table entries and guarantees integer <= capMs', () => {
    for (const { attempt, opts, randomVal, expected } of testVectors) {
      const result = backoffDelay(attempt, opts, () => randomVal);
      expect(result).toBe(expected);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeLessThanOrEqual(opts.capMs);
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });
});
