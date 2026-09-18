import { z } from 'zod';

export const MarketSnapshotSchema = z.object({
  pair: z.string(),
  price: z.number(),
  lastUpdated: z.number(),
});

export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
