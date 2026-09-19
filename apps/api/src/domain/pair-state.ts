import type { DepthUpdate, OrderBookLevel, Pair, TickerUpdate } from './market-event.ts';

export const DISPLAY_LEVELS = 10;

export interface PairState {
  readonly pair: Pair;
  readonly rev: number;

  // time (§6)
  readonly timestamp: number | null;
  readonly lastDepthAt: number | null;
  readonly lastTickerAt: number | null;

  // ticker group: from <pair>@ticker
  readonly price: number | null;
  readonly change24hPct: number | null;
  readonly high24h: number | null;
  readonly low24h: number | null;
  readonly volume24h: number | null;

  // book group: from <pair>@depth20@100ms
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
  readonly spread: number | null;
  readonly buyPressure: number | null;
  readonly sellPressure: number | null;
}

export function emptyPairState(pair: Pair): PairState {
  return {
    pair,
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
  };
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function applyDepth(state: PairState, event: DepthUpdate): PairState {
  if (event.pair !== state.pair) {
    throw new Error(`Pair mismatch: event pair "${event.pair}" !== state pair "${state.pair}"`);
  }

  const { bids, asks, receivedAt } = event;

  let spread: number | null = null;
  let buyPressure: number | null = null;
  let sellPressure: number | null = null;

  if (bids.length > 0 && asks.length > 0) {
    const bestBid = bids[0]![0];
    const bestAsk = asks[0]![0];
    spread = bestAsk - bestBid;

    const displayBids = bids.slice(0, DISPLAY_LEVELS);
    const displayAsks = asks.slice(0, DISPLAY_LEVELS);

    let sumBidQty = 0;
    for (let i = 0; i < displayBids.length; i++) {
      sumBidQty += displayBids[i]![1];
    }

    let sumAskQty = 0;
    for (let i = 0; i < displayAsks.length; i++) {
      sumAskQty += displayAsks[i]![1];
    }

    const totalQty = sumBidQty + sumAskQty;
    if (totalQty > 0) {
      buyPressure = round2((100 * sumBidQty) / totalQty);
      sellPressure = round2(100 - buyPressure);
    }
  }

  const timestamp = Math.max(receivedAt, state.lastTickerAt ?? -Infinity);

  return {
    ...state,
    timestamp,
    lastDepthAt: receivedAt,
    bids,
    asks,
    spread,
    buyPressure,
    sellPressure,
  };
}

export function applyTicker(state: PairState, event: TickerUpdate): PairState {
  if (event.pair !== state.pair) {
    throw new Error(`Pair mismatch: event pair "${event.pair}" !== state pair "${state.pair}"`);
  }

  const { price, change24hPct, high24h, low24h, volume24h, receivedAt } = event;
  const timestamp = Math.max(receivedAt, state.lastDepthAt ?? -Infinity);

  return {
    ...state,
    timestamp,
    lastTickerAt: receivedAt,
    price,
    change24hPct,
    high24h,
    low24h,
    volume24h,
  };
}
