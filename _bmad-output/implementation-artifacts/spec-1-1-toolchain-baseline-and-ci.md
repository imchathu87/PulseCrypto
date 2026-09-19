---
title: 'Story 1.1: Toolchain baseline and CI'
type: 'chore'
created: '2026-09-19'
status: 'done'
baseline_commit: '107659988f6a039bc93d33c38d4ce7258017f257'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/architecture/engineering-standards.md'
  - '{project-root}/docs/architecture/testing-strategy.md'
  - '{project-root}/docs/architecture/adr/ADR-012-monorepo-toolchain.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The walking skeleton has no root `typecheck`/`lint`/`test` commands, no test runner in any package, strict flags and `no-explicit-any` only in `apps/api`, no Node pin and no CI. Later stories therefore have no shared gate. Requirements: NFR-1, NFR-2, AR-1, AR-2, AR-3, AR-4, AR-36.

**Approach:** Add one root script each for typecheck, lint and test that runs across `apps/api`, `apps/mobile` and `packages/contracts`. Wire Vitest (api, contracts) and Jest + jest-expo + RNTL (mobile), each proven by a passing test. Enable the six strict flags and `no-explicit-any` everywhere. Prove the layer-boundary lint rules with an ESLint Node API test. Pin Node, add a GitHub Actions CI, and create `docs/ai/ai-development-log.md`.

## Boundaries & Constraints

**Always:** Keep ADR-012 toolchain facts: pnpm 12.4.2, `nodeLinker: hoisted`, `allowBuilds: { esbuild: true }`, zod pinned at root, contracts export TS source with no build step, and the existing Metro config. All six flags from engineering-standards §1 go in all three packages. Each package declares the dev dependencies it runs (no reliance on hoisted phantoms). Lockfile updated via `pnpm install` so `--frozen-lockfile` passes.

**Decision (human, 2026-09-19):** `engines.node` is `>=22.13 <23`, not `>=22.4 <23`: the locked ESLint 10.10.0 requires `^22.13.0`, so a lower floor is untruthful. ADR-012 and `epics.md` Story 1.1 are updated in this same change with that reason. Spec kept whole despite exceeding 1600 tokens (single story goal).

**Never:** Drop or weaken a compiler flag or lint rule (if a flag fails under `expo/tsconfig.base`, stop and raise it). Refactor `apps/api/src/server.ts` or `apps/mobile/App.tsx` beyond what a gate strictly requires. Contact Binance from any test or CI job. Add a coverage threshold. Put fixture files that violate the rules anywhere `pnpm lint` scans. Touch `docs/reference/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Domain imports adapter | `src/domain/x.ts` imports `../infrastructure/binance/adapter` | ESLint error with message "Depend on MarketDataSource, not a concrete adapter." | lint exits non-zero |
| Application imports simulator | `src/application/x.ts` imports `../infrastructure/simulator/source` | same error | lint exits non-zero |
| Domain imports contracts | `src/domain/x.ts` imports `@pulsecrypto/contracts` | ESLint error naming the domain/contracts rule | lint exits non-zero |
| Application imports contracts | `src/application/x.ts` imports `@pulsecrypto/contracts` | no boundary error (allowed) | N/A |
| Composition root imports adapter | `src/composition-root.ts` imports `./infrastructure/binance/adapter` | no boundary error | N/A |
| Explicit any | `const x: any = 1` in any package source | `@typescript-eslint/no-explicit-any` error | lint exits non-zero |

</frozen-after-approval>

## Code Map

- `package.json` -- root; has `packageManager`/`devEngines` pnpm 12.4.2 and zod 4.6.5. Add `engines` and `typecheck`/`lint`/`test` scripts (plain `pnpm -r run <x>`, so any package failure fails the command).
- `pnpm-workspace.yaml` -- keep as is (ADR-012).
- `apps/api/tsconfig.json` -- already has all six flags; `include` is `["src"]`, extend to `test`.
- `apps/api/eslint.config.js` -- has `no-explicit-any` and the adapter `no-restricted-imports` block for domain+application. Flat config replaces rule options per block, so a later `src/domain/**` block must restate the adapter patterns plus the `@pulsecrypto/contracts` restriction.
- `apps/api/package.json` -- has eslint 10.10.0, typescript-eslint 8.70.0, @eslint/js, typescript ~6.0.3; `lint` is `eslint src`. Add Vitest and a `test` script.
- `apps/api/src/server.ts` -- current skeleton; passes `tsc` and `eslint` today. Do not modify.
- `apps/mobile/tsconfig.json` -- extends `expo/tsconfig.base` with only `strict`. Probe run: all six flags typecheck clean on current sources with TS 6.0.3.
- `apps/mobile/package.json` -- no lint/test/typecheck scripts, no ESLint or Jest.
- `apps/mobile/App.tsx` -- opens `new WebSocket` in `useEffect`; a render test must stub global `WebSocket` so nothing connects.
- `packages/contracts/package.json`, `src/index.ts` -- `MarketSnapshotSchema` only; no tsconfig, scripts or dev deps.
- `.github/pull_request_template.md` -- PR body sections; dependency justifications go in its Summary.
- `.github/workflows/` -- does not exist.
- Versions chosen (Expo `bundledNativeModules.json` pins `jest-expo ~57.0.5`; jest-expo 57 depends on Jest 29 and `react-test-renderer 19.2.3`): `jest-expo ~57.0.5`, `jest ^29.7.0`, `@types/jest ^29.5`, `@testing-library/react-native ^13.3.3` (peer `react-test-renderer`, already supplied at the React version; v14 needs the new `test-renderer` package), `vitest ^4.1.11` (v5 requires Node ≥22.12).

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `.nvmrc` -- add `engines.node` `>=22.13 <23`, `.nvmrc` = `22`, scripts `typecheck`/`lint`/`test` as `pnpm -r run <x>` -- one command per gate.
- [x] `vitest.shared.ts` (root) -- shared Vitest base config (`environment: 'node'`, `restoreMocks`) with a header comment stating the fake-timer rule: fake timers for cadence/backoff/heartbeat tests; with real sockets fake only `setTimeout`, `setInterval`, `Date`; no coverage threshold -- AR-2.
- [x] `apps/api/package.json`, `apps/api/vitest.config.ts`, `apps/api/tsconfig.json` -- add vitest dev dep, `test: vitest run`, config merging the shared base, tsconfig includes `test`.
- [x] `apps/api/eslint.config.js` -- add `src/domain/**` block restricting adapter paths and `@pulsecrypto/contracts` (message: domain must not depend on the wire contract); keep existing block for application.
- [x] `apps/api/test/lint-boundaries.test.ts` -- ESLint Node API (`new ESLint({ cwd })` + `lintText(code, { filePath })`) over every I/O-matrix row, asserting rule id and message; also asserts `no-explicit-any` fires.
- [x] `packages/contracts/{package.json,tsconfig.json,eslint.config.js,vitest.config.ts}`, `src/index.test.ts` -- six flags, `typecheck`/`lint`/`test` scripts, dev deps, `no-explicit-any: error`; test parses a valid snapshot and rejects an invalid one.
- [x] `apps/mobile/{package.json,tsconfig.json,eslint.config.js,jest.config.js}`, `App.test.tsx` -- six flags, ESLint (`@eslint/js` + `typescript-eslint`, `no-explicit-any: error`), Jest with `jest-expo` preset, `typecheck`/`lint`/`test` scripts; test renders `App` with a stubbed `WebSocket` and asserts the connecting placeholder.
- [x] `pnpm-lock.yaml` -- regenerate via `pnpm install`.
- [x] `.github/workflows/ci.yml` -- on push and pull_request: checkout, `pnpm/action-setup` (reads `packageManager`), `actions/setup-node` with `node-version-file: .nvmrc` and pnpm cache, `pnpm install --frozen-lockfile`, then typecheck, lint, test. No network step beyond install.
- [x] `docs/ai/ai-development-log.md` -- purpose header, entry format (date, story, finding, decision, reason), entry for Story 1.1 review outcome.
- [x] `docs/architecture/adr/ADR-012-monorepo-toolchain.md`, `_bmad-output/planning-artifacts/epics.md` -- update `>=22.4 <23` to `>=22.13 <23` with the ESLint engines reason.

**Acceptance Criteria:**
- Given a fresh clone on Node 22.x and pnpm 12.4.2, when `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test` runs at the root, then each command runs in all three packages and exits 0.
- Given `pnpm test`, when it runs, then Vitest runs in `apps/api` and `packages/contracts`, Jest (jest-expo, RNTL) runs in `apps/mobile`, and each has at least one passing test.
- Given a temporary `const x: any` in any package, when `pnpm lint` runs, then it fails.
- Given the CI workflow, when inspected, then it uses the pinned pnpm and `.nvmrc`, runs the three gates, and has no Binance URL or live-network step.
- Given the PR description, when opened, then it has a one-line justification per new dev dependency.

## Implementation Notes

- TypeScript 6 defaults `types` to `[]`, so `apps/mobile/tsconfig.json` sets `"types": ["jest"]` for the Jest globals in `App.test.tsx`. No flag was dropped; all six flags typecheck clean under `expo/tsconfig.base`.
- ESLint prefixes a `no-restricted-imports` pattern message with `'<source>' import is restricted from being used by a pattern.`, so `lint-boundaries.test.ts` asserts the rule id, severity 2 and that the message contains the configured text.
- `apps/mobile/eslint.config.js` is CommonJS (the package has no `"type": "module"`). A `*.config.js` block declares `sourceType: 'commonjs'`, the Node globals those files use, and turns off `@typescript-eslint/no-require-imports` for them only, because `require` is the only module system Metro/Jest/ESLint configs have there. Source `.ts`/`.tsx` rules are unchanged.
- `apps/mobile` lints `.` (App.tsx sits at the package root); `apps/api` and `packages/contracts` lint `src`, as before. `apps/api/test` is typechecked but not in the `lint` script (unchanged from the skeleton); it lints clean when run directly.
- `react-test-renderer` (RNTL 13 peer) is not declared: it resolves at 19.2.3 through `jest-expo`, and `pnpm install` reported no unmet peer.
- `docs/ai/ai-development-log.md` has a real entry for the Node-floor decision and a pending entry for the Story 1.1 review outcome; the review has not run yet, so that task stays unticked.
- Matrix audit (orchestrator): the "Explicit any" row says "any package source" but only `apps/api` had a test. Added `packages/contracts/src/lint-config.test.ts` (ESLint Node API) and `apps/mobile/lint-config.test.ts`. The mobile test runs the real `eslint.config.js` through the synchronous `Linter`, because ESLint 10's config loader uses dynamic `import()`, which Jest's VM rejects without `--experimental-vm-modules`. To type-check that call under `exactOptionalPropertyTypes`, `apps/mobile/eslint.config.js` now uses ESLint's `defineConfig` from `eslint/config` instead of `tseslint.config` (whose return type is incompatible with `Linter.Config[]`); the rules are unchanged.
- Verified by orchestrator: `pnpm install --frozen-lockfile` leaves the lockfile unchanged; root typecheck/lint/test exit 0 (contracts 4, api 6, mobile 2 tests); a probe `any` fails `pnpm lint` in each package individually; `npx expo export --platform android` still bundles; `grep -rni binance .github/` has no match. One root `pnpm lint` run exited 2 once and did not reproduce in four reruns; cause unknown.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-09-19). Layers: blind-hunter (BH), edge-case-hunter (EC), verification-gap (VG).

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | VG gap, EC | Root `pnpm -r run <x>` silently skips a package lacking the script; nothing asserts all three define it | medium | VG demonstrated "Scope: 2 of 3" with exit 0 in a scratch pnpm 12.4.2 workspace (pre-verified) | patch |
| 2 | VG, BH, EC×3 | `apps/api` lint is `eslint src`, so `test/**` and `vitest.config.ts` escape `pnpm lint` (AC: `any` in any package fails lint) | medium | Probe: `any` in `test/x.test.ts` is flagged by the config, but the script never scans `test/` | patch |
| 3 | VG, BH, EC | Relative import of `packages/contracts` from `domain/` bypasses the contracts restriction | medium | Probe: `'../../../../packages/contracts/src/index.ts'` in `src/domain/x.ts` → no message; typechecks under NodeNext + `allowImportingTsExtensions` | patch |
| 4 | EC | `.mts`/`.cts` files in domain/application skip boundary blocks (`files` is `*.ts` only) | low | Probe: `src/domain/x.mts` importing the Binance adapter → no message; fix is a glob correction | patch |
| 5 | BH, EC | `packages/contracts` uses `node:url` without declaring `@types/node`; its vitest peer resolves to `@types/node@26.6.1` | medium | `pnpm-lock.yaml:273` contracts vitest `4.1.11(@types/node@26.6.1)`; violates spec "each package declares the dev dependencies it runs" | patch |
| 6 | EC | Root `vitest.shared.ts` imports `vitest/config` but root `package.json` declares no vitest | low | Resolves only through the hoisted copy; same spec rule as #5; fix is one devDependency | patch |
| 7 | BH | `epic-1-context.md` still says Node `>=22.4 <23` | medium | Line 35 of the file; later stories load it as primary context, contradicting the human decision | patch |
| 8 | BH | ADR-012 `## Status` does not record the amendment | low | Status still reads only "Accepted (adopted from skeleton outcome)"; scope-boundaries §3 requires visible ADR changes | patch |
| 9 | BH, EC | CI job has no `timeout-minutes` | low | `.github/workflows/ci.yml` job `verify`; a hung runner holds the check for 6 h; one-line fix | patch |
| 10 | BH | Mobile `test` is `jest` without `--ci` | low | `apps/mobile/package.json`; a future snapshot would be written instead of failing in CI; one-flag fix | patch |
| 11 | EC | Mobile `eslint .` does not ignore `web-build/`, `coverage/` | low | `apps/mobile/eslint.config.js` ignores; both are in `apps/mobile/.gitignore` and would fail lint when present | patch |
| 12 | BH | `docs/ai/ai-development-log.md` has a "pending" placeholder entry | medium | Log's own rule "only record what actually happened"; AC needs the real review outcome | patch |
| 13 | BH, EC | Dynamic `import()` bypasses `no-restricted-imports` | low | Probe confirmed; unlikely in everyday use and fix adds a `no-restricted-syntax` rule (more than a direct correction) | reject |
| 14 | EC | `src/presentation/**` may import a concrete adapter | low | Real, but engineering-standards §3 scopes the lint rule to domain/application; pre-existing design, not caused by this change | defer |
| 15 | BH, VG, EC | `types: ["jest"]` applies to all mobile sources | low | Real; misuse fails loudly at runtime, and the fix restructures tsconfig (more than direct correction) | reject |
| 16 | BH, EC | `App.test.tsx`: unused `onmessage`, URL not asserted, restore leaves `WebSocket: undefined` if originally absent | false | jest-expo's RN setup defines global `WebSocket`, so the original is never undefined; the unused field and missing URL assertion cause no wrong outcome | reject |
| 17 | EC | Vitest `include` ignores `*.spec.ts` / `*.test.tsx` | low | No such files or convention in repo; fix would invent a convention | reject |
| 18 | BH | CI runs twice on PR branches, no `concurrency`, actions pinned by tag | low | Cost/cosmetic only; no wrong result | reject |
| 19 | BH | AR-3 "no Binance-named identifier" not enforced | false | Owned by Story 1.3 AC (`epics.md:332`), not Story 1.1 | reject |
| 20 | BH, EC | Spec `in-review` vs sprint-status `in-progress` | false | Step 5 syncs sprint-status to `review` | reject |
| 21 | BH | PR dependency justifications not drafted | false | No PR exists yet; drafted when the PR is opened | reject |
| 22 | BH | Stale vitest v4 rationale; caret vs exact pins | false | Fix would edit this spec; existing devDeps already use carets (`eslint ^10.10.0`) | reject |
| 23 | BH | Contracts tests live in `src/` | low | The spec placed `src/index.test.ts` there; fix would edit this build's spec | reject |
| 24 | BH | Shared Vitest config does not restore timers / unstub globals | low | No fake-timer tests exist yet; setup file is added complexity | reject |
| 25 | BH, VG | Unexplained root `pnpm lint` exit 2 once | maybe-false | Not reproduced in 12 later runs (4 + 8 loop); would need captured output of a failing run | defer (medium, unverified) |
| 26 | EC | Directory import `'../infrastructure/binance'` bypasses adapter rule | false | NodeNext rejects it at typecheck: probe gave TS2834 | reject |
| 27 | EC | CJS files other than `*.config.js` would hit `no-undef` | false | No such file exists; speculative | reject |
| 28 | EC | `engines` blocks install on Node 22.0–22.12 | false | Intended human decision recorded in the frozen block | reject |

## Verification

**Commands:**
- `pnpm install --frozen-lockfile` -- expected: exit 0, lockfile unchanged
- `pnpm typecheck && pnpm lint && pnpm test` -- expected: exit 0, three packages each run
- `grep -rn "binance" .github/` -- expected: no match
