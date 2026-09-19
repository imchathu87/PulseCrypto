import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Proves `no-explicit-any` is an error for contracts source, through the ESLint Node API.
// The fixture is an inline string under a virtual path, so nothing on disk violates the rule.
const contractsRoot = fileURLToPath(new URL('..', import.meta.url));

describe('no-explicit-any', () => {
  it('rejects an explicit any in contracts source', async () => {
    const eslint = new ESLint({ cwd: contractsRoot });
    const [result] = await eslint.lintText('export const x: any = 1;\n', { filePath: 'src/x.ts' });
    const errors = (result?.messages ?? []).filter(
      (m) => m.ruleId === '@typescript-eslint/no-explicit-any',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.severity).toBe(2);
  });
});
