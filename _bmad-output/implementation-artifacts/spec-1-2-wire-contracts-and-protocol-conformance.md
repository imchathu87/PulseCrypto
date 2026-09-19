---
title: 'Story 1.2: Wire contracts and protocol conformance'
type: 'feature'
created: '2026-09-19'
status: 'done'
baseline_commit: '6d2bdf03d9ddf4126dd92af9b342619ca2611228'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/contracts/websocket-protocol.md'
  - '{project-root}/docs/contracts/rest-api.md'
  - '{project-root}/docs/architecture/adr/ADR-006-json-wire-protocol.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `packages/contracts` holds only the skeleton's `MarketSnapshotSchema`, which matches neither `websocket-protocol.md` nor `rest-api.md`. Stories 1.4, 1.5, 1.7 and 2.1 need the real schemas, `decodeServerMessage` and the backoff helper. Requirements: CAP-4, CAP-5, NFR-2, NFR-6, AR-5..AR-8.

**Approach:** Implement Zod schemas, inferred types, protocol constants, `decodeServerMessage(raw, mode)` and `backoffDelay` as pure modules. Contract tests read every example straight from the two Markdown documents and cover every documented invalid case. Replace the skeleton schema and keep both apps typechecking.

## Boundaries & Constraints

**Always:** Zod default `.strip()`; `pair` is `^[A-Z0-9]+$`, never an enum. Nullable fields are `.nullable()`, never optional. Wire times, `rev`, `intervalMs`, `heartbeatMs`, counters and precisions are integers. `decodeServerMessage` returns a result and never throws; its `'envelope'` path holds the repo's only cast of external data. Non-test contracts modules have no I/O, timers, platform globals or mutable module state. A discrepancy between docs and code is fixed in schema, document and tests together. Skeleton adaptation (agent decision, minimal): `apps/api/src/server.ts` maps the BTC ticker to a ticker-only `PairSnapshot` (book group empty/`null`, `timestamp`/`lastTickerAt` = server receive time, `rev` from a local counter) and sends it as a `MarketBatchMessageSchema`-parsed `market.batch`; `apps/mobile/App.tsx` parses that message and shows the first pair's nullable price. `App.test.tsx` keeps passing.

**Decisions (human, 2026-09-19):** (1) Schemas enforce field-level rules only: §3 per-field types/ranges and every §10 case. Cross-field invariants (book ordering, crossed book, group consistency, duplicate pairs, `serverTime === t`) are not schema-enforced; they stay domain/adapter tests (Stories 1.3, 1.4). No contract-doc change for this. (2) Spec kept whole despite exceeding 1600 tokens (single story goal).

**Never:** Touch `docs/reference/`. Change protocol semantics or bump `v`. Implement gateway, adapter, domain or `MarketSocket` logic (Stories 1.3–1.5, 2.1). Read `__DEV__` in contracts. Add a dependency. Weaken any lint rule, flag or test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full decode, valid | any §9 server example, `'full'` | `{ kind: 'ok', message }`, fully typed, unknown keys stripped | N/A |
| Envelope decode, valid | same, `'envelope'` | `{ kind: 'ok', message }`; only `v`, `type` ∈ server types, `t` checked | N/A |
| Full decode, bad body | `market.batch` with `pairs: []` | `{ kind: 'invalid', type: 'market.batch', error }` | no throw |
| Envelope decode, bad body | same | `{ kind: 'ok' }` (body unchecked by design) | N/A |
| Version mismatch | `{ v: 2, ... }`, either mode | `{ kind: 'incompatible', v: 2 }` | no throw |
| Not an envelope | `null`, `"x"`, `[]`, object without `v`, unknown `type`, non-integer `t` | `{ kind: 'invalid', ... }` | no throw |
| Backoff, zero random | `random = () => 0` | `0` | N/A |
| Backoff, bad attempt | `attempt` negative or non-integer | throws `RangeError` (programmer error) | fails loudly |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/index.ts` -- skeleton `MarketSnapshotSchema` only; becomes a barrel re-exporting the new modules.
- `packages/contracts/src/index.test.ts` -- tests the skeleton schema; replace.
- `packages/contracts/src/lint-config.test.ts` -- ESLint Node API test for `no-explicit-any`; extend for the purity rules.
- `packages/contracts/{eslint.config.js,tsconfig.json,vitest.config.ts,package.json}` -- six strict flags, `allowImportingTsExtensions` (imports use `.ts`), Vitest includes `src/**/*.test.ts`, lint scans `src`. `@types/node` already declared (tests use `node:fs`/`node:url`).
- `apps/api/src/server.ts` -- skeleton; imports `MarketSnapshotSchema` (line 3), parses at lines 34–38. Change only that mapping. Its existing `JSON.parse` shape and Binance URL stay.
- `apps/mobile/App.tsx` -- parses `MarketSnapshotSchema` in `onmessage`; renders `snapshot.price.toFixed(2)`. Price becomes nullable.
- `apps/mobile/App.test.tsx` -- asserts `connecting…` and `—` placeholders; must stay green unchanged.
- Architecture §10 module seed: `ws-messages · rest · pair-snapshot · constants · decode · backoff`.
- Zod 4.6.5 facts (probed): `z.tuple` rejects extra items, `z.number()` rejects `Infinity`, a missing `.nullable()` key fails, `z.int()` and `.exactOptional()` exist (use the latter for client `t` under `exactOptionalPropertyTypes`).
- Example extraction: §9 of `websocket-protocol.md` has 7 ```json blocks (9.4 has two); `rest-api.md` §2 and §3 each have one.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/constants.ts` -- `PROTOCOL_VERSION = 1`, `DISPLAY_LEVELS = 10`, `MAX_LEVELS = 20`, `DEFAULT_HEARTBEAT_MS = 5000`, `MIN_INTERVAL_MS = 10`, `MAX_INTERVAL_MS = 1000`.
- [x] `packages/contracts/src/pair-snapshot.ts` -- `PairSchema`, `OrderBookLevelSchema` (tuple of two finite numbers > 0), `PairSnapshotSchema` per §3; types `Pair`, `OrderBookLevel`, `PairSnapshot`.
- [x] `packages/contracts/src/ws-messages.ts` -- `ServerEnvelopeSchema`, `ClientEnvelopeSchema`, `MarketSnapshotMessageSchema`, `MarketBatchMessageSchema` (`pairs.min(1)`), `MarketStatusMessageSchema`, `ErrorMessageSchema`, `ClientSetIntervalMessageSchema`, discriminated `ServerMessageSchema`/`ClientMessageSchema`, `SERVER_MESSAGE_TYPES`; inferred types.
- [x] `packages/contracts/src/rest.ts` -- `PairMetaSchema`, `PairsMetaResponseSchema`, `HealthResponseSchema` (exact counter keys from `rest-api.md` §3); types.
- [x] `packages/contracts/src/decode.ts` -- `decodeServerMessage(raw: unknown, mode: 'full' | 'envelope'): DecodeResult` per the I/O matrix; the envelope branch is the single documented cast.
- [x] `packages/contracts/src/backoff.ts` -- `backoffDelay(attempt, { baseMs, capMs }, random)`.
- [x] `packages/contracts/src/index.ts` -- barrel; remove `MarketSnapshotSchema`/`MarketSnapshot`.
- [x] `packages/contracts/eslint.config.js` -- for non-test `src/**/*.ts`: forbid `node:*`/`fs`/network imports, timer/network/`process`/`__DEV__` globals, and top-level `let`/`var`.
- [x] `packages/contracts/src/contract-examples.test.ts` -- read both docs via `node:fs`, extract JSON blocks by section, assert block counts (7, 1, 1), parse each against its schema.
- [x] `packages/contracts/src/contract-invalid.test.ts` -- one named test per §10 row and per `rest-api.md` invalid row, each fragment applied to a doc example; a guard test asserts the doc tables' case names equal the tested set. Boundary accepts: `intervalMs` 10 and 1000.
- [x] `packages/contracts/src/decode.test.ts`, `backoff.test.ts` -- I/O matrix rows; one backoff vector table covering 1000/30000 and 500/5000 with `random` 0, 0.5, 0.999…, large attempts; integer and `≤ capMs` assertions.
- [x] `packages/contracts/src/lint-config.test.ts` -- prove each purity rule fires on a virtual non-test file and not on a test file.
- [x] `packages/contracts/src/index.test.ts` -- delete (skeleton).
- [x] `apps/api/src/server.ts`, `apps/mobile/App.tsx` -- skeleton adaptation per Boundaries.

**Acceptance Criteria:**
- [x] Given the contracts barrel, when inspected, then it exports every schema and type named in the tasks and the four story constants, and no `MarketSnapshot` symbol remains in the repo.
- [x] Given a new row added to §10 or a new ```json block in §9, when tests run without new code, then a guard test fails.
- [x] Given `grep -rn " as " packages/contracts/src apps --include=*.ts --include=*.tsx` excluding tests, when run, then the only cast of external data is in `decode.ts`.
- [x] Given the repo root, when `pnpm typecheck && pnpm lint && pnpm test` runs, then all exit 0.

## Design Notes

`decodeServerMessage` order: non-object or missing `v` → `invalid`; `v !== 1` → `incompatible`; then `ServerMessageSchema` (full) or `ServerEnvelopeSchema` with `type` limited to `SERVER_MESSAGE_TYPES` (envelope). `invalid.type` is the raw `type` when it is a string, else `null`, so Story 2.1 can log once per type.

## Implementation Notes

- Implemented pure modules in `packages/contracts/src` for constants, pair snapshots, WS messages, REST responses, server message decode, and backoff delay.
- Enforced ESLint purity rules prohibiting node/IO/network imports, runtime globals (timers, process, __DEV__, network), and mutable top-level variables for non-test modules.
- Added contract tests reading examples directly from `websocket-protocol.md` and `rest-api.md`, validating all invalid cases with guard tests that verify synchronization with documentation tables.
- Adapted skeleton in `apps/api/src/server.ts` and `apps/mobile/App.tsx` to `MarketBatchMessageSchema` / `PairSnapshot`.
- Added `"allowImportingTsExtensions": true` to `apps/mobile/tsconfig.json` to allow resolution of workspace contracts `.ts` imports under `noEmit: true`.
- Zero occurrences of `MarketSnapshot` or `MarketSnapshotSchema` remain across `apps` and `packages`.
- The only type assertion on external data across `packages/contracts/src` and `apps` is `raw as ServerMessage` inside `decode.ts`.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / Disposition |
|---------|---------|------------------------|
| `decode.ts`: `rawType` evaluated after missing `v` check | `medium` | When `raw` lacks `v` but has string `type`, `rawType` returns `null`, violating spec design note for Story 2.1 telemetry logging. Routed to `patch`. |
| `decode.ts`: `raw.v` validation allows `NaN` / non-integer | `medium` | `typeof NaN === 'number'`, so `NaN` and floats enter `incompatible` instead of `invalid`. Routed to `patch`. |
| `backoff.ts`: missing `baseMs`/`capMs` validation | `low` | Static configuration objects; runtime caller programmer errors are unlikely in everyday use. Rejected. |
| `constants.ts`: missing exported backoff constants | `false` | Spec explicitly enumerates exact constants for Story 1.2; policies belong to consumer stories (1.4, 2.1). Rejected. |
| `constants.ts` / `rest.ts`: magic precision numbers | `false` | Precision bounds match `rest-api.md` §2 and are not required to be exported story constants. Rejected. |
| `pair-snapshot.ts`: `spread` allows zero and negative | `false` | Human decision in spec confirms schemas enforce field-level rules only; cross-field book consistency is a domain invariant. Rejected. |
| `ws-messages.ts` / `rest.ts`: shared source/upstream schemas | `low` | Inlining schemas causes no functional divergence; cosmetic refactor. Rejected. |
| `ws-messages.ts`: missing client types and error codes | `low` | Single client message type; `ClientMessageSchema` is exported; cosmetic. Rejected. |
| `rest.ts`: missing typed export for counter names | `low` | Health response schema strongly types counter keys; cosmetic. Rejected. |
| `eslint.config.js`: allows bare node imports like `path` | `low` | Purity rules forbid `node:*`, `fs`, and network imports as specified; no forbidden imports exist. Rejected. |
| `contract-invalid.test.ts`: asymmetric depth level testing | `false` | Tests the exact §10 row from `websocket-protocol.md`. Rejected. |
| `contract-invalid.test.ts`: incomplete omitted nullable fields | `false` | Tests the exact §10 row from documentation table. Parity verified by guard test. Rejected. |
| `contract-invalid.test.ts`: missing pressure boundary tests | `false` | Not required by §10 or spec acceptance criteria. Rejected. |
| `contract-invalid.test.ts`: missing health invalid cases | `false` | `rest-api.md` defines no invalid table for GET /health; guard test checks parity. Rejected. |
| `contract-invalid.test.ts`: missing client timestamp test | `false` | Client `t` is optional integer per envelope schema and tested with exactOptional. Rejected. |
| `App.tsx`: directly invokes `MarketBatchMessageSchema.parse` | `false` | Follows exact specification Boundary constraint for minimal skeleton adaptation. Rejected. |
| `server.ts`: unhandled conversion in interim server | `false` | Follows minimal skeleton adaptation; Story 1.4/1.5 replace server implementation. Rejected. |
| `contract-examples.test.ts`: regex section splitting | `false` | Guard tests enforce exact block counts (7, 1, 1). Parity guaranteed. Rejected. |
| `backoff.ts`: `baseMs` 0 at attempt 1024 produces `NaN` | `false` | `baseMs` is positive in all defined policies; `Math.min(capMs, Infinity)` evaluates to `capMs`. Rejected. |
| `App.tsx`: unverified WebSocket message ingestion | `low` | Interim skeleton adaptation in mobile App to be replaced by full store/socket in Story 2.1. Routed to `defer`. |

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm test` -- expected: exit 0 in all three packages
- `pnpm --filter @pulsecrypto/contracts test` -- expected: examples, invalid, decode, backoff, lint suites pass
- `grep -rn "MarketSnapshotSchema\|MarketSnapshot\b" apps packages --include=*.ts --include=*.tsx` -- expected: no match
