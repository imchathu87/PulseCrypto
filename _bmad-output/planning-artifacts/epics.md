---
stepsCompleted: [1, 2, 3, 4]
status: complete
epic1Status: approved
epic2Status: approved
epic3Status: approved
inputDocuments:
  - _bmad-output/specs/spec-pulsecrypto/SPEC.md
  - _bmad-output/specs/spec-pulsecrypto/binance-feed.md
  - _bmad-output/specs/spec-pulsecrypto/figma-scope.md
  - _bmad-output/specs/spec-pulsecrypto/stack.md
  - _bmad-output/specs/spec-pulsecrypto/acceptance-demos.md
  - _bmad-output/specs/spec-pulsecrypto/stories.yaml
  - docs/architecture/architecture.md
  - docs/architecture/adr/ADR-001-combined-binance-stream.md
  - docs/architecture/adr/ADR-002-partial-depth.md
  - docs/architecture/adr/ADR-003-latest-value-buffer.md
  - docs/architecture/adr/ADR-004-snapshot-broadcasting.md
  - docs/architecture/adr/ADR-005-backpressure.md
  - docs/architecture/adr/ADR-006-json-wire-protocol.md
  - docs/architecture/adr/ADR-007-derived-values-and-timestamps.md
  - docs/architecture/adr/ADR-008-connection-lifecycle.md
  - docs/architecture/adr/ADR-009-mobile-state.md
  - docs/architecture/adr/ADR-010-telemetry-isolation.md
  - docs/architecture/adr/ADR-011-market-data-source.md
  - docs/architecture/adr/ADR-012-monorepo-toolchain.md
  - docs/architecture/engineering-standards.md
  - docs/architecture/testing-strategy.md
  - docs/architecture/scope-boundaries.md
  - docs/contracts/websocket-protocol.md
  - docs/contracts/rest-api.md
decisions:
  - "Requirements source is SPEC.md (no PRD exists); UX source is figma-scope.md (no bmad-ux spine exists)."
  - "epics.md expands stories.yaml: the same 14 stories, ids and order, grouped into epics with full acceptance criteria. It does not re-decompose."
  - "Functional IDs stay CAP-1..CAP-17 and non-functional IDs stay NFR-1..NFR-7, as used by AGENTS.md and the ADRs."
  - "Time budget is 3 days (2026-09-19). CAP-15 scope: slider, JS FPS tile, WS msgs/sec tile; memory tile and RESET/HEALTHY chips omitted."
  - "DOWNSTREAM_STABLE_MS = 4 x heartbeatMs, a mobile constant (architecture section 9, approved 2026-09-19)."
  - "architecture.md section 0 and section 12 corrected to include CAP-17 (approved 2026-09-19)."
  - "Open at completion: whether Story 1.1 should create docs/ai/ai-development-log.md (recommended) or Story 3.2 reconstructs it from git history. Not decided; Story 1.1 left unchanged."
---

# PulseCrypto - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for PulseCrypto, decomposing the requirements from the spec (`SPEC.md`, which stands in for a PRD), the Figma scope (`figma-scope.md`, which stands in for a UX design contract), and the accepted architecture and ADRs into implementable stories.

It expands `_bmad-output/specs/spec-pulsecrypto/stories.yaml`. Story numbering, titles and order match that file; this document adds epic grouping and acceptance criteria.

## Requirements Inventory

### Functional Requirements

Source: `SPEC.md` § Capabilities. IDs are the spec's own.

- **CAP-1:** Backend ingests live Binance public market data (order book and last trade with 24h stats) for BTC, ETH, SOL, DOGE and XRP against USDT; more pairs optional. *Success:* all five pairs receive fresh order book and last-price data within 5 s of start, and data keeps arriving continuously.
- **CAP-2:** Backend buffers or batches upstream updates and emits processed updates to clients at a configurable interval, default 100 ms. *Success:* a client observes one emission per interval (default ~10/s) regardless of upstream burst rate; changing the interval changes the observed rate.
- **CAP-3:** Slow or stalled clients cannot cause unbounded backend memory growth. *Success:* a client that stops reading for 60 s leaves backend memory flat (bounded per-client buffer), healthy clients are unaffected; covered by a unit test.
- **CAP-4:** Backend WebSocket server broadcasts processed market updates; every update identifies its pair; the payload format is documented. *Success:* each message validates against the shared contract schema and carries at least `pair`, `timestamp`, `price`, `spread`, `buyPressure`, `sellPressure`, `bids`, `asks`; the README documents every field.
- **CAP-5:** `GET /pairs/meta` returns, per supported pair, display name, trading status, 24h high, 24h low and 24h volume. *Success:* one entry per supported pair with all five fields, validated by the shared contract.
- **CAP-6:** Backend survives loss of the Binance connection: it reconnects automatically and tells clients when data is stale. *Success:* forcibly dropping the upstream socket results in clients receiving a stale status, then fresh data after automatic reconnection, with no backend restart.
- **CAP-7:** User sees a watchlist of all supported pairs; each row shows pair, current price, 24h change, live connection indicator and favourite toggle. *Success:* all five pairs appear with live-updating price and 24h change, a visible connection indicator and a working favourite toggle.
- **CAP-8:** User can search or filter the watchlist. *Success:* typing `btc` leaves only BTC / USDT; clearing the query restores all pairs.
- **CAP-9:** User can favourite pairs, and favourites survive app restarts. *Success:* favourite a pair, kill and relaunch the app, the pair is still favourited.
- **CAP-10:** Selecting a pair shows its market details: current price, buy pressure, sell pressure, spread, live order book (bids and asks), last-updated timestamp. *Success:* tapping any watchlist row opens the details view with all six elements updating live for that pair.
- **CAP-11:** Price increases briefly highlight green, decreases red; order book volume changes animate smoothly. *Success:* in the recording, price ticks visibly flash in the correct colour and depth bars transition rather than jump.
- **CAP-12:** The UI stays smooth and responsive during sustained update bursts. *Success:* on the Android emulator at the default 100 ms interval across all pairs, the JS FPS readout stays at or above 55 and scrolling, search and navigation remain responsive.
- **CAP-13:** When the backend is unavailable, the app shows the connection status, keeps showing the last received data, and reconnects automatically once the backend returns. *Success:* killing the backend flips the status indicator while last prices remain on screen; restarting it restores live data with no user action.
- **CAP-14:** Pull-to-refresh reloads `/pairs/meta` without interrupting the live stream. *Success:* during a pull-to-refresh prices keep updating and the WebSocket is not closed or reopened.
- **CAP-15:** A Telemetry & Settings screen (per the Figma) lets the user adjust update frequency and see real JS frame rate and WebSocket message rate. *Success:* moving the slider between 10 ms and 1000 ms changes the observed msgs/sec for that client; FPS and msgs/sec tiles show live measured values, not constants.
- **CAP-16:** Reviewers receive a runnable repo, a screen recording, and a README covering setup, build/run, architecture decisions, buffering strategy, payload format, assumptions, trade-offs and AI-tool usage. *Success:* a reviewer can follow the README from a fresh clone to a running Android app; the recording covers every item in `acceptance-demos.md`.
- **CAP-17:** Backend can run on a deterministic, offline synthetic market source at a configurable event rate for stress tests and CI; synthetic data is never substituted for Binance automatically and is always labelled as synthetic in the app. *Success:* on the synthetic source at 1000 events/s, all five pairs stream to the app under a visible `SIMULATED` label with no network access to Binance; on Binance with Binance unreachable, clients see stale status and no synthetic prices.

### NonFunctional Requirements

Source: the brief's quality attributes, labelled in `architecture.md` §0 and `SPEC.md` § Constraints.

- **NFR-1:** Clean architecture. Layering `presentation → application → domain`; infrastructure implements domain interfaces and is imported only by the composition root (architecture §1, engineering-standards §3).
- **NFR-2:** Maintainable code. TypeScript strict flag set, naming conventions, no `any`, lint-enforced boundaries (engineering-standards §1–§2).
- **NFR-3:** Responsive UI under continuous updates. At most one market commit per display frame; no React update per upstream event (architecture §6, ADR-009).
- **NFR-4:** Efficient state management. Server state O(pairs), never O(events); no per-client queue; per-pair, per-field selectors on mobile (ADR-003, ADR-009).
- **NFR-5:** Robust connection handling. Two independent reconnect policies with full-jitter backoff, liveness detection and generation ids (ADR-008).
- **NFR-6:** Appropriate error handling. Recoverable errors are handled, counted and surfaced through `market.status`; programmer errors fail loudly; no catch-and-ignore (engineering-standards §4).
- **NFR-7:** Separation of concerns. No provider-shaped object crosses the adapter boundary; telemetry is isolated from the market path (ADR-010, ADR-011).

### Additional Requirements

Technical requirements from the architecture, ADRs, standards, testing strategy and contracts that shape stories. IDs are local to this document.

**Starter template:** none. The walking skeleton (PR #1, `b21a370`; strict flags and boundaries in `fa8c7a1`) already provides the pnpm workspace, `apps/api`, `apps/mobile` and `packages/contracts`. Story 1 therefore builds on the existing skeleton and does not scaffold from a template.

Toolchain and quality gates

- **AR-1 (ADR-012, stack.md):** Keep the proven toolchain: pnpm 12.4.2 with `nodeLinker: hoisted` and `allowBuilds: { esbuild: true }`, `zod` pinned at the root, contracts exporting TS source with no build step, Metro `watchFolders=[workspaceRoot]`, `nodeModulesPaths=[app, root]`, `disableHierarchicalLookup=true`. Pin Node with `engines` and `.nvmrc` at `>=22.4 <23`.
- **AR-2 (testing-strategy):** Vitest for `apps/api` and `packages/contracts`; Jest with `jest-expo` and React Native Testing Library for `apps/mobile`. Fake timers for every cadence, backoff and heartbeat test; with real sockets fake only `setTimeout`, `setInterval` and `Date`. No coverage threshold.
- **AR-3 (engineering-standards §1–§3):** TypeScript flags `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`. ESLint `no-explicit-any: error` and `no-restricted-imports` stopping `domain/**` and `application/**` from importing `infrastructure/binance/**` or `infrastructure/simulator/**`. `domain/` never imports `packages/contracts`. No Binance-named identifier in `domain/` or `application/`.
- **AR-4 (testing-strategy):** CI runs typecheck, lint and tests. CI never contacts Binance; it runs against the simulator or fixtures.

Wire contracts

- **AR-5 (ADR-006, websocket-protocol.md):** `packages/contracts` holds Zod schemas (default `.strip()`), inferred types, `DISPLAY_LEVELS = 10`, `MAX_LEVELS = 20`, `DEFAULT_HEARTBEAT_MS = 5000`, `decodeServerMessage(raw: unknown)` and the backoff helper. Envelope `{ v: 1, type, t }`; all wire times are integer ms epoch; `pair` matches `^[A-Z0-9]+$` and is not an enum.
- **AR-6 (engineering-standards §6, AGENTS.md):** `decodeServerMessage` full-parses in `__DEV__` and envelope-parses in production. It is the only permitted cast of external data. A `__DEV__` failure is logged once per type and the message dropped; `v ≠ 1` moves the socket to `INCOMPATIBLE`.
- **AR-7 (ADR-008):** Backoff `delay(attempt) = floor(random() × min(cap, base × 2^attempt))`, `attempt` from 0, `random` injected; one pure function, one shared set of test vectors.
- **AR-8 (testing-strategy, ADR-006):** Contract tests: every example in `websocket-protocol.md` §9 and `rest-api.md` parses; every invalid case in `websocket-protocol.md` §10 and `rest-api.md` § Invalid cases is rejected. Schema, document and tests change together.

Market data ingestion

- **AR-9 (ADR-011):** `MarketDataSource { kind; start(sink); stop() }` emitting only `MarketEvent = DepthUpdate | TickerUpdate | SourceStatusChange`. Every source emits `SourceStatusChange{connected:true}` before its first data event and `{connected:false}` on any loss. `MARKET_SOURCE=binance|simulator` selected at startup in the composition root; no runtime switch; no automatic fallback.
- **AR-10 (ADR-011, architecture §9):** Simulator is deterministic and offline; `SIMULATOR_RATE` is total events/s split evenly across pairs, with at least one depth event per pair per 100 ms.
- **AR-11 (ADR-001, ADR-002):** One combined Binance connection (`<pair>@depth20@100ms` + `<pair>@ticker` per pair); pair derived from the wrapper `stream` name; each depth frame replaces the book; no diff sync.
- **AR-12 (architecture §3):** Adapter Zod-parses every frame and converts strings to `number`. A book is valid iff bids are strictly descending, asks strictly ascending and `bestBid < bestAsk` when both sides exist; an empty side is valid. Invalid frames are dropped, counted in `upstream.frames.invalid` and never thrown past the adapter.
- **AR-13 (ADR-008):** Upstream client is `ws` 8.21.3 declared in `apps/api`. States `idle → connecting → connected → disconnected → reconnecting`. Attempt ends on the first of `error`, `close`, `unexpected-response` or `UPSTREAM_CONNECT_TIMEOUT_MS`. Silence watchdog from `open` (`UPSTREAM_SILENCE_MS`). Backoff 1 s / 30 s, reset after 60 s connected. HTTP 451 logged with a `BINANCE_WS_URL` hint. Transitions idempotent; timers bound to a generation id.

Domain and buffering

- **AR-14 (ADR-007):** `spread = bestAsk − bestBid`; `buyPressure = 100 × ΣbidQty / (ΣbidQty + ΣaskQty)` over the 10 displayed levels, rounded to 2 dp; `sellPressure = round2(100 − buyPressure)`; all three `null` when a side is empty. `change24hPct` = ticker `P`; `volume24h` = quote volume `q`. `lastDepthAt`, `lastTickerAt` = server receive time; `timestamp` = the later.
- **AR-15 (architecture §5):** A pair is stale iff upstream is disconnected, it has never had a depth update, or `now − lastDepthAt > STALE_AFTER_MS`.
- **AR-16 (ADR-003):** Latest-value `Map<Pair, PairState>` overwritten in place; every mutation stamps `rev` from one process-wide monotonic sequence; no per-client message queue anywhere.

Gateway and sessions

- **AR-17 (ADR-004):** On connect send `market.snapshot` (every configured pair, nullable fields before first data) then `market.status`, and set `cursor` to the sequence value at snapshot time. Each tick sends `market.batch` with pairs whose `rev > cursor`, then advances `cursor`; an empty tick sends nothing. One timer per session, cleared on close. Accepted `client.setInterval` (integer 10..1000) re-arms so the next tick fires at `min(new, remaining)` and sends `market.status` as the ack; out of range → `error BAD_REQUEST`, old value kept.
- **AR-18 (ADR-004):** Serialize once: at most one cached JSON fragment per pair, replaced when that pair's `rev` changes, built lazily on the first tick that needs it.
- **AR-19 (ADR-005):** Only `market.batch` is gated. `bufferedAmount > WS_SOFT_LIMIT_BYTES` → skip, cursor not advanced, `ws.frames.skipped`. Above soft continuously for `SLOW_CLIENT_MAX_STALL_MS` (checked every tick, including empty ticks) or above `WS_HARD_LIMIT_BYTES` → close `4008`, log once, `ws.clients.evicted`.
- **AR-20 (architecture §4, websocket-protocol §4.6):** Gateway `maxPayload` 4 KiB; binary, non-JSON, invalid or `v ≠ 1` client input → `error BAD_REQUEST`; the third rejection on one connection closes `1008`.
- **AR-21 (ADR-008, architecture §5):** Server pings every 15 s and terminates after 30 s without a pong (`ws.clients.timedOut`). `market.status { source, upstream: { connected, since }, stalePairs, intervalMs, heartbeatMs, serverTime }` carries the complete stale set and is sent on connect, on any change and every `heartbeatMs`. Downstream sockets stay open during an upstream outage.

REST, config, observability

- **AR-22 (rest-api.md, architecture §3):** `GET /pairs/meta` returns `displayName`, `tradingStatus` (`TRADING` | `HALTED`), `pricePrecision`, `quantityPrecision` from static config and nullable `high24h`, `low24h`, `volume24h` from the live map. Startup fails if a `PAIRS` entry has no meta. `GET /health` returns 200 whenever HTTP is served, with source, upstream state, uptime, counters and event-loop delay.
- **AR-23 (architecture §9):** Server config Zod-parsed once at startup, failing fast: `HOST`, `PORT`, `MARKET_SOURCE`, `BINANCE_WS_URL`, `PAIRS`, `BROADCAST_INTERVAL_MS`, `STALE_AFTER_MS`, `UPSTREAM_SILENCE_MS`, `UPSTREAM_CONNECT_TIMEOUT_MS`, `WS_SOFT_LIMIT_BYTES`, `WS_HARD_LIMIT_BYTES`, `SLOW_CLIENT_MAX_STALL_MS`, `SIMULATOR_RATE`. Values marked "chosen in implementation" are documented as config defaults, never as measured.
- **AR-24 (architecture §8, engineering-standards §5):** Integer counters `upstream.frames.{received,invalid}`, `upstream.connect.failed`, `upstream.reconnects`, `buffer.mutations`, `ws.frames.{sent,skipped}`, `ws.clients.{active,evicted,timedOut}` plus `monitorEventLoopDelay`, exposed read-only on `/health`. Pino logs state transitions only; no log call in ingest, normalize or broadcast paths.
- **AR-25 (engineering-standards §4):** Recoverable errors are handled, counted and surfaced via `market.status`; the process never crashes on them. Programmer errors fail loudly. No catch-and-ignore in an adapter.

Mobile

- **AR-26 (ADR-008, ADR-009):** `MarketSocket` is a module-level service started once at app root. States include `paused` and `INCOMPATIBLE`. Backoff 0.5 s / 5 s, reset after `DOWNSTREAM_STABLE_MS` (a mobile constant, `4 × heartbeatMs`, 20 s at the default; it must exceed the `3 × heartbeatMs` liveness window) open past the first snapshot; a `4008` close never resets. Liveness: no message for `3 × heartbeatMs`. `AppState` background → `paused` (socket closed, no retry); `active` → connect at once. Timers bound to a generation id. Re-sends the interval on connect only if the user has set one.
- **AR-27 (ADR-009):** `onmessage` decodes and merges pairs into a pending `Map<Pair, PairSnapshot>`; one `requestAnimationFrame` flush commits to `marketStore`. Apply rules: book group replaces only when `lastDepthAt` is non-null, ticker group only when `lastTickerAt` is non-null; pairs are never deleted; a new connection's snapshot replaces stored revs unconditionally.
- **AR-28 (ADR-009):** State owners: `marketStore` (Zustand), TanStack Query `['pairs','meta']`, `favouritesStore` (AsyncStorage, pre-hydration absolute intents `{pair, favourite}` applied last-write-wins), `settingsStore` (interval `null` until set), `telemetryStore`. New dependencies Zustand 5.x, TanStack Query 5.x and AsyncStorage via `npx expo install`, each justified in its PR.
- **AR-29 (engineering-standards §7, ADR-009):** Per-pair, per-field stable selectors; no market state copied into component state; order-book rows keyed by index; core `Animated` with the native driver; no Reanimated; `FlatList`.
- **AR-30 (ADR-010):** Telemetry: rAF frame counter and message counter (`market.batch` and `market.snapshot` only) in refs, read-and-reset by a 1 Hz timer into `telemetryStore`. Market code may only increment a counter; it never reads, awaits or branches on telemetry.
- **AR-31 (stack.md, architecture §6):** `EXPO_PUBLIC_API_URL` is an `http://host:port` origin; unset → `http://10.0.2.2:8080` on Android, `http://localhost:8080` on iOS; `api-endpoints` derives the WS URL.
- **AR-32 (ADR-007, architecture §6):** Age display = `(Date.now() − localReceiveAt) + (t − timestamp)`; the device clock is never compared directly with server time.

Verification and delivery

- **AR-33 (testing-strategy § Stress):** Stress run with `SIMULATOR_RATE=1000`, `BROADCAST_INTERVAL_MS=100`, five pairs, 60 s. Record the testing-strategy metric list and the exact reproduce command in `docs/verification/stress-results.md`. Measured numbers only.
- **AR-34 (testing-strategy § Resilience):** Manual resilience run (primary and four secondary scenarios) recorded in `docs/verification/resilience-results.md`. Confirms two assumptions left open by the ADRs: `ws` answers Binance pings over a >2 min run, and React Native answers server pings natively.
- **AR-35 (SPEC constraints, AGENTS.md):** No performance or resilience claim anywhere unless measured and recorded in `docs/verification/`.
- **AR-36 (engineering-standards §9):** Rejected review findings are recorded, with a reason, in `docs/ai/ai-development-log.md`; this log also feeds the README's AI-tool section (CAP-16).
- **AR-37 (scope-boundaries §1):** No database, Redis, Kafka, microservices, Kubernetes, event sourcing, binary protocol, GPU pipeline, auth or trading. No stub or interface for scale-out.

### UX Design Requirements

Source: `figma-scope.md`, `docs/reference/figma-reference.png`, and architecture §6. There is no bmad-ux spine; these requirements are the complete UX contract.

- **UX-DR-1:** Bottom tabs Terminal, Markets, Telemetry, Settings. Settings opens the same combined Telemetry & Settings screen as Telemetry.
- **UX-DR-2:** Header shows the pair name, a liveness chip and the live icon. Chip precedence `offline` (socket not open) > `stale` > `live`, with `INCOMPATIBLE` on a protocol mismatch. A `SIMULATED` chip appears whenever `source ≠ binance` (not in the PNG). A status equal to the stored one causes no commit.
- **UX-DR-3:** Markets tab (not in the PNG, same visual language): one row per key of `marketStore.pairs`, showing display name (falls back to the raw pair id when meta is missing), last traded price, 24h change in arrow format (`▲ 1.82%` / `▼ 0.41%`), per-pair liveness indicator and favourite toggle. Null fields render `—`.
- **UX-DR-4:** Search field filters case-insensitively over `pair` and `displayName`; the filter does not subscribe to prices.
- **UX-DR-5:** Pull-to-refresh on the watchlist calls the meta query's `refetch()` only; it never touches `MarketSocket`.
- **UX-DR-6:** Price flash: green on uptick, red on downtick, none when unchanged; core `Animated` opacity on the native driver.
- **UX-DR-7:** Terminal header block: last price, 24h % change, 24h high and 24h low, last-updated age (AR-32). Market cap is excluded.
- **UX-DR-8:** Order book laid out as in the Figma: bids (green) above asks (red), `DISPLAY_LEVELS = 10` per side, columns PRICE / AMOUNT / TOTAL. TOTAL = cumulative quantity. Depth-bar width = cumulative qty ÷ max cumulative qty over both displayed sides, drawn with `scaleX` anchored left for bids and right for asks. Rows keyed by index `0..9`. Price and quantity rounded per pair with `pricePrecision` / `quantityPrecision`.
- **UX-DR-9:** Market depth visual with bid and ask totals, minimal; may use up to 20 levels.
- **UX-DR-10:** Liquidity gap = `spread / mid × 100` %. Pressure label from `buyPressure`: ≥ 55 Buy Heavy, ≤ 45 Sell Heavy, otherwise Balanced. Buy % and sell % numbers are also shown. Null values render `—`, never `0` or `50`.
- **UX-DR-11:** Telemetry & Settings: update-frequency slider 10–1000 ms that sends `client.setInterval` on release and shows the acknowledged `market.status.intervalMs`; JS FPS tile and WS msgs/sec tile with live measured values. The memory tile and the `RESET` / `HEALTHY` chips are **omitted** under the 3-day budget (SPEC assumption, 2026-09-19); ADR-010 already permits omission.
- **UX-DR-12:** Visual language: dark trading-terminal theme, green for bids and upticks, red for asks and downticks, monospaced numerics, uppercase micro-labels. Nothing beyond the PNG.
- **UX-DR-13:** Excluded Figma elements, not to be built: market cap, binary-compression and adaptive-polling toggles, GPU acceleration / API latency / storage-cache cards, the side drawer (profile, API keys, security, trade history, support, sign out).

### FR Coverage Map

| CAP | Epic | Notes |
|---|---|---|
| CAP-1 | Epic 1 | Binance ingestion (Story 1.4) |
| CAP-2 | Epic 1 | Latest-value buffer and per-session cadence (Stories 1.3, 1.5) |
| CAP-3 | Epic 1, Epic 3 | Built in Story 1.6; measured in Story 3.1 |
| CAP-4 | Epic 1 | Contracts and gateway (Stories 1.2, 1.5) |
| CAP-5 | Epic 1 | `/pairs/meta` (Stories 1.2, 1.7) |
| CAP-6 | Epic 1 | Upstream reconnect and staleness (Stories 1.4, 1.5) |
| CAP-7 | Epic 2 | Watchlist rows (Story 2.2) |
| CAP-8 | Epic 2 | Search (Story 2.3) |
| CAP-9 | Epic 2 | Favourites (Story 2.3) |
| CAP-10 | Epic 2 | Terminal screen (Story 2.4) |
| CAP-11 | Epic 2 | Price flash (Story 2.2), depth bars (Story 2.4) |
| CAP-12 | Epic 2, Epic 3 | Built across Epic 2; measured in Story 3.1 |
| CAP-13 | Epic 2 | `MarketSocket` and apply rules (Story 2.1) |
| CAP-14 | Epic 2 | Pull-to-refresh (Story 2.3) |
| CAP-15 | Epic 1, Epic 2 | `client.setInterval` (Story 1.5); slider and tiles (Story 2.5) |
| CAP-16 | Epic 3 | README and recording (Story 3.2) |
| CAP-17 | Epic 1, Epic 2, Epic 3 | Simulator (Story 1.3); `SIMULATED` chip (Story 2.2); stress run (Story 3.1) |

NFR-1, NFR-2, NFR-6, NFR-7: every epic; enforced from Story 1.1. NFR-3: Epic 2. NFR-4: Epics 1 and 2. NFR-5: Stories 1.4, 1.5, 2.1.
AR-1 to AR-25: Epic 1. AR-37 (scope exclusions) is a cross-cutting constraint: no story implements it; every story's review enforces it through AGENTS.md. AR-26 to AR-32: Epic 2. AR-33 to AR-36: Epic 3. UX-DR-1 to UX-DR-13: Epic 2.

## Epic List

### Epic 1: Live market gateway

Any WebSocket client can connect and receive live, processed market data for all five pairs at its own interval. The backend survives Binance outages, stays memory-bounded under slow clients, and can run offline on a labelled synthetic source.

**FRs covered:** CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6, CAP-15 (server side), CAP-17 (source)
**Stories (stories.yaml ids):** 1.1 = 1, 1.2 = 2, 1.3 = 3, 1.4 = 4, 1.5 = 5, 1.6 = 6, 1.7 = 7

### Epic 2: Mobile market viewer

A user on the Android emulator watches all pairs stream live, searches, keeps favourites across restarts, opens a pair to see its animated order book, pressure and spread, and tunes the update rate while seeing real FPS and message rate. Last data stays on screen through a backend outage.

**FRs covered:** CAP-7, CAP-8, CAP-9, CAP-10, CAP-11, CAP-12, CAP-13, CAP-14, CAP-15, CAP-17 (label)
**Stories (stories.yaml ids):** 2.1 = 8, 2.2 = 9, 2.3 = 10, 2.4 = 11, 2.5 = 12
**Depends on:** Epic 1 (runs fully against the simulator).

### Epic 3: Verified, reviewable delivery

A reviewer goes from a fresh clone to a running app using the README, watches a recording covering every acceptance demo, and finds measured stress and resilience evidence rather than claims.

**FRs covered:** CAP-16; measured evidence for CAP-3, CAP-12, CAP-17
**Stories (stories.yaml ids):** 3.1 = 13, 3.2 = 14
**Depends on:** Epics 1 and 2.

<!-- Story sections. Each story adds one line beyond the template: **Requirements:** lists the IDs it
     satisfies, because AGENTS.md requires reading every requirement ID a story references. -->

## Epic 1: Live market gateway

Any WebSocket client can connect and receive live, processed market data for all five pairs at its own interval. The backend survives Binance outages, stays memory-bounded under slow clients, and can run offline on a labelled synthetic source.

**Configuration grows with the stories.** `apps/api/src/config.ts` is created in Story 1.3 as a Zod schema holding only the variables that story needs. Each later story adds its own variables. Story 1.7 completes the architecture §9 set and the fail-fast startup behaviour. No story depends on a later one for its config.

### Story 1.1: Toolchain baseline and CI

As a developer on PulseCrypto,
I want one command each for typecheck, lint and test across all three packages, enforced in CI,
So that every later story is held to the same architectural and type-safety gates from its first commit.

**Requirements:** NFR-1, NFR-2 · AR-1, AR-2, AR-3, AR-4

**Acceptance Criteria:**

**Given** a fresh clone with Node 22.x and pnpm 12.4.2
**When** `pnpm install --frozen-lockfile` then `pnpm typecheck`, `pnpm lint` and `pnpm test` run from the repository root
**Then** each command runs across `apps/api`, `apps/mobile` and `packages/contracts` and exits 0
**And** the root `package.json` declares `engines.node` `>=22.4 <23` and a `.nvmrc` pins 22

**Given** the test runners
**When** `pnpm test` runs
**Then** Vitest executes in `apps/api` and `packages/contracts`, and Jest with the `jest-expo` preset and React Native Testing Library executes in `apps/mobile`
**And** each package has at least one passing test that proves its runner is wired
**And** the shared Vitest setup documents the fake-timer rule (fake only `setTimeout`, `setInterval`, `Date` when real sockets are involved)

**Given** the six compiler flags in engineering-standards §1
**When** each package is typechecked
**Then** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax` and `noFallthroughCasesInSwitch` are enabled in `apps/api`, `apps/mobile` and `packages/contracts`
**And** if a flag cannot be enabled under `expo/tsconfig.base`, the story stops and raises it instead of dropping the flag

**Given** a file under `apps/api/src/domain/` or `apps/api/src/application/`
**When** it imports from `infrastructure/binance/**` or `infrastructure/simulator/**`, or a file under `domain/` imports `@pulsecrypto/contracts`
**Then** `pnpm lint` fails with the rule's message
**And** this is proven by a test that lints fixture source through the ESLint Node API, not by manual inspection
**And** `@typescript-eslint/no-explicit-any` is `error` in all three packages

**Given** a push or pull request
**When** the `.github/workflows/ci.yml` workflow runs
**Then** it installs with the pinned pnpm and the `.nvmrc` Node version and runs typecheck, lint and test
**And** no job opens a connection to Binance

**Given** the new dev dependencies (Vitest, Jest, jest-expo, React Native Testing Library, ESLint for mobile)
**When** the PR is opened
**Then** its description carries a one-line justification for each

### Story 1.2: Wire contracts and protocol conformance

As a client developer consuming the gateway,
I want runtime Zod schemas and helpers in `packages/contracts` that match the protocol documents exactly,
So that the API and the app cannot drift apart and every message can be validated at the boundary.

**Requirements:** CAP-4, CAP-5 · NFR-2, NFR-6 · AR-5, AR-6, AR-7, AR-8

`docs/contracts/websocket-protocol.md` and `rest-api.md` already exist (commit `ed227f6`). This story implements the code and tests against them; any discrepancy found is fixed in the schema, the document and the tests in the same change.

**Acceptance Criteria:**

**Given** `packages/contracts`
**When** its public exports are inspected
**Then** it exports schemas and inferred types for the server envelope, the client envelope, `PairSnapshot`, `market.snapshot`, `market.batch`, `market.status`, `error`, `client.setInterval`, `PairsMetaResponse` and `HealthResponse`
**And** it exports `PROTOCOL_VERSION = 1`, `DISPLAY_LEVELS = 10`, `MAX_LEVELS = 20` and `DEFAULT_HEARTBEAT_MS = 5000`
**And** schemas use Zod's default `.strip()`, and `pair` is validated as `^[A-Z0-9]+$`, not as an enum
**And** the skeleton's `MarketSnapshot` schema is removed, and both apps still import a runtime schema from contracts and typecheck

**Given** every example message in `websocket-protocol.md` §9 and every example in `rest-api.md`
**When** the contract tests run
**Then** each example is read from the Markdown source, not copied, and parses against its schema
**And** every case in `websocket-protocol.md` §10 and `rest-api.md` § Invalid cases has its own test and is rejected

**Given** `decodeServerMessage(raw: unknown, mode)` where `mode` is `'full'` or `'envelope'`
**When** it receives a valid message
**Then** it returns a success result with the typed message in both modes
**And** in `'full'` mode an invalid body returns an invalid result, not a throw
**And** in `'envelope'` mode only `v`, `type` and `t` are parsed, and this is the only cast of external data in the repository
**And** `v ≠ 1` returns an incompatible result in both modes
**And** the mode is a parameter, so both paths are tested in Vitest without a `__DEV__` global

**Given** `backoffDelay(attempt, { baseMs, capMs }, random)`
**When** it is run against one shared table of test vectors
**Then** it returns `floor(random() × min(capMs, baseMs × 2^attempt))` for `attempt` from 0
**And** `random() = 0` gives 0, results never exceed `capMs`, and every result is an integer
**And** the vectors cover both parameter sets in use (1000/30000 upstream, 500/5000 downstream)

**Given** the contracts package
**When** it is reviewed
**Then** it contains no I/O, timers or module state

### Story 1.3: Domain model, latest-value buffer and simulator source

As an operator running the backend offline,
I want one current state per pair, fed by a deterministic synthetic source,
So that the whole pipeline can run and be tested without Binance or a network.

**Requirements:** CAP-2, CAP-17 · NFR-1, NFR-4, NFR-7 · AR-9, AR-10, AR-14, AR-15, AR-16, AR-24

**Acceptance Criteria:**

**Given** `apps/api/src/domain`
**When** it is inspected and linted
**Then** it defines `MarketDataSource`, `MarketEventSink` and `MarketEvent = DepthUpdate | TickerUpdate | SourceStatusChange` as in ADR-011
**And** it imports neither `infrastructure/**` nor `@pulsecrypto/contracts`, and no identifier in `domain/` or `application/` is named after Binance

**Given** a `DepthUpdate` applied to a pair
**When** the domain folds it into `PairState`
**Then** the book is replaced, `lastDepthAt` is the supplied receive time, and `timestamp = max(lastDepthAt, lastTickerAt)`
**And** `spread = bestAsk − bestBid`
**And** `buyPressure = round2(100 × ΣbidQty / (ΣbidQty + ΣaskQty))` over the first 10 levels only, even when 20 are supplied, and `sellPressure = round2(100 − buyPressure)`
**And** when either side is empty, `spread`, `buyPressure` and `sellPressure` are `null`, never `0` or `50`
**And** `buyPressure + sellPressure = 100` within floating-point tolerance

**Given** a `TickerUpdate` applied to a pair
**When** the domain folds it into `PairState`
**Then** `price`, `change24hPct`, `high24h`, `low24h`, `volume24h` (quote volume) and `lastTickerAt` are replaced as one group, and the book group is untouched

**Given** the latest-value map in `application/`, initialised with one entry per configured pair at `rev = 0` with null groups
**When** events are applied
**Then** each mutation stamps `rev` from one process-wide monotonic sequence, so `rev` strictly increases across all pairs
**And** after 10 000 events the map still has exactly one entry per configured pair, and no per-event collection exists
**And** each mutation increments `buffer.mutations`

**Given** the pure staleness function
**When** it is tested
**Then** a pair is stale iff upstream is disconnected, it has never had a depth update, or `now − lastDepthAt > STALE_AFTER_MS`, and each condition has its own test

**Given** `SimulatorMarketDataSource` with a fixed seed and `SIMULATOR_RATE`
**When** it is started with fake timers
**Then** it emits `SourceStatusChange { connected: true }` before its first data event
**And** the same seed produces the same event sequence
**And** events are split evenly across pairs with at least one depth event per pair per 100 ms
**And** every generated book passes the book-validity rule (bids strictly descending, asks strictly ascending, bestBid < bestAsk)
**And** after `stop()` resolves, no further events are emitted and no timers remain

**Given** `apps/api/src/config.ts`
**When** this story is complete
**Then** it Zod-parses `PAIRS`, `MARKET_SOURCE` and `SIMULATOR_RATE` with architecture §9 defaults

### Story 1.4: Binance market data adapter

As an operator running against the live market,
I want the backend to ingest the combined Binance depth and ticker stream for all pairs and recover from upstream loss by itself,
So that clients get real prices without a restart when Binance drops.

**Requirements:** CAP-1, CAP-6 · NFR-5, NFR-6, NFR-7 · AR-11, AR-12, AR-13, AR-24, AR-25

Automated tests use recorded frame fixtures (`binance-feed.md` samples) and a fake socket factory; live Binance is used only in the manual check.

**Acceptance Criteria:**

**Given** `PAIRS` and `BINANCE_WS_URL`
**When** the adapter starts
**Then** it opens one connection to `<base>/stream?streams=` listing `<pair>@depth20@100ms` and `<pair>@ticker` for every configured pair, in lower case

**Given** a recorded combined-stream depth frame
**When** the adapter receives it
**Then** it emits a `DepthUpdate` whose pair comes from the `stream` name and whose prices and quantities are numbers
**And** given a recorded ticker frame it emits a `TickerUpdate` mapping `c`, `P`, `h`, `l` and `q`
**And** no Binance-shaped object or field name leaves `infrastructure/binance/`

**Given** a malformed frame (invalid JSON, unknown stream, unconfigured pair, non-numeric string, crossed or mis-ordered book)
**When** the adapter receives it
**Then** no event is emitted, `upstream.frames.invalid` increments, nothing is thrown, and nothing is logged per frame
**And** every received frame increments `upstream.frames.received`

**Given** the connection opens
**When** the first data frame arrives
**Then** `SourceStatusChange { connected: true }` has already been emitted, and `{ connected: false }` is emitted on any loss

**Given** a fake socket factory and fake timers
**When** a connection attempt fails through `error`, `close`, `unexpected-response` or `UPSTREAM_CONNECT_TIMEOUT_MS`
**Then** the attempt ends exactly once, even if several of these fire
**And** the next attempt is scheduled with the contracts backoff helper at base 1 s, cap 30 s, `upstream.reconnects` increments, and a failed handshake increments `upstream.connect.failed`
**And** the attempt counter resets only after 60 s connected
**And** callbacks from a superseded socket generation are ignored

**Given** an open connection
**When** no frame arrives for `UPSTREAM_SILENCE_MS`
**Then** the socket is terminated and a reconnect is scheduled

**Given** an HTTP 451 handshake response
**When** it is received
**Then** one warning is logged naming `BINANCE_WS_URL` and `wss://data-stream.binance.vision`, and the adapter keeps backing off without substituting synthetic data

**Given** `stop()` is called
**When** it resolves
**Then** the socket is closed, every timer is cleared, and no reconnect follows

**Given** `ws` 8.21.3
**When** it is added to `apps/api`
**Then** it is a declared dependency with the ADR-008 justification in the PR description
**And** `config.ts` gains `BINANCE_WS_URL`, `UPSTREAM_SILENCE_MS` and `UPSTREAM_CONNECT_TIMEOUT_MS`

**Given** network access to Binance (manual check, recorded in the PR)
**When** the adapter runs with the default five pairs
**Then** all five pairs receive depth and ticker events within 5 s of start

### Story 1.5: WebSocket gateway and client sessions

As a client connected to the gateway,
I want a complete snapshot on connect, then only changed pairs at my own interval, plus a status heartbeat that tells me when data is stale,
So that I always hold current state at a cadence I control and never mistake frozen prices for live ones.

**Requirements:** CAP-2, CAP-4, CAP-6, CAP-15 (server side) · NFR-4, NFR-5, NFR-6 · AR-17, AR-18, AR-20, AR-21, AR-24

Integration tests wire a fake `MarketDataSource` through the buffer to real `ws` clients, with fake `setTimeout`, `setInterval` and `Date` only.

**Acceptance Criteria:**

**Given** a client connects to `/ws`
**When** the connection opens
**Then** the first message is `market.snapshot` containing every configured pair exactly once, with nullable fields `null` and book sides `[]` for pairs without data
**And** the second message is `market.status`, and both arrive before any `market.batch`

**Given** a connected client at the default `BROADCAST_INTERVAL_MS = 100`
**When** the source emits 1000 events per second for 1 s
**Then** the client receives about 10 `market.batch` messages, each containing only pairs with `rev > cursor`, each pair at most once and complete
**And** a tick with no changed pair sends nothing, and no `market.batch` has an empty `pairs` array

**Given** a client sends a valid `client.setInterval { intervalMs: 250 }`
**When** the server accepts it
**Then** a `market.status` with `intervalMs: 250` is sent immediately, and the next tick fires at `min(250, remaining)`
**And** two clients on 100 ms and 1000 ms each receive their own cadence from the shared map

**Given** a rejected client message (`intervalMs` 5, 1001, 250.5 or `"250"`, a missing field, an unknown `type`, `v ≠ 1`, a binary frame or non-JSON)
**When** the server receives it
**Then** it replies `error { code: 'BAD_REQUEST' }` and keeps the previous interval
**And** the third rejection on one connection closes it with `1008`, and an inbound frame over 4 KiB closes it with `1009`

**Given** a connected client
**When** status is observed over time
**Then** `market.status` carries `source`, `upstream { connected, since }`, the complete `stalePairs` set, `intervalMs`, `heartbeatMs` and `serverTime = t`, and is sent on connect, on any change and every `heartbeatMs`
**And** when the source emits `SourceStatusChange { connected: false }`, the client receives `upstream.connected: false` with every pair stale within one heartbeat while its socket stays open
**And** when the source reconnects, the client receives `connected: true` and fresh batches with no backend restart

**Given** three connected clients
**When** a pair changes once
**Then** that pair is serialized to JSON once, built lazily on the first tick that needs it

**Given** a client that stops answering pings
**When** 30 s pass without a pong
**Then** it is terminated and `ws.clients.timedOut` increments; pings go out every 15 s

**Given** a client disconnects
**When** its socket closes
**Then** its timer is cleared, its session is removed, `ws.clients.active` decrements, and other clients keep receiving without interruption

**Given** every message received in these tests
**When** it is full-parsed with the contracts schemas
**Then** it validates
**And** `PairState → PairSnapshot` mapping happens only in `presentation/`, the composition root selects the source from `MARKET_SOURCE` and is the only importer of `infrastructure/`, and connect or disconnect is logged while ticks are not
**And** `config.ts` gains `BROADCAST_INTERVAL_MS` and `STALE_AFTER_MS`

### Story 1.6: Slow-consumer backpressure

As an operator of the gateway,
I want network-slow clients to receive fewer but still-current frames, and stalled clients to be evicted,
So that one bad connection can never grow backend memory without bound or starve healthy clients.

**Requirements:** CAP-3 · NFR-4, NFR-5, NFR-6 · AR-19, AR-24

**Acceptance Criteria:**

**Given** a session whose socket reports `bufferedAmount > WS_SOFT_LIMIT_BYTES`
**When** a tick runs
**Then** no `market.batch` is written, the cursor is unchanged, and `ws.frames.skipped` increments
**And** `market.snapshot`, `market.status` and `error` bypass the gate

**Given** a pair changes during a skipped tick
**When** `bufferedAmount` falls to or below the soft limit on a later tick
**Then** that pair's latest value is delivered on that tick, and the test asserts the cursor stayed unchanged across every skipped tick in between

**Given** a session above the soft limit
**When** it stays above on every tick, including empty ticks, for `SLOW_CLIENT_MAX_STALL_MS`
**Then** it is closed with `4008` `"slow consumer"`, `ws.clients.evicted` increments, and one log line is written
**And** a tick at or below the soft limit resets the stall timer
**And** the same stall budget evicts a 10 ms client and a 1000 ms client after the same elapsed time

**Given** a session whose `bufferedAmount` exceeds `WS_HARD_LIMIT_BYTES` at any check
**When** the check runs
**Then** it is closed with `4008` immediately

**Given** an integration test with a raw client that stops reading its socket and a healthy client
**When** the stalled client is evicted
**Then** the healthy client keeps receiving batches at its interval throughout
**And** no per-client queue or per-event structure exists; server state stays one map entry per pair plus one cursor and timer per session

**Given** `WS_SOFT_LIMIT_BYTES`, `WS_HARD_LIMIT_BYTES` and `SLOW_CLIENT_MAX_STALL_MS`
**When** the story is complete
**Then** all three are in `config.ts`, and `websocket-protocol.md` §5 states the chosen `SLOW_CLIENT_MAX_STALL_MS` default as a config default, not a measurement
**And** the 60 s flat-memory claim for CAP-3 is left to Story 3.1 to measure, not asserted here

### Story 1.7: REST endpoints and server configuration

As a client developer and an operator,
I want `/pairs/meta` for display metadata, `/health` for live counters, and a server that refuses to start on bad configuration,
So that the app can label pairs, the stress test can read real numbers, and misconfiguration fails loudly instead of silently.

**Requirements:** CAP-5 · NFR-6 · AR-22, AR-23, AR-24

**Acceptance Criteria:**

**Given** the server is running
**When** `GET /pairs/meta` is called
**Then** it returns `200` with exactly one entry per configured pair, with static `displayName`, `tradingStatus`, `pricePrecision` and `quantityPrecision`, and `high24h`, `low24h` and `volume24h` read from the latest-value map (`null` before the pair's first ticker)
**And** the response validates against the contracts `PairsMetaResponse` schema in an integration test

**Given** the server is running with upstream disconnected
**When** `GET /health` is called
**Then** it returns `200` with `source`, `upstream`, `uptimeMs`, `serverTime`, every counter named in architecture §8, and `eventLoopDelayMs` from `monitorEventLoopDelay`
**And** the body validates against `HealthResponse`, and reading it twice never resets a counter

**Given** invalid configuration (for example `BROADCAST_INTERVAL_MS=5`, `MARKET_SOURCE=coinbase`, `PAIRS=btcusdt`, or a `PAIRS` entry without static meta)
**When** the server starts
**Then** it exits non-zero with a message naming the invalid variable, before listening on any port

**Given** `config.ts`
**When** this story is complete
**Then** it parses every server variable in architecture §9 once at startup, including `HOST` and `PORT` (default `0.0.0.0:8080`)
**And** every value marked "chosen in implementation" is listed with its default in one place, labelled as a config default, not a measurement

## Epic 2: Mobile market viewer

A user on the Android emulator watches all pairs stream live, searches, keeps favourites across restarts, opens a pair to see its animated order book, pressure and spread, and tunes the update rate while seeing real FPS and message rate. Last data stays on screen through a backend outage.

Every story in this epic runs against the Epic 1 gateway on `MARKET_SOURCE=simulator`; none needs Binance.

### Story 2.1: Mobile market data layer

As a mobile user,
I want the app to hold one live connection that survives navigation, backgrounding and backend restarts while keeping the last data on screen,
So that prices never blank out and the app recovers without my help.

**Requirements:** CAP-13 · NFR-3, NFR-4, NFR-5 · AR-6, AR-26, AR-27, AR-28, AR-31

**Acceptance Criteria:**

**Given** `EXPO_PUBLIC_API_URL` set to an `http://host:port` origin, or unset
**When** `api-endpoints` resolves URLs
**Then** REST uses that origin and the socket uses `ws://host:port/ws`
**And** when unset, Android uses `http://10.0.2.2:8080` and iOS uses `http://localhost:8080`

**Given** the app starts
**When** the root component mounts
**Then** exactly one module-level `MarketSocket` is started, and navigating between screens never opens or closes a socket

**Given** a server message
**When** `MarketSocket` decodes it with `decodeServerMessage`
**Then** it full-parses in `__DEV__` and envelope-parses in production
**And** a `__DEV__` parse failure is logged once per message type and the message dropped
**And** `v ≠ 1` moves the socket to `INCOMPATIBLE` and no reconnect is attempted

**Given** several messages arrive within one display frame (mocked `requestAnimationFrame`)
**When** the frame flushes
**Then** `marketStore` receives exactly one commit, containing the latest snapshot per pair, and never more than one commit per message

**Given** snapshots applied to `marketStore`
**When** a snapshot's `lastDepthAt` is `null`
**Then** the stored book group is kept, and likewise the ticker group when `lastTickerAt` is `null`
**And** within one connection a snapshot with `rev` not greater than the stored `rev` is ignored, while a new connection's `market.snapshot` replaces stored revs unconditionally
**And** no pair is ever removed from the store

**Given** a `market.status` equal to the stored one
**When** it arrives
**Then** no store commit occurs; a changed status commits `source`, `upstream`, `stalePairs`, `intervalMs` and `heartbeatMs`

**Given** a fake socket and fake timers
**When** the socket closes, errors, or receives no message for `3 × heartbeatMs` (the contract default before the first status)
**Then** `MarketSocket` moves to `reconnecting` and retries with the contracts backoff helper at base 500 ms, cap 5 s
**And** the attempt counter resets only after the socket stays open for `DOWNSTREAM_STABLE_MS = 4 × heartbeatMs` past the first snapshot, and never after a `4008` close
**And** callbacks from a superseded socket generation are ignored
**And** every previously received pair is still in `marketStore` throughout

**Given** the backend is stopped and restarted
**When** the app is connected throughout
**Then** state goes `open → reconnecting → open` and a fresh snapshot is applied with no user action (manual check on the emulator, recorded in the PR)

**Given** `AppState` changes to `background`
**When** the change is observed
**Then** the socket is closed and state is `paused` with no retries; on `active` it connects immediately and applies a fresh snapshot

**Given** `settingsStore.intervalMs`, which is `null` until the user sets it
**When** a connection opens
**Then** `client.setInterval` is sent only if the value is non-null

**Given** the pairs-meta query under key `['pairs','meta']`
**When** it succeeds or fails
**Then** the response is fully Zod-parsed on success, and a failure keeps any cached meta

**Given** new dependencies Zustand 5.x and TanStack Query 5.x
**When** the PR is opened
**Then** each has a one-line justification, and `marketStore` exposes per-pair, per-field selector hooks only

### Story 2.2: Watchlist and navigation

As a mobile user,
I want a watchlist of every pair with live price, 24h change, colour flashes and a clear connection state,
So that I can scan the market at a glance and trust whether what I see is live, stale or simulated.

**Requirements:** CAP-7, CAP-11, CAP-17 (label) · NFR-3 · AR-29 · UX-DR-1, UX-DR-2, UX-DR-3, UX-DR-6, UX-DR-12

**Acceptance Criteria:**

**Given** the app is running
**When** the user looks at the bottom bar
**Then** it has Terminal, Markets, Telemetry and Settings tabs, and Telemetry and Settings open the same screen
**And** the Terminal and Telemetry & Settings screens may be empty shells in this story; later stories fill them

**Given** `marketStore` holds five pairs
**When** the Markets tab renders
**Then** it shows one `FlatList` row per key of `marketStore.pairs`, each with display name (the raw pair id when meta is missing), last price formatted with the pair's `pricePrecision`, 24h change as `▲ 1.82%` in green or `▼ 0.41%` in red, a liveness indicator and a favourite toggle
**And** any `null` value renders `—`

**Given** a pair's liveness
**When** the row and header indicators render
**Then** they use the precedence `offline` (socket not open) > `stale` (pair in `stalePairs`) > `live`
**And** the header shows `INCOMPATIBLE` on a protocol mismatch and a `SIMULATED` chip whenever `source ≠ binance`

**Given** a row's price changes
**When** the new price is higher, lower or equal
**Then** the price flashes green, flashes red, or does not flash, using core `Animated` opacity with the native driver
**And** a component test covers all three directions

**Given** one pair's snapshot changes
**When** the store commits
**Then** rows for other pairs do not re-render (render-count test, where practical)

**Given** the favourite toggle on a row
**When** it is tapped
**Then** the pair's favourite state flips in `favouritesStore`; persistence arrives in Story 2.3

**Given** a row is tapped
**When** navigation completes
**Then** the Terminal tab is shown with that pair selected

**Given** the navigation library
**When** it is added (recommended: React Navigation bottom tabs, which works in Expo Go)
**Then** its PR description carries a one-line justification
**And** the screen follows the dark terminal theme, green and red semantics, monospaced numerics and uppercase micro-labels, and nothing beyond the PNG

### Story 2.3: Search, favourites and pull-to-refresh

As a mobile user,
I want to filter the list, keep my favourites after restarting the app, and refresh pair metadata without losing the live stream,
So that I find pairs quickly and my choices stick.

**Requirements:** CAP-8, CAP-9, CAP-14 · NFR-3, NFR-4 · AR-28 · UX-DR-4, UX-DR-5

**Acceptance Criteria:**

**Given** the Markets tab with five pairs
**When** the user types `btc`
**Then** only BTC / USDT remains, and clearing the query restores all five
**And** matching is case-insensitive over `pair` and `displayName`
**And** the search component does not re-render on price ticks

**Given** the user favourites a pair
**When** the app is killed and relaunched
**Then** the pair is still favourited (component test with mocked AsyncStorage, plus a manual check on the emulator)

**Given** AsyncStorage holds a non-empty favourites set that has not finished loading
**When** the user toggles favourites before loading completes
**Then** each toggle is stored as an absolute intent `{ pair, favourite }` and applied last-write-wins over the loaded set, so no toggle is lost

**Given** the AsyncStorage read fails
**When** the app starts
**Then** favourites start empty, the failure is logged once, and the rest of the app works

**Given** the user pulls to refresh on the watchlist
**When** the refresh runs
**Then** the pairs-meta query's `refetch()` is called, and `MarketSocket` is neither closed nor reopened (asserted in a test)
**And** prices keep updating during the refresh
**And** if the request fails, cached meta is kept; with no cache, rows show raw pair ids

**Given** AsyncStorage
**When** it is added with `npx expo install`
**Then** the PR description carries a one-line justification

### Story 2.4: Terminal screen and order book

As a mobile user,
I want a detail view for one pair with price, pressure, spread and a live animated order book,
So that I can read the market's depth and direction for that pair in real time.

**Requirements:** CAP-10, CAP-11 · NFR-3, NFR-4 · AR-29, AR-32 · UX-DR-7, UX-DR-8, UX-DR-9, UX-DR-10, UX-DR-13

**Acceptance Criteria:**

**Given** the Terminal tab is opened from a watchlist row
**When** it renders
**Then** it shows that pair; opened directly from the tab bar with no prior selection, it shows the first configured pair
**And** it subscribes only to the selected pair's fields

**Given** the selected pair has data
**When** the header block renders
**Then** it shows last price, 24h % change, 24h high, 24h low and a last-updated age computed as `(Date.now() − localReceiveAt) + (t − timestamp)`
**And** market cap is not shown

**Given** the book for the selected pair
**When** the order book renders
**Then** bids (green) appear above asks (red), 10 rows per side, with columns PRICE / AMOUNT / TOTAL, where TOTAL is cumulative quantity
**And** prices and quantities use the pair's `pricePrecision` and `quantityPrecision`
**And** rows are keyed by index `0..9`, never by price, and a side with fewer than 10 levels shows empty rows rather than changing row count

**Given** book quantities change
**When** the depth bars update
**Then** each bar's width is cumulative quantity ÷ the largest cumulative quantity across both displayed sides, animated with `scaleX` on the native driver, anchored left for bids and right for asks
**And** a component test covers bar widths and index keys

**Given** `spread`, `buyPressure` and `sellPressure`
**When** the summary renders
**Then** liquidity gap shows `spread / mid × 100` %, buy % and sell % are shown, and the pressure label reads Buy Heavy at ≥ 55, Sell Heavy at ≤ 45, otherwise Balanced
**And** any `null` renders `—`, never `0` or `50`

**Given** the market depth visual
**When** it renders
**Then** it shows bid and ask totals minimally and may use up to 20 levels

**Given** the backend goes down while the Terminal is open
**When** the socket disconnects
**Then** the last book and price stay visible and the header shows the offline state

### Story 2.5: Telemetry and Settings screen

As a mobile user and a reviewer,
I want to set my update frequency and see real, measured JS frame rate and message rate,
So that I can watch the app's responsiveness under load and see the server honour my interval.

**Requirements:** CAP-12, CAP-15 · NFR-3, NFR-7 · AR-30 · UX-DR-11

**Acceptance Criteria:**

**Given** the app is running
**When** telemetry is collected
**Then** a `requestAnimationFrame` loop counts frames in a ref, and `MarketSocket` increments a message counter for `market.batch` and `market.snapshot` only
**And** a 1 Hz timer reads and resets both counters and commits once to `telemetryStore`
**And** only the Telemetry & Settings screen subscribes to `telemetryStore`, and a flush does not notify `marketStore` subscribers (test)
**And** market code only increments counters; it never reads, awaits or branches on telemetry

**Given** the Telemetry & Settings screen
**When** it renders
**Then** the JS FPS and WS msgs/sec tiles show the latest measured values, and show `—` before the first sample rather than a placeholder number
**And** the memory tile and the `RESET` / `HEALTHY` chips are not rendered (3-day scope decision)

**Given** the update-frequency slider with range 10–1000 ms
**When** the user releases it
**Then** `client.setInterval` is sent once with the released value and stored in `settingsStore`, and nothing is sent while dragging
**And** the displayed interval is the acknowledged `market.status.intervalMs`
**And** after a reconnect the stored interval is re-sent

**Given** the app on the emulator connected to the simulator (manual check, recorded in the PR)
**When** the slider moves from 100 ms to 1000 ms
**Then** the msgs/sec tile falls accordingly, consistent with `min(1000 / intervalMs, upstream pair-change rate)`
**And** no FPS threshold is claimed in this story; Story 3.1 measures it

**Given** the slider component
**When** it is added with `npx expo install` (`@react-native-community/slider`, available in Expo Go)
**Then** the PR description carries a one-line justification

## Epic 3: Verified, reviewable delivery

A reviewer goes from a fresh clone to a running app using the README, watches a recording covering every acceptance demo, and finds measured stress and resilience evidence rather than claims.

### Story 3.1: Stress and resilience verification

As a reviewer evaluating the system,
I want reproducible, measured evidence of throughput, coalescing, bounded memory and recovery,
So that every performance and resilience statement in the repository is backed by a recorded run.

**Requirements:** CAP-3, CAP-6, CAP-12, CAP-13, CAP-17 · NFR-3, NFR-4, NFR-5 · AR-33, AR-34, AR-35

Record only measured numbers and the exact command used. A metric that could not be collected is marked "not measured", with the reason.

**Acceptance Criteria:**

**Given** a committed stress script (for example `pnpm --filter @pulsecrypto/api stress`)
**When** it runs the backend with `MARKET_SOURCE=simulator`, `SIMULATOR_RATE=1000`, `BROADCAST_INTERVAL_MS=100` and five pairs for 60 s with a Node load client connected
**Then** it samples `/health` and process RSS every second and writes raw samples next to the results
**And** `docs/verification/stress-results.md` records: input events/s, normalized events/s, buffered pair snapshots, broadcasts/s, dropped or coalesced updates, RSS per second, CPU if easily collected, event-loop lag, downstream `bufferedAmount`, client msgs/s, and observed mobile responsiveness (the FPS tile read on the emulator during the run)
**And** it records the exact reproduce command, machine, OS, and Node version

**Given** the same run with a second client that stops reading its socket for 60 s
**When** the run completes
**Then** the results show whether RSS stayed flat, the stalled client's outcome (skips, eviction or ping timeout, with counter values), and the healthy client's msgs/s compared with a run without the stalled client

**Given** the simulator running at 1000 events/s with no network access to Binance
**When** the app connects
**Then** all five pairs stream under the `SIMULATED` chip; and with `MARKET_SOURCE=binance` and an unreachable `BINANCE_WS_URL`, clients see stale status and no synthetic prices; both outcomes are recorded

**Given** the manual resilience procedure in testing-strategy.md
**When** it is run on the Android emulator
**Then** `docs/verification/resilience-results.md` records the date, steps and observed outcome of the primary scenario (stop backend, data retained, restart, automatic recovery) and all four secondary scenarios
**And** it records whether `ws` kept the Binance connection alive across a run longer than 2 minutes, and whether React Native answered server pings (`ws.clients.timedOut` stayed 0 over more than 2 minutes)

**Given** a result misses a spec threshold (for example FPS below 55, or RSS growing)
**When** it is recorded
**Then** it is recorded as observed and raised with the human; no threshold, test or ADR is changed silently
**And** any config default tuned during the run (`STALE_AFTER_MS`, `UPSTREAM_SILENCE_MS`, `UPSTREAM_CONNECT_TIMEOUT_MS`, `SLOW_CLIENT_MAX_STALL_MS`, WS limits) is recorded with its before and after values and the run that justified the change

### Story 3.2: README and screen recording

As a reviewer receiving the submission,
I want a README that takes me from a fresh clone to a running Android app and explains the design, plus a recording checklist that covers every demo,
So that I can run, understand and judge the system without asking the author.

**Requirements:** CAP-16 · NFR-1, NFR-2 · AR-35, AR-36

The agent writes the README and the recording checklist; the human records the video.

**Acceptance Criteria:**

**Given** the repository README
**When** a reviewer reads it
**Then** it covers setup (Node 22, pnpm 12.4.2, Android emulator, Expo Go), build and run for backend and app (including `EXPO_PUBLIC_API_URL`, the `10.0.2.2` default, simulator mode and the HTTP 451 `BINANCE_WS_URL` workaround), architecture decisions (summary with links to each ADR), buffering strategy, payload format (linking `websocket-protocol.md` and stating that `timestamp` is epoch milliseconds, not the brief's seconds), assumptions, trade-offs and AI-tool usage

**Given** every number or performance statement in the README
**When** it is reviewed
**Then** each one traces to `docs/verification/stress-results.md` or `resilience-results.md`; anything unmeasured is removed

**Given** `docs/ai/ai-development-log.md`
**When** the README's AI-tool section is written
**Then** it summarises how AI tools were used and links the log, including review findings that were rejected with reasons

**Given** `docs/verification/recording-checklist.md`
**When** the human records the video
**Then** the checklist lists all ten items of `acceptance-demos.md`, each with its setup, the steps to perform and what must be visible on screen
**And** the README links the recording once it exists

**Given** a fresh clone on a clean machine or directory (manual check by the human, recorded in the PR)
**When** the README is followed verbatim
**Then** the backend starts and the app runs on the Android emulator with live pairs, and any step that failed is fixed in the README before the story is closed
