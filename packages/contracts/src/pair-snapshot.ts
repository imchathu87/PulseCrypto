import { z } from 'zod';
import { MAX_LEVELS } from './constants.ts';

export const PairSchema = z.string().regex(/^[A-Z0-9]+$/);
export type Pair = z.infer<typeof PairSchema>;

export const OrderBookLevelSchema = z.tuple([
  z.number().positive(),
  z.number().positive(),
]);
export type OrderBookLevel = z.infer<typeof OrderBookLevelSchema>;

export const PairSnapshotSchema = z.object({
  pair: PairSchema,
  rev: z.int().min(0),

  // time (§6)
  timestamp: z.int().nullable(),
  lastDepthAt: z.int().nullable(),
  lastTickerAt: z.int().nullable(),

  // ticker group: from <pair>@ticker
  price: z.number().nullable(),
  change24hPct: z.number().nullable(),
  high24h: z.number().nullable(),
  low24h: z.number().nullable(),
  volume24h: z.number().nullable(),

  // book group: from <pair>@depth20@100ms
  bids: z.array(OrderBookLevelSchema).max(MAX_LEVELS),
  asks: z.array(OrderBookLevelSchema).max(MAX_LEVELS),
  spread: z.number().nullable(),
  buyPressure: z.number().min(0).max(100).nullable(),
  sellPressure: z.number().min(0).max(100).nullable(),
});
export type PairSnapshot = z.infer<typeof PairSnapshotSchema>;
