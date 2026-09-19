export const COUNTER_NAMES = [
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
] as const;

export type CounterName = (typeof COUNTER_NAMES)[number];
export type CountersSnapshot = Readonly<Record<CounterName, number>>;

export class Counters {
  private readonly counts: Record<CounterName, number>;

  constructor() {
    this.counts = {
      'upstream.frames.received': 0,
      'upstream.frames.invalid': 0,
      'upstream.connect.failed': 0,
      'upstream.reconnects': 0,
      'buffer.mutations': 0,
      'ws.frames.sent': 0,
      'ws.frames.skipped': 0,
      'ws.clients.active': 0,
      'ws.clients.evicted': 0,
      'ws.clients.timedOut': 0,
    };
  }

  increment(name: CounterName, by = 1): void {
    this.counts[name] += by;
  }

  snapshot(): CountersSnapshot {
    return { ...this.counts };
  }
}
