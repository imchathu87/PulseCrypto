import { Linter } from 'eslint';
import config from './eslint.config.js';

// Proves `no-explicit-any` is an error for mobile source by running the real flat config through
// ESLint's synchronous Linter. (ESLint's config loader uses dynamic import, which Jest's VM rejects.)
// The fixture is an inline string under a virtual path, so nothing on disk violates the rule.
test('rejects an explicit any in mobile source', () => {
  const messages = new Linter({ configType: 'flat' }).verify(
    'export const x: any = 1;\n',
    config,
    'src/x.tsx',
  );
  const errors = messages.filter((m) => m.ruleId === '@typescript-eslint/no-explicit-any');
  expect(errors).toHaveLength(1);
  expect(errors[0]?.severity).toBe(2);
});
