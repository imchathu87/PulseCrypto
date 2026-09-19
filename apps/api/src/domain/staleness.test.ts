import { describe, expect, it } from 'vitest';
import { emptyPairState } from './pair-state.ts';
import { isPairStale } from './staleness.ts';

describe('domain/staleness isPairStale', () => {
  const STALE_AFTER_MS = 5000;

  it('condition 1: pair is stale when upstream is disconnected', () => {
    const state = {
      ...emptyPairState('BTCUSDT'),
      lastDepthAt: 1000,
    };
    const isStale = isPairStale(state, {
      upstreamConnected: false,
      now: 2000,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(isStale).toBe(true);
  });

  it('condition 2: pair is stale when it has never had a depth update (lastDepthAt is null)', () => {
    const state = emptyPairState('BTCUSDT');
    expect(state.lastDepthAt).toBeNull();

    const isStale = isPairStale(state, {
      upstreamConnected: true,
      now: 2000,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(isStale).toBe(true);
  });

  it('condition 3: pair is stale when now - lastDepthAt exceeds staleAfterMs', () => {
    const state = {
      ...emptyPairState('BTCUSDT'),
      lastDepthAt: 1000,
    };

    // Exactly at stale boundary: not stale
    const atBoundary = isPairStale(state, {
      upstreamConnected: true,
      now: 1000 + STALE_AFTER_MS,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(atBoundary).toBe(false);

    // One millisecond past boundary: stale
    const pastBoundary = isPairStale(state, {
      upstreamConnected: true,
      now: 1000 + STALE_AFTER_MS + 1,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(pastBoundary).toBe(true);
  });

  it('pair is not stale when upstream is connected, depth exists, and within threshold', () => {
    const state = {
      ...emptyPairState('BTCUSDT'),
      lastDepthAt: 1000,
    };
    const isStale = isPairStale(state, {
      upstreamConnected: true,
      now: 2000,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(isStale).toBe(false);
  });

  it('pair is stale when lastTickerAt is fresh but lastDepthAt is older than staleAfterMs', () => {
    const state = {
      ...emptyPairState('BTCUSDT'),
      lastDepthAt: 1000,
      lastTickerAt: 9999, // very fresh ticker
      timestamp: 9999,
    };
    // now is 7000: now - lastDepthAt = 6000 > STALE_AFTER_MS (5000), even though lastTickerAt is fresh
    const isStale = isPairStale(state, {
      upstreamConnected: true,
      now: 7000,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(isStale).toBe(true);
  });
});
