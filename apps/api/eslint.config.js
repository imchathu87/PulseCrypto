import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Flat config replaces a rule's options per matching block, so the domain block below
// must restate this pattern alongside its own contracts restriction.
const concreteAdapterPattern = {
  group: ['**/infrastructure/binance/**', '**/infrastructure/simulator/**'],
  message: 'Depend on MarketDataSource, not a concrete adapter.',
};

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
    files: ['src/domain/**/*.{ts,mts,cts}', 'src/application/**/*.{ts,mts,cts}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [concreteAdapterPattern] }],
    },
  },
  {
    files: ['src/domain/**/*.{ts,mts,cts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            concreteAdapterPattern,
            {
              group: ['@pulsecrypto/contracts', '@pulsecrypto/contracts/**', '**/packages/contracts/**'],
              message:
                'Domain must not depend on the wire contract (@pulsecrypto/contracts); map PairState to PairSnapshot in presentation/.',
            },
          ],
        },
      ],
    },
  },
);
