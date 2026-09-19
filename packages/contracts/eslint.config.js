import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fs',
                'fs/*',
                'http',
                'https',
                'net',
                'tls',
                'ws',
              ],
              message: 'Contracts must have no I/O, node, or network imports.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'setTimeout', message: 'Contracts must have no timers.' },
        { name: 'clearTimeout', message: 'Contracts must have no timers.' },
        { name: 'setInterval', message: 'Contracts must have no timers.' },
        { name: 'clearInterval', message: 'Contracts must have no timers.' },
        { name: 'setImmediate', message: 'Contracts must have no timers.' },
        { name: 'clearImmediate', message: 'Contracts must have no timers.' },
        { name: 'fetch', message: 'Contracts must have no network globals.' },
        { name: 'WebSocket', message: 'Contracts must have no network globals.' },
        { name: 'XMLHttpRequest', message: 'Contracts must have no network globals.' },
        { name: 'process', message: 'Contracts must have no process global.' },
        { name: '__DEV__', message: 'Contracts must not reference __DEV__.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(Program > VariableDeclaration, ExportNamedDeclaration > VariableDeclaration)[kind="let"]',
          message:
            'Contracts must have no top-level let declarations (no mutable module state).',
        },
        {
          selector: 'VariableDeclaration[kind="var"]',
          message: 'Contracts must have no var declarations.',
        },
      ],
    },
  },
);
