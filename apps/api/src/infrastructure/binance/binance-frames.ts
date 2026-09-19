import { z } from 'zod';
import { isValidBook } from '../../domain/book.ts';
import type {
  DepthUpdate,
  OrderBookLevel,
  Pair,
  TickerUpdate,
} from '../../domain/market-event.ts';

const POSITIVE_DECIMAL_REGEX = /^\d+(\.\d+)?$/;
const SIGNED_DECIMAL_REGEX = /^[+-]?\d+(\.\d+)?$/;

export interface StreamEntry {
  readonly pair: Pair;
  readonly type: 'depth' | 'ticker';
}

export type StreamTable = ReadonlyMap<string, StreamEntry>;

export function buildStreamTable(pairs: readonly Pair[]): StreamTable {
  const table = new Map<string, StreamEntry>();
  for (const pair of pairs) {
    const lower = pair.toLowerCase();
    table.set(`${lower}@depth20@100ms`, { pair, type: 'depth' });
    table.set(`${lower}@ticker`, { pair, type: 'ticker' });
  }
  return table;
}

const StreamEnvelopeSchema = z.object({
  stream: z.string(),
  data: z.unknown(),
});

const DepthPayloadSchema = z.object({
  lastUpdateId: z.number(),
  bids: z.array(z.tuple([z.string(), z.string()])),
  asks: z.array(z.tuple([z.string(), z.string()])),
});

const TickerPayloadSchema = z.object({
  c: z.string(),
  P: z.string(),
  h: z.string(),
  l: z.string(),
  q: z.string(),
});

function parsePositiveDecimal(value: string): number | null {
  if (!POSITIVE_DECIMAL_REGEX.test(value)) {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return num;
}

function parseSignedDecimal(value: string): number | null {
  if (!SIGNED_DECIMAL_REGEX.test(value)) {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num;
}

export function normalizeFrame(
  raw: unknown,
  table: StreamTable,
  receivedAt: number,
): DepthUpdate | TickerUpdate | null {
  let parsedJson: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const envelopeResult = StreamEnvelopeSchema.safeParse(parsedJson);
  if (!envelopeResult.success) {
    return null;
  }

  const entry = table.get(envelopeResult.data.stream);
  if (!entry) {
    return null;
  }

  if (entry.type === 'depth') {
    const depthResult = DepthPayloadSchema.safeParse(envelopeResult.data.data);
    if (!depthResult.success) {
      return null;
    }

    const bids: OrderBookLevel[] = [];
    for (const [pStr, qStr] of depthResult.data.bids) {
      const price = parsePositiveDecimal(pStr);
      const qty = parsePositiveDecimal(qStr);
      if (price === null || qty === null) {
        return null;
      }
      bids.push([price, qty]);
    }

    const asks: OrderBookLevel[] = [];
    for (const [pStr, qStr] of depthResult.data.asks) {
      const price = parsePositiveDecimal(pStr);
      const qty = parsePositiveDecimal(qStr);
      if (price === null || qty === null) {
        return null;
      }
      asks.push([price, qty]);
    }

    if (!isValidBook(bids, asks)) {
      return null;
    }

    return {
      kind: 'depth',
      pair: entry.pair,
      receivedAt,
      bids,
      asks,
    };
  }

  if (entry.type === 'ticker') {
    const tickerResult = TickerPayloadSchema.safeParse(envelopeResult.data.data);
    if (!tickerResult.success) {
      return null;
    }

    const price = parsePositiveDecimal(tickerResult.data.c);
    const change24hPct = parseSignedDecimal(tickerResult.data.P);
    const high24h = parsePositiveDecimal(tickerResult.data.h);
    const low24h = parsePositiveDecimal(tickerResult.data.l);
    const volume24h = parsePositiveDecimal(tickerResult.data.q);

    if (
      price === null ||
      change24hPct === null ||
      high24h === null ||
      low24h === null ||
      volume24h === null
    ) {
      return null;
    }

    return {
      kind: 'ticker',
      pair: entry.pair,
      receivedAt,
      price,
      change24hPct,
      high24h,
      low24h,
      volume24h,
    };
  }

  return null;
}
