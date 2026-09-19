---
title: 'Story 1.3: Domain model, latest-value buffer and simulator source'
type: 'feature'
created: '2026-09-19'
status: 'done'
baseline_commit: '80ea1b9d03645a2dca9aff700c78db15018ed5b3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/architecture/adr/ADR-003-latest-value-buffer.md'
  - '{project-root}/docs/architecture/adr/ADR-007-derived-values-and-timestamps.md'
  - '{project-root}/docs/architecture/adr/ADR-011-market-data-source.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/api` has no domain model, buffer or source abstraction, only the skeleton `server.ts`. Stories 1.4–1.7 and all of Epic 2 need `MarketDataSource`, a folded `PairState` per pair, and an offline deterministic source. Requirements: CAP-2, CAP-17, NFR-1, NFR-4, NFR-7, AR-9, AR-10, AR-14, AR-15, AR-16, AR-24.

**Approach:** Pure domain types and fold/derive/staleness/book-validity functions in `domain/`. An application `LatestValueBuffer` (one `PairState` per configured pair, global `rev` sequence, `buffer.mutations` counter). A seeded `SimulatorMarketDataSource` in `infrastructure/simulator/`. A Zod `config.ts` for `PAIRS`, `MARKET_SOURCE` and `SIMULATOR_RATE`. No server wiring.

## Boundaries & Constraints

**Always:** Domain types match ADR-011: `MarketDataSource { readonly kind: 'binance' | 'simulator'; start(sink): void; stop(): Promise<void> }`, `MarketEventSink = (event: MarketEvent) => void`, events discriminated by `kind` (`'depth' | 'ticker' | 'status'`) and carrying integer ms `receivedAt` (status: `at`). `domain/` imports nothing outside `domain/`; it keeps its own `DISPLAY_LEVELS = 10`, test-pinned to the contracts constant. `PairState` mirrors the `PairSnapshot` field set, readonly, with nullable groups and `[]` books before data. Fold functions are pure and return new state; only the buffer stamps `rev`. Math per websocket-protocol §7 (spread unrounded; pressures `round2`, first 10 levels, `null` when a side is empty). Hot paths do not log.

**Agent decisions (minimal, recorded):** (1) Simulator runs one `setInterval` at 100 ms. Each tick emits `k = SIMULATOR_RATE / (10 × pairs)` events per pair, all depth, except on every 10th tick (from the first) the last event per pair is a ticker. (2) `config.ts` defaults `SIMULATOR_RATE` to `1000` (the testing-strategy stress rate), labelled a config default. When `MARKET_SOURCE=simulator`, it must be an integer multiple of `10 × PAIRS.length` with `k ≥ 2`. (3) Seed is a constructor option, not an env var. (4) `stop()` emits no event. (5) The buffer throws on an unconfigured pair or duplicate `PAIRS` (programmer error). (6) `zod` 4.6.5, already pinned at the root and in contracts, is declared in `apps/api` because api source now imports it.

**Never:** Touch `server.ts`, `docs/reference/`, contracts or contract docs. Create `composition-root.ts`, a status monitor, sessions or the Binance adapter (Stories 1.4, 1.5). Add env vars beyond these three, a new dependency, a per-event collection, or a Binance-named identifier in `domain/` or `application/`. Weaken a lint rule, flag or test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Depth, both sides | 20 bids, 20 asks | book replaced; pressure over first 10; `timestamp = max(times)` | N/A |
| Depth, empty side | `bids: []` | `spread`, `buyPressure`, `sellPressure` all `null` | N/A |
| Ticker | ticker update | ticker group + `lastTickerAt` replaced; book group identical | N/A |
| Unknown pair | event for pair not in `PAIRS` | nothing mutated | throws `Error` |
| Stale boundary | `now − lastDepthAt === STALE_AFTER_MS` | not stale; `+1` is stale | N/A |
| Bad config | `SIMULATOR_RATE=abc`, `PAIRS=btcusdt`, `MARKET_SOURCE=kraken`, rate not a valid multiple | parse fails | throws, message names the variable |

</frozen-after-approval>

## Code Map

- `apps/api/src/server.ts` -- skeleton; untouched until Story 1.5.
- `apps/api/eslint.config.js` -- domain/application already forbid `infrastructure/{binance,simulator}`; domain forbids `@pulsecrypto/contracts`. No change.
- `apps/api/test/lint-boundaries.test.ts` -- ESLint Node API pattern (`lintText` with virtual paths); reuse its style.
- `apps/api/vitest.config.ts` -- includes `src/**/*.test.ts` and `test/**/*.test.ts`; unit tests live beside modules. A test under `src/domain/` must not import contracts, because lint scans it.
- `apps/api/package.json` -- no `zod` today (tests resolve it via root hoisting).
- `packages/contracts/src/{pair-snapshot,constants,rest}.ts` -- `PairSnapshot` field set, `DISPLAY_LEVELS`, `PairSchema` (reuse in `config.ts`), and the `HealthResponse` counter keys (the source of the counter names).
- `vitest.shared.ts` -- fake-timer rule. Use `vi.useFakeTimers()` and `vi.getTimerCount()`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/domain/market-event.ts` -- `Pair`, `OrderBookLevel` (readonly `[price, qty]`), `DepthUpdate`, `TickerUpdate` (`price, change24hPct, high24h, low24h, volume24h`), `SourceStatusChange`, `MarketEvent`, `MarketEventSink`, `MarketDataSource`, `SourceKind`.
- [x] `apps/api/src/domain/pair-state.ts` -- `DISPLAY_LEVELS`, `PairState`, `emptyPairState(pair)`, `applyDepth`, `applyTicker`, `round2`, spread/pressure derivation.
- [x] `apps/api/src/domain/book.ts` -- `isValidBook(bids, asks)`: bids strictly descending, asks strictly ascending, bestBid < bestAsk; empty side valid. Story 1.4 reuses it.
- [x] `apps/api/src/domain/staleness.ts` -- `isPairStale(state, { upstreamConnected, now, staleAfterMs })`.
- [x] `apps/api/src/application/counters.ts` -- `COUNTER_NAMES` (the 10 architecture §8 names), `Counters` with `increment(name)` and read-only `snapshot()`.
- [x] `apps/api/src/application/latest-value-buffer.ts` -- `LatestValueBuffer(pairs, counters)`: `apply(DepthUpdate | TickerUpdate)`, `get(pair)`, `values()`, `currentRev`.
- [x] `apps/api/src/infrastructure/simulator/prng.ts`, `simulator-market-data-source.ts` -- seeded PRNG; `SimulatorMarketDataSource({ pairs, ratePerSecond, seed, now? })` with `kind: 'simulator'`. Mid-price follows a multiplicative random walk from a static base-price table (100 for unknown pairs). The book has 20 levels a side at `mid ∓ tick × (i+1)` with `tick = mid × 1e-4` and qty > 0. `start` twice throws.
- [x] `apps/api/src/config.ts` -- `loadConfig(env)`: `PAIRS` (comma list, trimmed, `PairSchema`, ≥1, unique; default the five pairs), `MARKET_SOURCE` (`binance` default | `simulator`), `SIMULATOR_RATE` per the decisions above.
- [x] `apps/api/package.json`, `pnpm-lock.yaml` -- declare `zod: 4.6.5`; `pnpm install`.
- [x] Tests: `src/domain/{pair-state,book,staleness}.test.ts`, `src/application/{latest-value-buffer,counters}.test.ts`, `src/infrastructure/simulator/simulator-market-data-source.test.ts`, `src/config.test.ts` -- the I/O matrix plus the ACs below.
- [x] `apps/api/test/domain-boundaries.test.ts` -- `DISPLAY_LEVELS` equals the contracts constant. A TypeScript-scanner check finds no `Identifier` token or file name matching `/binance/i` under `src/domain` and `src/application`. The `'binance'` string literal in `SourceKind` is allowed (ADR-011).

**Acceptance Criteria:**
- Given 20 levels per side, when folded, then pressure uses only the first 10, and `buyPressure + sellPressure` equals 100 within `1e-9`.
- Given a buffer over the five pairs, when 10 000 mixed events are applied, then `rev` strictly increases across pairs, ends at 10 000, the map size stays 5, and `buffer.mutations` is 10 000.
- Given the three staleness conditions, when tested, then each has its own test.
- Given fake timers and a fixed seed, when the simulator starts, then `{connected:true}` is the first event. Two runs with the same seed produce equal sequences. Every pair gets ≥ 1 depth per 100 ms, and the per-pair counts are equal. Every book passes `isValidBook`. After `await stop()`, no event fires and `vi.getTimerCount()` is 0.
- Given the repo root, when `pnpm typecheck && pnpm lint && pnpm test` runs, then all exit 0.

## Implementation Notes

- Implemented pure domain types and fold functions without importing contracts or infrastructure into `src/domain/`.
- `LatestValueBuffer` encapsulates in-memory `Map<Pair, PairState>` bounded to O(pairs) with monotonic process-wide revision sequence and counter integration.
- `SimulatorMarketDataSource` implements deterministic seeded random walk, generating 20 levels of valid order book bids/asks and 100 ms tick cadence with ticker updates.
- `loadConfig` parses env variables with Zod schemas and validates required constraints naming the failing variable on errors.
- Added comprehensive unit tests and TypeScript-scanner AST boundary verification tests.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / Route |
|---------|---------|------------------|
| BH-1 / EH-1: Missing runtime event kind validation in `apply` | low | `apps/api/src/application/latest-value-buffer.ts:41-44` non-depth/ticker events fall through to `applyTicker`. Route: patch. |
| BH-2 / EH-5: Missing structural validation on order book levels | false | `apps/api/src/domain/book.ts` operates on typed tuples already validated at system boundaries; external data is Zod-validated. |
| BH-3: `applyDepth` does not truncate order book to 20 levels | false | Spec does not mandate depth truncation in domain fold; input stream is `@depth20`. |
| BH-4: `isValidBook` does not enforce depth <= 20 | false | Spec defines `isValidBook` semantics around price ordering and positivity, not level count. |
| BH-5 / EH-2: SimulatorMarketDataSource allows duplicate pairs | medium | `apps/api/src/infrastructure/simulator/simulator-market-data-source.ts:42-46` constructor does not reject duplicates, corrupting rate calculation. Route: patch. |
| BH-6: `SimulatorMarketDataSource.stop()` does not reset `started` | false | Data sources in ADR-011 are single-lifecycle per process; restart is not in spec. |
| BH-7 / EH-3: `tick()` loop does not abort if stopped during emission | low | `apps/api/src/infrastructure/simulator/simulator-market-data-source.ts:99-107` if sink invokes stop(), tick continues. Route: patch. |
| BH-8: Counters lacks decrement for `ws.clients.active` | false | Spec defines `increment(name, by)` for Story 1.3; gauge decrements belong to Story 1.5. |
| BH-9: Whitespace-only `PAIRS` handling | false | Config parser throws `Invalid PAIRS` naming the variable, satisfying error handling requirements. |
| BH-10: Missing pinning test for `MAX_LEVELS` | false | Spec explicitly requires pinning `DISPLAY_LEVELS = 10`; domain does not use `MAX_LEVELS`. |
| BH-11: Simulator ticker metrics fluctuate unrealistically | false | Simulator random walk formulas conform to deterministic simulation spec. |
| BH-12: Missing test coverage for depth updates with <10 levels | low | `apps/api/src/domain/pair-state.test.ts` benefits from testing books with fewer than 10 levels. Route: patch. |
| BH-13: Missing default staleness threshold constant export | false | Staleness threshold is configured dynamically per ADR-007. |
| BH-14: `values()` array allocation overhead | false | 5-element array allocation has negligible overhead and prevents external mutation. |
| VG-1: Fractional ratio pressure rounding test | low | `apps/api/src/domain/pair-state.test.ts` missing test exercising `round2` on fractional ratios. Route: patch. |
| VG-2: Ticker field preservation in `applyDepth` test | low | `apps/api/src/domain/pair-state.test.ts` missing test verifying `applyDepth` preserves existing ticker fields. Route: patch. |
| VG-3: Simulator fallback base price for unknown pairs test | low | `apps/api/src/infrastructure/simulator/simulator-market-data-source.test.ts` missing test verifying base price 100 for custom pairs. Route: patch. |
| VG-4: `source.kind === 'simulator'` assertion | low | `apps/api/src/infrastructure/simulator/simulator-market-data-source.test.ts` missing assertion for `source.kind`. Route: patch. |
| VG-5: Fresh ticker with stale depth staleness test | low | `apps/api/src/domain/staleness.test.ts` missing test when ticker is fresh but depth is stale. Route: patch. |
| EH-4: Empty pairs array in LatestValueBuffer constructor | low | `apps/api/src/application/latest-value-buffer.ts:12-21` does not guard against empty pairs array. Route: patch. |
| EH-6: Clock regression in staleness check | false | Standard system monotonicity; not part of staleness specification. |

## Design Notes

`applyDepth` returns `{ ...state, bids, asks, spread, buyPressure, sellPressure, lastDepthAt: e.receivedAt, timestamp: max(e.receivedAt, state.lastTickerAt ?? -Infinity) }`. The buffer then does `map.set(pair, { ...next, rev: ++seq })`: one entry replaced per mutation, O(pairs).

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm test` -- expected: exit 0 in all three packages
- `pnpm --filter @pulsecrypto/api test` -- expected: domain, buffer, simulator, config and boundary suites pass
- `grep -rni binance apps/api/src/domain apps/api/src/application` -- expected: only the `SourceKind` string literal
