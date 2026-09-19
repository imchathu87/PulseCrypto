import { z } from 'zod';
import { type Pair, PairSchema } from '@pulsecrypto/contracts';

export const DEFAULT_PAIRS: readonly Pair[] = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'DOGEUSDT',
  'XRPUSDT',
];

export const DEFAULT_SIMULATOR_RATE = 1000;

export interface AppConfig {
  readonly PAIRS: readonly Pair[];
  readonly MARKET_SOURCE: 'binance' | 'simulator';
  readonly SIMULATOR_RATE: number;
}

export const ConfigSchema = z
  .object({
    PAIRS: z
      .array(PairSchema)
      .min(1, { message: 'must contain at least one pair' })
      .refine((arr) => new Set(arr).size === arr.length, {
        message: 'must contain unique entries',
      }),
    MARKET_SOURCE: z.enum(['binance', 'simulator'], {
      message: 'must be "binance" or "simulator"',
    }),
    SIMULATOR_RATE: z
      .number({ message: 'must be a valid integer' })
      .int({ message: 'must be an integer' })
      .positive({ message: 'must be positive' }),
  })
  .superRefine((data, ctx) => {
    if (data.MARKET_SOURCE === 'simulator') {
      const divisor = 10 * data.PAIRS.length;
      if (data.SIMULATOR_RATE % divisor !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SIMULATOR_RATE'],
          message: `must be an integer multiple of 10 × PAIRS.length (${divisor})`,
        });
      } else if (data.SIMULATOR_RATE / divisor < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SIMULATOR_RATE'],
          message: `k = rate / (10 × pairs.length) must be >= 2, got ${data.SIMULATOR_RATE / divisor}`,
        });
      }
    }
  });

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  let rawPairs: string[];
  if (env.PAIRS === undefined || env.PAIRS === '') {
    rawPairs = [...DEFAULT_PAIRS];
  } else {
    rawPairs = env.PAIRS.split(',').map((s) => s.trim());
  }

  const rawMarketSource =
    env.MARKET_SOURCE === undefined || env.MARKET_SOURCE === ''
      ? 'binance'
      : env.MARKET_SOURCE.trim();

  let rawSimulatorRate: number;
  if (env.SIMULATOR_RATE === undefined || env.SIMULATOR_RATE === '') {
    rawSimulatorRate = DEFAULT_SIMULATOR_RATE;
  } else {
    const trimmed = env.SIMULATOR_RATE.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid SIMULATOR_RATE: "${env.SIMULATOR_RATE}" is not a valid integer`);
    }
    rawSimulatorRate = Number(trimmed);
  }

  const result = ConfigSchema.safeParse({
    PAIRS: rawPairs,
    MARKET_SOURCE: rawMarketSource,
    SIMULATOR_RATE: rawSimulatorRate,
  });

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const field = firstIssue?.path[0] ?? 'CONFIG';
    throw new Error(`Invalid ${String(field)}: ${firstIssue?.message ?? 'configuration error'}`);
  }

  return result.data;
}
