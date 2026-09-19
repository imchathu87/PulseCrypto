import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ClientMessageSchema,
  ClientSetIntervalMessageSchema,
  ErrorMessageSchema,
  HealthResponseSchema,
  MarketBatchMessageSchema,
  MarketSnapshotMessageSchema,
  MarketStatusMessageSchema,
  PairsMetaResponseSchema,
  ServerMessageSchema,
} from './index.ts';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const wsDocPath = `${projectRoot}/docs/contracts/websocket-protocol.md`;
const restDocPath = `${projectRoot}/docs/contracts/rest-api.md`;

function extractJsonBlocks(markdown: string): string[] {
  const matches: string[] = [];
  const regex = /```json\s*([\s\S]*?)\s*```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    if (match[1]) {
      matches.push(match[1].trim());
    }
  }
  return matches;
}

describe('Contract examples from documentation', () => {
  const wsDoc = fs.readFileSync(wsDocPath, 'utf8');
  const restDoc = fs.readFileSync(restDocPath, 'utf8');

  const wsSection9 = wsDoc
    .split(/## 9\. Examples/)[1]!
    .split(/## 10\. Invalid cases/)[0]!;
  const wsBlocks = extractJsonBlocks(wsSection9);

  const restSection2 = restDoc
    .split(/## 2\./)[1]!
    .split(/## 3\./)[0]!;
  const restSection2Blocks = extractJsonBlocks(restSection2);

  const restSection3 = restDoc
    .split(/## 3\./)[1]!
    .split(/## 4\./)[0]!;
  const restSection3Blocks = extractJsonBlocks(restSection3);

  it('guard test: asserts exact example block counts (7 in WS §9, 1 in REST §2, 1 in REST §3)', () => {
    expect(wsBlocks).toHaveLength(7);
    expect(restSection2Blocks).toHaveLength(1);
    expect(restSection3Blocks).toHaveLength(1);
  });

  it('parses 9.1 market.snapshot example against MarketSnapshotMessageSchema and ServerMessageSchema', () => {
    const raw = JSON.parse(wsBlocks[0]!);
    expect(raw.type).toBe('market.snapshot');
    const parsed = MarketSnapshotMessageSchema.parse(raw);
    expect(parsed.pairs).toHaveLength(2);
    expect(ServerMessageSchema.parse(raw)).toEqual(parsed);
  });

  it('parses 9.2 market.status example against MarketStatusMessageSchema and ServerMessageSchema', () => {
    const raw = JSON.parse(wsBlocks[1]!);
    expect(raw.type).toBe('market.status');
    const parsed = MarketStatusMessageSchema.parse(raw);
    expect(parsed.source).toBe('binance');
    expect(ServerMessageSchema.parse(raw)).toEqual(parsed);
  });

  it('parses 9.3 market.batch example against MarketBatchMessageSchema and ServerMessageSchema', () => {
    const raw = JSON.parse(wsBlocks[2]!);
    expect(raw.type).toBe('market.batch');
    const parsed = MarketBatchMessageSchema.parse(raw);
    expect(parsed.pairs).toHaveLength(2);
    expect(ServerMessageSchema.parse(raw)).toEqual(parsed);
  });

  it('parses 9.4 client.setInterval example against ClientSetIntervalMessageSchema and ClientMessageSchema', () => {
    const raw = JSON.parse(wsBlocks[3]!);
    expect(raw.type).toBe('client.setInterval');
    const parsed = ClientSetIntervalMessageSchema.parse(raw);
    expect(parsed.intervalMs).toBe(250);
    expect(ClientMessageSchema.parse(raw)).toEqual(parsed);
  });

  it('parses 9.4 market.status ack example against MarketStatusMessageSchema and ServerMessageSchema', () => {
    const raw = JSON.parse(wsBlocks[4]!);
    expect(raw.type).toBe('market.status');
    const parsed = MarketStatusMessageSchema.parse(raw);
    expect(parsed.intervalMs).toBe(250);
    expect(ServerMessageSchema.parse(raw)).toEqual(parsed);
  });

  it('parses 9.5 error example against ErrorMessageSchema and ServerMessageSchema', () => {
    const raw = JSON.parse(wsBlocks[5]!);
    expect(raw.type).toBe('error');
    const parsed = ErrorMessageSchema.parse(raw);
    expect(parsed.code).toBe('BAD_REQUEST');
    expect(ServerMessageSchema.parse(raw)).toEqual(parsed);
  });

  it('parses 9.6 upstream lost market.status example against MarketStatusMessageSchema and ServerMessageSchema', () => {
    const raw = JSON.parse(wsBlocks[6]!);
    expect(raw.type).toBe('market.status');
    const parsed = MarketStatusMessageSchema.parse(raw);
    expect(parsed.upstream.connected).toBe(false);
    expect(ServerMessageSchema.parse(raw)).toEqual(parsed);
  });

  it('parses rest-api.md §2 GET /pairs/meta example against PairsMetaResponseSchema', () => {
    const raw = JSON.parse(restSection2Blocks[0]!);
    const parsed = PairsMetaResponseSchema.parse(raw);
    expect(parsed.pairs.length).toBeGreaterThan(0);
    expect(parsed.pairs[0]?.displayName).toBe('BTC / USDT');
  });

  it('parses rest-api.md §3 GET /health example against HealthResponseSchema', () => {
    const raw = JSON.parse(restSection3Blocks[0]!);
    const parsed = HealthResponseSchema.parse(raw);
    expect(parsed.status).toBe('ok');
    expect(parsed.counters['upstream.frames.received']).toBe(1873);
  });
});
