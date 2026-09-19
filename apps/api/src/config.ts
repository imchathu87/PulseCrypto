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
export const DEFAULT_BINANCE_WS_URL = 'wss://stream.binance.com:9443';
export const DEFAULT_UPSTREAM_SILENCE_MS = 10000;
export const DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS = 10000;

export interface AppConfig {
  readonly PAIRS: readonly Pair[];
  readonly MARKET_SOURCE: 'binance' | 'simulator';
  readonly SIMULATOR_RATE: number;
  readonly BINANCE_WS_URL: string;
  readonly UPSTREAM_SILENCE_MS: number;
  readonly UPSTREAM_CONNECT_TIMEOUT_MS: number;
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
    BINANCE_WS_URL: z
      .string()
      .url({ message: 'must be a valid URL' })
      .refine(
        (val) => {
          try {
            const u = new URL(val);
            return u.protocol === 'ws:' || u.protocol === 'wss:';
          } catch {
            return false;
          }
        },
        { message: 'must be a ws: or wss: URL' },
      ),
    UPSTREAM_SILENCE_MS: z
      .number({ message: 'must be a valid integer' })
      .int({ message: 'must be an integer' })
      .positive({ message: 'must be positive' }),
    UPSTREAM_CONNECT_TIMEOUT_MS: z
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

  const rawBinanceWsUrl =
    env.BINANCE_WS_URL === undefined || env.BINANCE_WS_URL === ''
      ? DEFAULT_BINANCE_WS_URL
      : env.BINANCE_WS_URL.trim();

  let rawUpstreamSilenceMs: number;
  if (env.UPSTREAM_SILENCE_MS === undefined || env.UPSTREAM_SILENCE_MS === '') {
    rawUpstreamSilenceMs = DEFAULT_UPSTREAM_SILENCE_MS;
  } else {
    const trimmed = env.UPSTREAM_SILENCE_MS.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`Invalid UPSTREAM_SILENCE_MS: "${env.UPSTREAM_SILENCE_MS}" is not a valid integer`);
    }
    rawUpstreamSilenceMs = Number(trimmed);
  }

  let rawUpstreamConnectTimeoutMs: number;
  if (env.UPSTREAM_CONNECT_TIMEOUT_MS === undefined || env.UPSTREAM_CONNECT_TIMEOUT_MS === '') {
    rawUpstreamConnectTimeoutMs = DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS;
  } else {
    const trimmed = env.UPSTREAM_CONNECT_TIMEOUT_MS.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(
        `Invalid UPSTREAM_CONNECT_TIMEOUT_MS: "${env.UPSTREAM_CONNECT_TIMEOUT_MS}" is not a valid integer`,
      );
    }
    rawUpstreamConnectTimeoutMs = Number(trimmed);
  }

  const result = ConfigSchema.safeParse({
    PAIRS: rawPairs,
    MARKET_SOURCE: rawMarketSource,
    SIMULATOR_RATE: rawSimulatorRate,
    BINANCE_WS_URL: rawBinanceWsUrl,
    UPSTREAM_SILENCE_MS: rawUpstreamSilenceMs,
    UPSTREAM_CONNECT_TIMEOUT_MS: rawUpstreamConnectTimeoutMs,
  });

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const field = firstIssue?.path[0] ?? 'CONFIG';
    throw new Error(`Invalid ${String(field)}: ${firstIssue?.message ?? 'configuration error'}`);
  }

  return result.data;
}
