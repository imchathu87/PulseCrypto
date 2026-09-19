import type {
  DepthUpdate,
  MarketDataSource,
  MarketEventSink,
  OrderBookLevel,
  Pair,
  TickerUpdate,
} from '../../domain/market-event.ts';
import { createPrng } from './prng.ts';

const BASE_PRICES: Readonly<Record<string, number>> = {
  BTCUSDT: 65000,
  ETHUSDT: 3500,
  SOLUSDT: 150,
  DOGEUSDT: 0.2,
  XRPUSDT: 0.6,
};

export interface SimulatorMarketDataSourceOptions {
  readonly pairs: readonly Pair[];
  readonly ratePerSecond: number;
  readonly seed?: number;
  readonly now?: () => number;
}

export class SimulatorMarketDataSource implements MarketDataSource {
  readonly kind = 'simulator' as const;

  private readonly pairs: readonly Pair[];
  private readonly k: number;
  private readonly prng: () => number;
  private readonly now: () => number;
  private readonly midPrices = new Map<Pair, number>();

  private started = false;
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;

  constructor(options: SimulatorMarketDataSourceOptions) {
    const { pairs, ratePerSecond, seed = 42, now = Date.now } = options;

    if (pairs.length === 0) {
      throw new Error('SimulatorMarketDataSource requires at least one pair');
    }

    const uniquePairs = new Set(pairs);
    if (uniquePairs.size !== pairs.length) {
      throw new Error('SimulatorMarketDataSource does not allow duplicate pairs');
    }

    const divisor = 10 * pairs.length;
    if (!Number.isInteger(ratePerSecond) || ratePerSecond <= 0 || ratePerSecond % divisor !== 0) {
      throw new Error(
        `ratePerSecond (${ratePerSecond}) must be a positive integer multiple of 10 × pairs.length (${divisor})`,
      );
    }

    const k = ratePerSecond / divisor;
    if (k < 2) {
      throw new Error(`k = ratePerSecond / (10 × pairs.length) must be >= 2, got ${k}`);
    }

    this.pairs = [...pairs];
    this.k = k;
    this.prng = createPrng(seed);
    this.now = now;

    for (const pair of this.pairs) {
      this.midPrices.set(pair, BASE_PRICES[pair] ?? 100);
    }
  }

  start(sink: MarketEventSink): void {
    if (this.started) {
      throw new Error('SimulatorMarketDataSource already started');
    }
    this.started = true;

    sink({
      kind: 'status',
      connected: true,
      at: this.now(),
    });

    this.timer = setInterval(() => {
      this.tick(sink);
    }, 100);
  }

  stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return Promise.resolve();
  }

  private tick(sink: MarketEventSink): void {
    this.tickCount += 1;
    // Tick 1 (first tick) and every 10th tick after (1, 11, 21, ...) emits a ticker as the last event per pair.
    const isTickerTick = (this.tickCount - 1) % 10 === 0;
    const now = this.now();

    for (const pair of this.pairs) {
      const depthEventsCount = isTickerTick ? this.k - 1 : this.k;
      for (let i = 0; i < depthEventsCount; i++) {
        if (this.timer === null) return;
        sink(this.createDepthUpdate(pair, now));
      }
      if (isTickerTick) {
        if (this.timer === null) return;
        sink(this.createTickerUpdate(pair, now));
      }
    }
  }

  private createDepthUpdate(pair: Pair, now: number): DepthUpdate {
    let mid = this.midPrices.get(pair)!;
    // Multiplicative random walk: mid = mid * (1 + delta)
    const step = (this.prng() - 0.5) * 0.0004;
    mid = mid * (1 + step);
    this.midPrices.set(pair, mid);

    const tick = mid * 1e-4;
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];

    for (let i = 0; i < 20; i++) {
      const bidPrice = mid - tick * (i + 1);
      const bidQty = Math.round((0.5 + this.prng() * 9.5) * 10000) / 10000;
      bids.push([bidPrice, bidQty]);

      const askPrice = mid + tick * (i + 1);
      const askQty = Math.round((0.5 + this.prng() * 9.5) * 10000) / 10000;
      asks.push([askPrice, askQty]);
    }

    return {
      kind: 'depth',
      pair,
      receivedAt: now,
      bids,
      asks,
    };
  }

  private createTickerUpdate(pair: Pair, now: number): TickerUpdate {
    const mid = this.midPrices.get(pair)!;
    const basePrice = BASE_PRICES[pair] ?? 100;
    const change24hPct = Math.round(((mid - basePrice) / basePrice) * 10000) / 100;
    const high24h = Math.max(mid * 1.05, basePrice * 1.05);
    const low24h = Math.min(mid * 0.95, basePrice * 0.95);
    const volume24h = Math.round((10000 + this.prng() * 90000) * 100) / 100;

    return {
      kind: 'ticker',
      pair,
      receivedAt: now,
      price: mid,
      change24hPct,
      high24h,
      low24h,
      volume24h,
    };
  }
}
