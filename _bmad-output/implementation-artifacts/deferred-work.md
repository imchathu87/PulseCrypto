# Deferred Work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-toolchain-baseline-and-ci.md`
  summary: Enforce "infrastructure is imported only by the composition root" for `src/presentation/**` (and any file outside domain/application), not just domain/application.
  evidence: Probe during Story 1.1 review showed `src/presentation/x.ts` importing `../infrastructure/binance/adapter.ts` produces no lint error; engineering-standards §3 scopes the ESLint rule to domain/application only, so widening it is a standards decision, not a Story 1.1 fix.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-toolchain-baseline-and-ci.md`
  summary: Investigate one unexplained root `pnpm lint` exit 2 (ESLint crash/config error code) observed during Story 1.1 verification.
  evidence: Unverified (maybe-false, medium if real). Not reproduced in 12 subsequent runs. Would be settled by capturing full output of a failing run, e.g. looping `pnpm lint` with and without `--workspace-concurrency=1`.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-wire-contracts-and-protocol-conformance.md`
  summary: Add unit test coverage for mobile App WebSocket message ingestion and null-safe rendering.
  evidence: App.tsx was adapted as an interim skeleton for Story 1.2 to parse MarketBatchMessageSchema; full WebSocket client and UI state is implemented and verified in Story 2.1.

