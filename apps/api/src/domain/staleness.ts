import type { PairState } from './pair-state.ts';

export interface StalenessContext {
  readonly upstreamConnected: boolean;
  readonly now: number;
  readonly staleAfterMs: number;
}

/**
 * A pair is stale iff:
 * - upstream is disconnected, OR
 * - it has never had a depth update (lastDepthAt is null), OR
 * - now - lastDepthAt > staleAfterMs
 *
 * Staleness uses lastDepthAt only.
 */
export function isPairStale(state: PairState, context: StalenessContext): boolean {
  if (!context.upstreamConnected) {
    return true;
  }
  if (state.lastDepthAt === null) {
    return true;
  }
  return context.now - state.lastDepthAt > context.staleAfterMs;
}
