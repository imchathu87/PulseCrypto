import { z } from 'zod';
import { PROTOCOL_VERSION } from './constants.ts';
import {
  ServerEnvelopeSchema,
  ServerMessageSchema,
  type ServerMessage,
} from './ws-messages.ts';

export type DecodeResult =
  | { kind: 'ok'; message: ServerMessage }
  | { kind: 'incompatible'; v: number }
  | { kind: 'invalid'; type: string | null; error: z.ZodError };

export function decodeServerMessage(
  raw: unknown,
  mode: 'full' | 'envelope',
): DecodeResult {
  const isObject =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw);
  const rawType =
    isObject && 'type' in raw && typeof raw.type === 'string' ? raw.type : null;

  if (!isObject || !('v' in raw)) {
    const envelopeCheck = z
      .object({ v: z.literal(PROTOCOL_VERSION) })
      .safeParse(raw);
    return {
      kind: 'invalid',
      type: rawType,
      error: envelopeCheck.error ?? new z.ZodError([]),
    };
  }

  if (typeof raw.v !== 'number' || !Number.isInteger(raw.v)) {
    const envelopeCheck = z
      .object({ v: z.literal(PROTOCOL_VERSION) })
      .safeParse(raw);
    return {
      kind: 'invalid',
      type: rawType,
      error: envelopeCheck.error ?? new z.ZodError([]),
    };
  }

  if (raw.v !== PROTOCOL_VERSION) {
    return {
      kind: 'incompatible',
      v: raw.v,
    };
  }

  if (mode === 'full') {
    const result = ServerMessageSchema.safeParse(raw);
    if (!result.success) {
      return {
        kind: 'invalid',
        type: rawType,
        error: result.error,
      };
    }
    return {
      kind: 'ok',
      message: result.data,
    };
  }

  const envelopeResult = ServerEnvelopeSchema.safeParse(raw);
  if (!envelopeResult.success) {
    return {
      kind: 'invalid',
      type: rawType,
      error: envelopeResult.error,
    };
  }

  // Sole permitted cast of external data in the repository (AGENTS.md, ADR-006, engineering-standards §6).
  return {
    kind: 'ok',
    message: raw as ServerMessage,
  };
}
