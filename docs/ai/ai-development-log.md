# AI development log

Record of review findings and decisions made while building PulseCrypto with AI assistance.
Every story appends to it (AR-36). A review finding that a human rejects is recorded here with
the reason (engineering-standards §9); accepted findings that changed a decision are recorded
too. The README's AI-tool section is summarised from this log (Story 3.2).

Only record what actually happened. An entry cites the evidence (file, command, spec) it rests on.

## Entry format

```
### YYYY-MM-DD · Story X.Y · <short title>

- **Finding:** what was observed, with file/command evidence.
- **Decision:** accepted / rejected / changed, and what was done.
- **Reason:** why, in one or two sentences.
```

## Entries

### 2026-09-19 · Story 1.1 · Node engine floor raised to 22.13

- **Finding:** Story 1.1 and ADR-012 specified `engines.node` `>=22.4 <23`, but the locked
  ESLint 10.10.0 declares `engines.node` `^20.19.0 || ^22.13.0 || >=24`
  (`node_modules/eslint/package.json`). Node 22.4–22.12 cannot run the lint gate.
- **Decision:** changed (human, 2026-09-19). Root `engines.node` is `>=22.13 <23`; ADR-012 and
  `epics.md` Story 1.1 were updated in the same change.
- **Reason:** a floor below what the toolchain supports is untruthful.

### 2026-09-19 · Story 1.1 · Code review outcome

- **Finding:** three review layers (blind, edge-case, verification-gap) raised 28 findings, triaged
  in the Review Triage Log of
  `_bmad-output/implementation-artifacts/spec-1-1-toolchain-baseline-and-ci.md`.
- **Decision:** 12 fixed in this story, among them: a test that every package defines the three
  gate scripts, `apps/api/test` now linted, relative-path and `.mts` bypasses of the boundary rules
  closed, missing `@types/node`/`vitest` declarations added, CI timeout, `jest --ci`. 2 deferred to
  `_bmad-output/implementation-artifacts/deferred-work.md`: presentation-layer adapter imports, and
  one unreproduced `pnpm lint` exit 2. 14 rejected.
- **Reason (rejections):** 8 were disproved or out of this story, e.g. directory imports fail
  typecheck (TS2834) and the Binance-identifier rule belongs to Story 1.3. 6 were cosmetic or
  unlikely with a fix that adds complexity: dynamic `import()` bypass, Jest types visible to mobile
  app code, `*.spec.ts` naming, CI concurrency and SHA pinning, contracts tests in `src/`, and
  shared timer restore. Each row in the triage log gives its evidence.
