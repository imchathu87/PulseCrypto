import { z } from 'zod';
import {
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  PROTOCOL_VERSION,
} from './constants.ts';
import { PairSchema, PairSnapshotSchema } from './pair-snapshot.ts';

export type ServerMessageType =
  | 'market.snapshot'
  | 'market.batch'
  | 'market.status'
  | 'error';

export const SERVER_MESSAGE_TYPES: [ServerMessageType, ...ServerMessageType[]] = [
  'market.snapshot',
  'market.batch',
  'market.status',
  'error',
];

export const ServerEnvelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.enum(SERVER_MESSAGE_TYPES),
  t: z.int(),
});
export type ServerEnvelope = z.infer<typeof ServerEnvelopeSchema>;

export const ClientEnvelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.string(),
  t: z.int().exactOptional(),
});
export type ClientEnvelope = z.infer<typeof ClientEnvelopeSchema>;

export const MarketSnapshotMessageSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('market.snapshot'),
  t: z.int(),
  pairs: z.array(PairSnapshotSchema),
});
export type MarketSnapshotMessage = z.infer<typeof MarketSnapshotMessageSchema>;

export const MarketBatchMessageSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('market.batch'),
  t: z.int(),
  pairs: z.array(PairSnapshotSchema).min(1),
});
export type MarketBatchMessage = z.infer<typeof MarketBatchMessageSchema>;

export const MarketStatusMessageSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('market.status'),
  t: z.int(),
  source: z.enum(['binance', 'simulator']),
  upstream: z.object({
    connected: z.boolean(),
    since: z.int().nullable(),
  }),
  stalePairs: z.array(PairSchema),
  intervalMs: z.int().min(MIN_INTERVAL_MS).max(MAX_INTERVAL_MS),
  heartbeatMs: z.int().positive(),
  serverTime: z.int(),
});
export type MarketStatusMessage = z.infer<typeof MarketStatusMessageSchema>;

export const ErrorMessageSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('error'),
  t: z.int(),
  code: z.literal('BAD_REQUEST'),
  message: z.string(),
});
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

export const ClientSetIntervalMessageSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('client.setInterval'),
  t: z.int().exactOptional(),
  intervalMs: z.int().min(MIN_INTERVAL_MS).max(MAX_INTERVAL_MS),
});
export type ClientSetIntervalMessage = z.infer<
  typeof ClientSetIntervalMessageSchema
>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  MarketSnapshotMessageSchema,
  MarketBatchMessageSchema,
  MarketStatusMessageSchema,
  ErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ClientSetIntervalMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
