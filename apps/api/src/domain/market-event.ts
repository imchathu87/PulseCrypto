export type SourceKind = 'binance' | 'simulator';

export type Pair = string;

export type OrderBookLevel = readonly [price: number, qty: number];

export interface DepthUpdate {
  readonly kind: 'depth';
  readonly pair: Pair;
  readonly receivedAt: number;
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
}

export interface TickerUpdate {
  readonly kind: 'ticker';
  readonly pair: Pair;
  readonly receivedAt: number;
  readonly price: number;
  readonly change24hPct: number;
  readonly high24h: number;
  readonly low24h: number;
  readonly volume24h: number;
}

export interface SourceStatusChange {
  readonly kind: 'status';
  readonly connected: boolean;
  readonly at: number;
}

export type MarketEvent = DepthUpdate | TickerUpdate | SourceStatusChange;

export type MarketEventSink = (event: MarketEvent) => void;

export interface MarketDataSource {
  readonly kind: SourceKind;
  start(sink: MarketEventSink): void;
  stop(): Promise<void>;
}
