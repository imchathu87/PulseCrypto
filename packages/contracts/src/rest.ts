import { z } from 'zod';
import { PairSchema } from './pair-snapshot.ts';

export const PairMetaSchema = z.object({
  pair: PairSchema,
  displayName: z.string(),
  tradingStatus: z.enum(['TRADING', 'HALTED']),
  high24h: z.number().nullable(),
  low24h: z.number().nullable(),
  volume24h: z.number().nullable(),
  pricePrecision: z.int().min(0).max(8),
  quantityPrecision: z.int().min(0).max(8),
});
export type PairMeta = z.infer<typeof PairMetaSchema>;

export const PairsMetaResponseSchema = z.object({
  pairs: z.array(PairMetaSchema),
});
export type PairsMetaResponse = z.infer<typeof PairsMetaResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  source: z.enum(['binance', 'simulator']),
  upstream: z.object({
    connected: z.boolean(),
    since: z.int().nullable(),
  }),
  uptimeMs: z.int().min(0),
  serverTime: z.int(),
  counters: z.object({
    'upstream.frames.received': z.int().min(0),
    'upstream.frames.invalid': z.int().min(0),
    'upstream.connect.failed': z.int().min(0),
    'upstream.reconnects': z.int().min(0),
    'buffer.mutations': z.int().min(0),
    'ws.frames.sent': z.int().min(0),
    'ws.frames.skipped': z.int().min(0),
    'ws.clients.active': z.int().min(0),
    'ws.clients.evicted': z.int().min(0),
    'ws.clients.timedOut': z.int().min(0),
  }),
  eventLoopDelayMs: z.object({
    mean: z.number().min(0),
    p50: z.number().min(0),
    p99: z.number().min(0),
    max: z.number().min(0),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
