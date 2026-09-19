import type { DepthUpdate, Pair, TickerUpdate } from '../domain/market-event.ts';
import { applyDepth, applyTicker, emptyPairState, type PairState } from '../domain/pair-state.ts';
import type { Counters } from './counters.ts';

export class LatestValueBuffer {
  private seq = 0;
  private readonly map = new Map<Pair, PairState>();

  constructor(
    pairs: readonly Pair[],
    private readonly counters: Counters,
  ) {
    if (pairs.length === 0) {
      throw new Error('LatestValueBuffer requires at least one pair');
    }
    const seen = new Set<Pair>();
    for (const pair of pairs) {
      if (seen.has(pair)) {
        throw new Error(`Duplicate pair configured: "${pair}"`);
      }
      seen.add(pair);
      this.map.set(pair, emptyPairState(pair));
    }
  }

  get currentRev(): number {
    return this.seq;
  }

  get(pair: Pair): PairState | undefined {
    return this.map.get(pair);
  }

  values(): readonly PairState[] {
    return Array.from(this.map.values());
  }

  apply(event: DepthUpdate | TickerUpdate): PairState {
    const current = this.map.get(event.pair);
    if (!current) {
      throw new Error(`Unknown pair: "${event.pair}"`);
    }

    let next: PairState;
    if (event.kind === 'depth') {
      next = applyDepth(current, event);
    } else if (event.kind === 'ticker') {
      next = applyTicker(current, event);
    } else {
      const unexpectedKind = (event as { readonly kind?: unknown }).kind;
      throw new Error(`Unexpected event kind: ${String(unexpectedKind)}`);
    }

    this.seq += 1;
    const stamped: PairState = {
      ...next,
      rev: this.seq,
    };
    this.map.set(event.pair, stamped);
    this.counters.increment('buffer.mutations');
    return stamped;
  }
}
