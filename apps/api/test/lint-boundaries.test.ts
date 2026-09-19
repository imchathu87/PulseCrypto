import { fileURLToPath } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// Proves the layer-boundary and no-explicit-any rules in eslint.config.js through the ESLint
// Node API. Fixtures are inline strings linted under virtual file paths, so no rule-violating
// file exists anywhere `pnpm lint` scans.

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
// ESLint prefixes the configured message with "'<source>' import is restricted ...".
const ADAPTER_MESSAGE = 'Depend on MarketDataSource, not a concrete adapter.';
const CONTRACTS_MESSAGE =
  'Domain must not depend on the wire contract (@pulsecrypto/contracts); map PairState to PairSnapshot in presentation/.';

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: apiRoot });
});

async function lint(code: string, filePath: string): Promise<Linter.LintMessage[]> {
  const [result] = await eslint.lintText(code, { filePath });
  if (result === undefined) throw new Error(`ESLint returned no result for ${filePath}`);
  return result.messages;
}

function restrictedImports(messages: Linter.LintMessage[]): Linter.LintMessage[] {
  return messages.filter((m) => m.ruleId === 'no-restricted-imports');
}

describe('api layer boundaries', () => {
  it('rejects a domain import of the Binance adapter', async () => {
    const messages = await lint(
      "import { adapter } from '../infrastructure/binance/adapter';\nexport const x = adapter;\n",
      'src/domain/x.ts',
    );
    const errors = restrictedImports(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe(2);
    expect(errors[0]?.message).toContain(ADAPTER_MESSAGE);
  });

  it('rejects an application import of the simulator', async () => {
    const messages = await lint(
      "import { source } from '../infrastructure/simulator/source';\nexport const x = source;\n",
      'src/application/x.ts',
    );
    const errors = restrictedImports(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe(2);
    expect(errors[0]?.message).toContain(ADAPTER_MESSAGE);
  });

  it('rejects a domain import of @pulsecrypto/contracts', async () => {
    const messages = await lint(
      "import { MarketSnapshotSchema } from '@pulsecrypto/contracts';\nexport const x = MarketSnapshotSchema;\n",
      'src/domain/x.ts',
    );
    const errors = restrictedImports(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe(2);
    expect(errors[0]?.message).toContain(CONTRACTS_MESSAGE);
  });

  it('rejects a domain relative import of the contracts source', async () => {
    const messages = await lint(
      "import { MarketSnapshotSchema } from '../../../../packages/contracts/src/index.ts';\nexport const x = MarketSnapshotSchema;\n",
      'src/domain/x.ts',
    );
    const errors = restrictedImports(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe(2);
    expect(errors[0]?.message).toContain(CONTRACTS_MESSAGE);
  });

  it('rejects a domain .mts import of the Binance adapter', async () => {
    const messages = await lint(
      "import { adapter } from '../infrastructure/binance/adapter.ts';\nexport const x = adapter;\n",
      'src/domain/x.mts',
    );
    const errors = restrictedImports(messages);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain(ADAPTER_MESSAGE);
  });

  it('allows an application import of @pulsecrypto/contracts', async () => {
    const messages = await lint(
      "import { MarketSnapshotSchema } from '@pulsecrypto/contracts';\nexport const x = MarketSnapshotSchema;\n",
      'src/application/x.ts',
    );
    expect(messages).toEqual([]);
  });

  it('allows the composition root to import a concrete adapter', async () => {
    const messages = await lint(
      "import { adapter } from './infrastructure/binance/adapter';\nexport const x = adapter;\n",
      'src/composition-root.ts',
    );
    expect(messages).toEqual([]);
  });
});

describe('no-explicit-any', () => {
  it('rejects an explicit any in api source', async () => {
    const messages = await lint('export const x: any = 1;\n', 'src/x.ts');
    const errors = messages.filter((m) => m.ruleId === '@typescript-eslint/no-explicit-any');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe(2);
  });
});
