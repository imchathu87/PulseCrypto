import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const contractsRoot = fileURLToPath(new URL('..', import.meta.url));

describe('contracts lint purity rules', () => {
  const eslint = new ESLint({ cwd: contractsRoot });

  async function lint(code: string, filePath: string) {
    const [result] = await eslint.lintText(code, { filePath });
    return result?.messages ?? [];
  }

  it('rejects an explicit any in contracts source', async () => {
    const messages = await lint('export const x: any = 1;\n', 'src/x.ts');
    const errors = messages.filter(
      (m) => m.ruleId === '@typescript-eslint/no-explicit-any',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe(2);
  });

  it('forbids node and I/O imports in source, but allows them in test files', async () => {
    const sourceMessages = await lint(
      "import fs from 'node:fs';\nexport const x = fs;\n",
      'src/x.ts',
    );
    expect(
      sourceMessages.some((m) => m.ruleId === 'no-restricted-imports'),
    ).toBe(true);

    const testMessages = await lint(
      "import fs from 'node:fs';\nexport const x = fs;\n",
      'src/x.test.ts',
    );
    expect(
      testMessages.some((m) => m.ruleId === 'no-restricted-imports'),
    ).toBe(false);
  });

  it('forbids timers in source, but allows them in test files', async () => {
    const sourceMessages = await lint(
      'setTimeout(() => {}, 100);\n',
      'src/x.ts',
    );
    expect(
      sourceMessages.some(
        (m) =>
          m.ruleId === 'no-restricted-globals' &&
          m.message.includes('setTimeout'),
      ),
    ).toBe(true);

    const testMessages = await lint(
      'setTimeout(() => {}, 100);\n',
      'src/x.test.ts',
    );
    expect(
      testMessages.some((m) => m.ruleId === 'no-restricted-globals'),
    ).toBe(false);
  });

  it('forbids network globals in source, but allows them in test files', async () => {
    const sourceMessages = await lint(
      'export const f = () => fetch("http://localhost");\n',
      'src/x.ts',
    );
    expect(
      sourceMessages.some(
        (m) =>
          m.ruleId === 'no-restricted-globals' && m.message.includes('fetch'),
      ),
    ).toBe(true);

    const testMessages = await lint(
      'export const f = () => fetch("http://localhost");\n',
      'src/x.test.ts',
    );
    expect(
      testMessages.some((m) => m.ruleId === 'no-restricted-globals'),
    ).toBe(false);
  });

  it('forbids process and __DEV__ in source, but allows in test files', async () => {
    const sourceProcess = await lint('export const p = process;\n', 'src/x.ts');
    expect(
      sourceProcess.some(
        (m) =>
          m.ruleId === 'no-restricted-globals' && m.message.includes('process'),
      ),
    ).toBe(true);

    const sourceDev = await lint('export const d = __DEV__;\n', 'src/x.ts');
    expect(
      sourceDev.some(
        (m) =>
          m.ruleId === 'no-restricted-globals' && m.message.includes('__DEV__'),
      ),
    ).toBe(true);

    const testProcess = await lint(
      'export const p = process;\n',
      'src/x.test.ts',
    );
    expect(testProcess.some((m) => m.ruleId === 'no-restricted-globals')).toBe(
      false,
    );
  });

  it('forbids top-level let and var, but allows inner let in functions and allows in tests', async () => {
    const sourceTopLet = await lint('let count = 0;\n', 'src/x.ts');
    expect(
      sourceTopLet.some((m) => m.ruleId === 'no-restricted-syntax'),
    ).toBe(true);

    const sourceTopVar = await lint('var count = 0;\n', 'src/x.ts');
    expect(
      sourceTopVar.some((m) => m.ruleId === 'no-restricted-syntax'),
    ).toBe(true);

    const sourceInnerLet = await lint(
      'export function getCount() { let count = 0; return count; }\n',
      'src/x.ts',
    );
    expect(
      sourceInnerLet.some((m) => m.ruleId === 'no-restricted-syntax'),
    ).toBe(false);

    const testTopLet = await lint('let count = 0;\n', 'src/x.test.ts');
    expect(testTopLet.some((m) => m.ruleId === 'no-restricted-syntax')).toBe(
      false,
    );
  });
});
