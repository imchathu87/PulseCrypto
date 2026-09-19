import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DISPLAY_LEVELS as CONTRACTS_DISPLAY_LEVELS } from '@pulsecrypto/contracts';
import { DISPLAY_LEVELS as DOMAIN_DISPLAY_LEVELS } from '../src/domain/pair-state.ts';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));

function collectTsFiles(dirPath: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.mts'))) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('domain boundaries and constants conformance', () => {
  it('pinned constant: domain DISPLAY_LEVELS matches contracts DISPLAY_LEVELS', () => {
    expect(DOMAIN_DISPLAY_LEVELS).toBe(CONTRACTS_DISPLAY_LEVELS);
    expect(DOMAIN_DISPLAY_LEVELS).toBe(10);
  });

  it('no file name matches /binance/i under src/domain and src/application', () => {
    const domainDir = path.join(apiRoot, 'src/domain');
    const applicationDir = path.join(apiRoot, 'src/application');

    const files = [...collectTsFiles(domainDir), ...collectTsFiles(applicationDir)];
    for (const filePath of files) {
      const fileName = path.basename(filePath);
      expect(fileName).not.toMatch(/binance/i);
    }
  });

  it('no TypeScript Identifier token matches /binance/i under src/domain and src/application', () => {
    const domainDir = path.join(apiRoot, 'src/domain');
    const applicationDir = path.join(apiRoot, 'src/application');

    const files = [...collectTsFiles(domainDir), ...collectTsFiles(applicationDir)];
    const forbiddenIdentifierViolations: { file: string; identifier: string }[] = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        /* skipTrivia */ true,
        ts.LanguageVariant.Standard,
        content,
      );

      let token = scanner.scan();
      while (token !== ts.SyntaxKind.EndOfFileToken) {
        if (token === ts.SyntaxKind.Identifier) {
          const text = scanner.getTokenText();
          if (/binance/i.test(text)) {
            forbiddenIdentifierViolations.push({
              file: path.relative(apiRoot, filePath),
              identifier: text,
            });
          }
        }
        token = scanner.scan();
      }
    }

    expect(forbiddenIdentifierViolations).toEqual([]);
  });
});
