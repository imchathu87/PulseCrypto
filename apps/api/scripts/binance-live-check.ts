import { DEFAULT_BINANCE_WS_URL, DEFAULT_PAIRS } from '../src/config.ts';
import type { MarketEvent } from '../src/domain/market-event.ts';
import { BinanceMarketDataAdapter } from '../src/infrastructure/binance/binance-market-data-adapter.ts';

async function main(): Promise<void> {
  const binanceWsUrl = process.env.BINANCE_WS_URL || DEFAULT_BINANCE_WS_URL;
  const pairs = DEFAULT_PAIRS;

  const depthCounts: Record<string, number> = {};
  const tickerCounts: Record<string, number> = {};

  for (const pair of pairs) {
    depthCounts[pair] = 0;
    tickerCounts[pair] = 0;
  }

  const adapter = new BinanceMarketDataAdapter({
    pairs,
    binanceWsUrl,
  });

  const checkAllReceived = (): boolean => {
    return pairs.every(
      (pair) => (depthCounts[pair] ?? 0) >= 1 && (tickerCounts[pair] ?? 0) >= 1,
    );
  };

  let resolveDone: () => void;
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const onEvent = (event: MarketEvent): void => {
    if (event.kind === 'depth') {
      depthCounts[event.pair] = (depthCounts[event.pair] ?? 0) + 1;
    } else if (event.kind === 'ticker') {
      tickerCounts[event.pair] = (tickerCounts[event.pair] ?? 0) + 1;
    }

    if (checkAllReceived()) {
      resolveDone();
    }
  };

  adapter.start(onEvent);

  const timeout = setTimeout(() => {
    resolveDone();
  }, 5000);

  await donePromise;
  clearTimeout(timeout);

  await adapter.stop();

  console.log('--- Binance Live Check Results ---');
  let success = true;
  for (const pair of pairs) {
    const depth = depthCounts[pair] ?? 0;
    const ticker = tickerCounts[pair] ?? 0;
    console.log(`${pair}: depth=${depth}, ticker=${ticker}`);
    if (depth < 1 || ticker < 1) {
      success = false;
    }
  }

  if (success) {
    console.log('SUCCESS: All pairs received depth and ticker updates within 5s.');
    process.exit(0);
  } else {
    console.error('FAILURE: Missing depth or ticker updates for one or more pairs.');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error in binance-live-check:', err);
  process.exit(1);
});
