import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ClientMessageSchema,
  ClientSetIntervalMessageSchema,
  ErrorMessageSchema,
  MarketBatchMessageSchema,
  MarketStatusMessageSchema,
  PairMetaSchema,
  PairsMetaResponseSchema,
  PairSnapshotSchema,
  ServerMessageSchema,
  type PairSnapshot,
} from './index.ts';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const wsDocPath = `${projectRoot}/docs/contracts/websocket-protocol.md`;
const restDocPath = `${projectRoot}/docs/contracts/rest-api.md`;

function extractTableCaseNames(markdownSection: string): string[] {
  const lines = markdownSection.split('\n');
  const caseNames: string[] = [];
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('|') &&
      trimmed.includes('Case') &&
      trimmed.includes('Example fragment')
    ) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (!trimmed.startsWith('|')) {
        inTable = false;
        continue;
      }
      if (trimmed.includes('---')) continue;
      const parts = trimmed
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 2 && parts[0]) {
        caseNames.push(parts[0]);
      }
    }
  }
  return caseNames;
}

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

describe('Contract invalid cases from documentation', () => {
  const wsDoc = fs.readFileSync(wsDocPath, 'utf8');
  const restDoc = fs.readFileSync(restDocPath, 'utf8');

  const wsSection9 = wsDoc
    .split(/## 9\. Examples/)[1]!
    .split(/## 10\. Invalid cases/)[0]!;
  const wsBlocks = extractJsonBlocks(wsSection9);

  const wsSection10 = wsDoc
    .split(/## 10\. Invalid cases/)[1]!
    .split(/## 11\./)[0]!;
  const docWsCases = extractTableCaseNames(wsSection10);

  const restSection2 = restDoc
    .split(/## 2\./)[1]!
    .split(/## 3\./)[0]!;
  const restBlocks = extractJsonBlocks(restSection2);
  const restInvalidSection = restDoc
    .split(/### Invalid cases/)[1]!
    .split(/### Client/)[0]!;
  const docRestCases = extractTableCaseNames(restInvalidSection);

  // Doc examples used as baselines for mutations
  const snapshotExample = JSON.parse(wsBlocks[0]!);
  const btcSnapshot: PairSnapshot = snapshotExample.pairs[0];
  const statusExample = JSON.parse(wsBlocks[1]!);
  const batchExample = JSON.parse(wsBlocks[2]!);
  const setIntervalExample = JSON.parse(wsBlocks[3]!);
  const errorExample = JSON.parse(wsBlocks[5]!);
  const restMetaExample = JSON.parse(restBlocks[0]!);
  const restPair = restMetaExample.pairs[0];

  const testedWsCases = [
    '`client.setInterval` out of range',
    '`client.setInterval` not an integer',
    'Unknown message `type`',
    'Lower-case or empty pair',
    'More than 20 levels on a side',
    'Malformed level',
    'Nullable field omitted',
    'Pressure out of range',
    'Non-integer time or `rev`',
    '`market.batch` with no pairs',
    'Unknown `source`',
    'Unknown error code',
  ];

  const testedRestCases = [
    'Unknown trading status',
    'Non-integer or out-of-range precision',
    'Nullable stat omitted',
    'Lower-case pair',
    'Missing `pairs` wrapper',
  ];

  it('guard test: asserts doc tables case names equal tested cases set', () => {
    expect(docWsCases).toEqual(testedWsCases);
    expect(docRestCases).toEqual(testedRestCases);
  });

  describe('WebSocket §10 invalid cases', () => {
    it('`client.setInterval` out of range', () => {
      expect(
        ClientSetIntervalMessageSchema.safeParse({
          ...setIntervalExample,
          intervalMs: 5,
        }).success,
      ).toBe(false);

      expect(
        ClientSetIntervalMessageSchema.safeParse({
          ...setIntervalExample,
          intervalMs: 1001,
        }).success,
      ).toBe(false);

      // Boundary accepts: 10 and 1000
      expect(
        ClientSetIntervalMessageSchema.safeParse({
          ...setIntervalExample,
          intervalMs: 10,
        }).success,
      ).toBe(true);

      expect(
        ClientSetIntervalMessageSchema.safeParse({
          ...setIntervalExample,
          intervalMs: 1000,
        }).success,
      ).toBe(true);
    });

    it('`client.setInterval` not an integer', () => {
      expect(
        ClientSetIntervalMessageSchema.safeParse({
          ...setIntervalExample,
          intervalMs: 250.5,
        }).success,
      ).toBe(false);

      expect(
        ClientSetIntervalMessageSchema.safeParse({
          ...setIntervalExample,
          intervalMs: '250',
        }).success,
      ).toBe(false);

      const { intervalMs: _unusedIntervalMs, ...missing } = setIntervalExample;
      void _unusedIntervalMs;
      expect(ClientSetIntervalMessageSchema.safeParse(missing).success).toBe(
        false,
      );
    });

    it('Unknown message `type`', () => {
      expect(
        ClientMessageSchema.safeParse({
          v: 1,
          type: 'client.subscribe',
        }).success,
      ).toBe(false);

      expect(
        ServerMessageSchema.safeParse({
          v: 1,
          type: 'client.subscribe',
          t: 1789765834100,
        }).success,
      ).toBe(false);
    });

    it('Lower-case or empty pair', () => {
      expect(
        PairSnapshotSchema.safeParse({
          ...btcSnapshot,
          pair: 'btcusdt',
        }).success,
      ).toBe(false);

      expect(
        PairSnapshotSchema.safeParse({
          ...btcSnapshot,
          pair: '',
        }).success,
      ).toBe(false);
    });

    it('More than 20 levels on a side', () => {
      const twentyOneBids = Array.from({ length: 21 }, (_, i) => [
        80000 - i,
        1,
      ]);
      expect(
        PairSnapshotSchema.safeParse({
          ...btcSnapshot,
          bids: twentyOneBids,
        }).success,
      ).toBe(false);
    });

    it('Malformed level', () => {
      const malformedLevels: unknown[] = [
        [81199.5],
        [81199.5, 1.2, 0],
        { p: 81199.5, q: 1.2 },
        [0, 1],
        [81199.5, -1],
      ];

      for (const level of malformedLevels) {
        expect(
          PairSnapshotSchema.safeParse({
            ...btcSnapshot,
            bids: [level],
          }).success,
        ).toBe(false);
      }
    });

    it('Nullable field omitted', () => {
      const { spread: _unusedSpread, ...noSpread } = btcSnapshot;
      void _unusedSpread;
      expect(PairSnapshotSchema.safeParse(noSpread).success).toBe(false);
    });

    it('Pressure out of range', () => {
      expect(
        PairSnapshotSchema.safeParse({
          ...btcSnapshot,
          buyPressure: 100.5,
        }).success,
      ).toBe(false);

      expect(
        PairSnapshotSchema.safeParse({
          ...btcSnapshot,
          buyPressure: -1,
        }).success,
      ).toBe(false);

      expect(
        PairSnapshotSchema.safeParse({
          ...btcSnapshot,
          sellPressure: 100.5,
        }).success,
      ).toBe(false);

      expect(
        PairSnapshotSchema.safeParse({
          ...btcSnapshot,
          sellPressure: -1,
        }).success,
      ).toBe(false);
    });

    it('Non-integer time or `rev`', () => {
      expect(
        PairSnapshotSchema.safeParse({
          ...btcSnapshot,
          timestamp: 1789765834020.5,
        }).success,
      ).toBe(false);

      expect(
        PairSnapshotSchema.safeParse({
          ...btcSnapshot,
          rev: -1,
        }).success,
      ).toBe(false);

      expect(
        PairSnapshotSchema.safeParse({
          ...btcSnapshot,
          rev: 1.5,
        }).success,
      ).toBe(false);
    });

    it('`market.batch` with no pairs', () => {
      expect(
        MarketBatchMessageSchema.safeParse({
          ...batchExample,
          pairs: [],
        }).success,
      ).toBe(false);
    });

    it('Unknown `source`', () => {
      expect(
        MarketStatusMessageSchema.safeParse({
          ...statusExample,
          source: 'coinbase',
        }).success,
      ).toBe(false);
    });

    it('Unknown error code', () => {
      expect(
        ErrorMessageSchema.safeParse({
          ...errorExample,
          code: 'RATE_LIMITED',
        }).success,
      ).toBe(false);
    });
  });

  describe('REST API invalid cases', () => {
    it('Unknown trading status', () => {
      expect(
        PairMetaSchema.safeParse({
          ...restPair,
          tradingStatus: 'BREAK',
        }).success,
      ).toBe(false);
    });

    it('Non-integer or out-of-range precision', () => {
      expect(
        PairMetaSchema.safeParse({
          ...restPair,
          pricePrecision: 2.5,
        }).success,
      ).toBe(false);

      expect(
        PairMetaSchema.safeParse({
          ...restPair,
          pricePrecision: -1,
        }).success,
      ).toBe(false);

      expect(
        PairMetaSchema.safeParse({
          ...restPair,
          quantityPrecision: 9,
        }).success,
      ).toBe(false);

      // Boundary accepts: 0 and 8
      expect(
        PairMetaSchema.safeParse({
          ...restPair,
          pricePrecision: 0,
          quantityPrecision: 0,
        }).success,
      ).toBe(true);

      expect(
        PairMetaSchema.safeParse({
          ...restPair,
          pricePrecision: 8,
          quantityPrecision: 8,
        }).success,
      ).toBe(true);
    });

    it('Nullable stat omitted', () => {
      const { high24h: _unusedHigh, ...noHigh } = restPair;
      void _unusedHigh;
      expect(PairMetaSchema.safeParse(noHigh).success).toBe(false);
    });

    it('Lower-case pair', () => {
      expect(
        PairMetaSchema.safeParse({
          ...restPair,
          pair: 'btcusdt',
        }).success,
      ).toBe(false);
    });

    it('Missing `pairs` wrapper', () => {
      expect(PairsMetaResponseSchema.safeParse(restMetaExample.pairs).success).toBe(
        false,
      );
    });
  });
});
