import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeServerMessage } from './decode.ts';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const wsDocPath = `${projectRoot}/docs/contracts/websocket-protocol.md`;

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

describe('decodeServerMessage', () => {
  const wsDoc = fs.readFileSync(wsDocPath, 'utf8');
  const wsSection9 = wsDoc
    .split(/## 9\. Examples/)[1]!
    .split(/## 10\. Invalid cases/)[0]!;
  const wsBlocks = extractJsonBlocks(wsSection9);

  // Server message examples from §9:
  // 9.1: market.snapshot (index 0)
  // 9.2: market.status (index 1)
  // 9.3: market.batch (index 2)
  // 9.4 second: market.status (index 4)
  // 9.5: error (index 5)
  // 9.6: market.status (index 6)
  const serverExampleIndices = [0, 1, 2, 4, 5, 6];

  it('Full decode, valid: decodes any §9 server example in full mode and strips unknown keys', () => {
    for (const idx of serverExampleIndices) {
      const raw = JSON.parse(wsBlocks[idx]!);
      const rawWithExtra = { ...raw, extraField: 'should_be_stripped' };

      const result = decodeServerMessage(rawWithExtra, 'full');
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.message.type).toBe(raw.type);
        expect(result.message.v).toBe(1);
        expect('extraField' in result.message).toBe(false);
      }
    }
  });

  it('Envelope decode, valid: decodes any §9 server example in envelope mode checking only v, type in server types, and t', () => {
    for (const idx of serverExampleIndices) {
      const raw = JSON.parse(wsBlocks[idx]!);
      const result = decodeServerMessage(raw, 'envelope');
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.message.type).toBe(raw.type);
        expect(result.message.v).toBe(1);
        expect(result.message.t).toBe(raw.t);
      }
    }
  });

  it('Full decode, bad body: market.batch with pairs: [] returns kind: invalid with type and error without throwing', () => {
    const badBatch = {
      v: 1,
      type: 'market.batch',
      t: 1789765834200,
      pairs: [],
    };

    const result = decodeServerMessage(badBatch, 'full');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.type).toBe('market.batch');
      expect(result.error).toBeDefined();
    }
  });

  it('Envelope decode, bad body: market.batch with pairs: [] returns kind: ok (body unchecked by design)', () => {
    const badBatch = {
      v: 1,
      type: 'market.batch',
      t: 1789765834200,
      pairs: [],
    };

    const result = decodeServerMessage(badBatch, 'envelope');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.message.type).toBe('market.batch');
    }
  });

  it('Version mismatch: { v: 2, ... } returns kind: incompatible in both full and envelope modes without throwing', () => {
    const futureMessage = {
      v: 2,
      type: 'market.snapshot',
      t: 1789765834100,
      pairs: [],
    };

    const fullResult = decodeServerMessage(futureMessage, 'full');
    expect(fullResult).toEqual({ kind: 'incompatible', v: 2 });

    const envResult = decodeServerMessage(futureMessage, 'envelope');
    expect(envResult).toEqual({ kind: 'incompatible', v: 2 });
  });

  it('Not an envelope: null, string, array, object without v, unknown type, non-integer t return kind: invalid', () => {
    const invalidInputs: unknown[] = [
      null,
      'x',
      [],
      {},
      { type: 'market.snapshot', t: 123 }, // missing v
      { v: 1, type: 'client.subscribe', t: 123 }, // unknown type
      { v: 1, type: 'market.status', t: 123.45 }, // non-integer t
      { v: 1.5, type: 'market.snapshot', t: 123 }, // non-integer float v
      { v: Number.NaN, type: 'market.snapshot', t: 123 }, // NaN v
    ];

    for (const input of invalidInputs) {
      const fullRes = decodeServerMessage(input, 'full');
      expect(fullRes.kind).toBe('invalid');

      const envRes = decodeServerMessage(input, 'envelope');
      expect(envRes.kind).toBe('invalid');
    }
  });

  it('retains rawType when object lacks v or has non-integer v', () => {
    const missingV = { type: 'market.snapshot', t: 123 };
    const fullRes = decodeServerMessage(missingV, 'full');
    expect(fullRes).toMatchObject({ kind: 'invalid', type: 'market.snapshot' });

    const envRes = decodeServerMessage(missingV, 'envelope');
    expect(envRes).toMatchObject({ kind: 'invalid', type: 'market.snapshot' });

    const floatV = { v: 1.5, type: 'market.batch', t: 123 };
    expect(decodeServerMessage(floatV, 'full')).toMatchObject({
      kind: 'invalid',
      type: 'market.batch',
    });
    expect(decodeServerMessage(floatV, 'envelope')).toMatchObject({
      kind: 'invalid',
      type: 'market.batch',
    });
  });
});
