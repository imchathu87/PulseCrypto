import { describe, expect, it } from 'vitest';
import { COUNTER_NAMES, Counters } from './counters.ts';

describe('application/counters', () => {
  it('defines the 10 architecture section 8 counter names', () => {
    expect(COUNTER_NAMES).toEqual([
      'upstream.frames.received',
      'upstream.frames.invalid',
      'upstream.connect.failed',
      'upstream.reconnects',
      'buffer.mutations',
      'ws.frames.sent',
      'ws.frames.skipped',
      'ws.clients.active',
      'ws.clients.evicted',
      'ws.clients.timedOut',
    ]);
  });

  it('initializes all counters to 0', () => {
    const counters = new Counters();
    const snap = counters.snapshot();
    for (const name of COUNTER_NAMES) {
      expect(snap[name]).toBe(0);
    }
  });

  it('increments counters correctly and snapshot returns an isolated copy', () => {
    const counters = new Counters();
    counters.increment('buffer.mutations');
    counters.increment('buffer.mutations', 4);
    counters.increment('upstream.frames.received', 10);

    const snap = counters.snapshot();
    expect(snap['buffer.mutations']).toBe(5);
    expect(snap['upstream.frames.received']).toBe(10);
    expect(snap['ws.frames.sent']).toBe(0);

    // Snapshot is isolated
    (snap as Record<string, number>)['buffer.mutations'] = 999;
    expect(counters.snapshot()['buffer.mutations']).toBe(5);
  });
});
