---
title: 'Story 1.4: Binance market data adapter'
type: 'feature'
created: '2026-09-19'
status: 'done'
baseline_commit: '76274a08cdaa32fccfb89b0ef22022a08d9c41a5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/architecture/adr/ADR-001-combined-binance-stream.md'
  - '{project-root}/docs/architecture/adr/ADR-008-connection-lifecycle.md'
  - '{project-root}/docs/architecture/adr/ADR-011-market-data-source.md'
  - '{project-root}/_bmad-output/specs/spec-pulsecrypto/binance-feed.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/api` has only the simulator source. Live operation needs a `MarketDataSource` that ingests the combined Binance depth and ticker stream for every configured pair and recovers from upstream loss without a restart. Requirements: CAP-1, CAP-6, CAP-17, NFR-5, NFR-6, NFR-7, AR-11, AR-12, AR-13, AR-24, AR-25.

**Approach:** `BinanceMarketDataAdapter` (`kind: 'binance'`) in `infrastructure/binance/`. It opens one `ws` connection through an injected socket factory, Zod-parses every frame, and normalizes it into domain `DepthUpdate` / `TickerUpdate`. It runs the ADR-008 upstream state machine: generation-bound timers, connect timeout, silence watchdog, and contracts `backoffDelay` at base 1 s, cap 30 s, reset after 60 s connected. `config.ts` gains three variables. No server wiring.

## Boundaries & Constraints

**Always:** URL `<BINANCE_WS_URL without trailing slash>/stream?streams=` joins `<pair>@depth20@100ms/<pair>@ticker` for each pair, in lower case. A stream-name lookup table is built once from `PAIRS`. The pair comes from the lookup table, never from the payload. Numeric strings must match a strict decimal regex before `Number()`, so `""`, `"abc"` and `"1e5"` are invalid. Prices and quantities must be > 0. Books must pass `domain/book.ts#isValidBook`. Ticker maps `c→price`, `P→change24hPct`, `h→high24h`, `l→low24h`, `q→volume24h`. `receivedAt` comes from the injected `now()`. Emitted objects carry only domain keys. `status{connected:true}` is emitted on `open`. `{connected:false}` is emitted only on a transition from connected. A failed or ended attempt is terminated, `upstream.reconnects` is incremented, and the next attempt is scheduled with `backoffDelay(attempt++)`. Every handler first checks its generation id. Hot paths only increment counters. Pino-compatible logger calls happen only on transitions.

**Agent decisions (minimal, recorded):** (1) Config defaults, labelled as defaults and not measured: `UPSTREAM_SILENCE_MS=10000`, `UPSTREAM_CONNECT_TIMEOUT_MS=10000`. Both are positive integers. `BINANCE_WS_URL` defaults to `wss://stream.binance.com:9443` and must be a `ws:`/`wss:` URL. (2) `@types/ws` 8.18.1 becomes a devDependency. Justification: `ws` ships no types, and strict TS rejects an untyped import. (3) Injected dependencies: `createSocket`, `logger`, `counters`, `now`, `random`. The defaults are real `ws`, `Date.now` and `Math.random`. (4) Logging per 451 response: exactly one `warn` naming `BINANCE_WS_URL` and `wss://data-stream.binance.vision`. `info` for connected and disconnected. `info` for each scheduled reconnect with its delay. (5) `stop()` terminates the socket, clears every timer and resolves. It emits no event, matching the simulator. Calling `start` twice throws. (6) Binary frames count as invalid. (7) The live check is `apps/api/scripts/binance-live-check.ts`, run with `tsx`. `scripts/` is added to the api tsconfig `include` and the lint script.

**Never:** Touch `server.ts`, `domain/`, `application/`, contracts or contract docs. Never create `composition-root.ts`. Never substitute or reference simulator data. Never log per frame. Never let a Binance-shaped type be exported from `infrastructure/binance/` except the adapter and its options. Never contact Binance from an automated test. Never add other env vars or dependencies. Never weaken a lint rule, flag or test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Depth frame | `{stream:"btcusdt@depth20@100ms",data:{lastUpdateId,bids,asks}}` | `DepthUpdate{pair:"BTCUSDT"}` with number tuples | N/A |
| Ticker frame | `{stream:"ethusdt@ticker",data:{c,P,h,l,q,...}}` | `TickerUpdate` with the five mapped fields | N/A |
| Empty side | `bids: []` | `DepthUpdate` emitted | N/A |
| Malformed | invalid JSON · binary · unknown stream · unconfigured pair · `"abc"`/`""` number · crossed or mis-ordered book · missing field | no event, `upstream.frames.invalid` +1 | not thrown, not logged |
| Any frame | valid or not | `upstream.frames.received` +1 | N/A |
| Double end | `error` then `close` (or timeout then `close`) | one end, one reconnect scheduled | stale-generation callbacks ignored |
| Handshake fail | `unexpected-response 451` before `open` | `connect.failed` +1, one warn | back off; no synthetic data |

</frozen-after-approval>

## Code Map

- `apps/api/src/domain/market-event.ts` -- `MarketDataSource`, `MarketEventSink`, `DepthUpdate`, `TickerUpdate`, `SourceStatusChange` (`at`). Reuse; do not edit.
- `apps/api/src/domain/book.ts` -- `isValidBook`. Reuse after number conversion.
- `apps/api/src/application/counters.ts` -- `Counters#increment`, `CounterName`. Adapter takes a `Counters` (type import).
- `packages/contracts/src/backoff.ts` -- `backoffDelay(attempt, {baseMs, capMs}, random)`. Import from `@pulsecrypto/contracts`.
- `apps/api/src/config.ts` + `config.test.ts` -- existing Zod `ConfigSchema` / `loadConfig`. Extend it in the same style (trim, default, `Invalid <VAR>` message).
- `apps/api/src/infrastructure/simulator/simulator-market-data-source.ts` -- style reference (options object, `kind as const`, start-twice throws).
- `apps/api/eslint.config.js` -- already forbids domain/application from importing `infrastructure/binance`. No change.
- `apps/api/test/domain-boundaries.test.ts` -- already scans domain/application for `/binance/i`. No change.
- `ws` 8.21.3 is in the lockfile via `@fastify/websocket`. `@types/ws` is absent. With a listener on `unexpected-response`, `ws` does not abort the handshake itself, so the wrapper must `req.destroy()` / `terminate()`.
- `vitest.shared.ts` -- fake-timer rule. A real-socket test fakes only `setTimeout`, `setInterval` and `Date`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/package.json`, `pnpm-lock.yaml` -- add `ws: 8.21.3` and dev `@types/ws: 8.18.1`. Add `scripts` to the lint path. Run `pnpm install`.
- [x] `apps/api/tsconfig.json` -- include `scripts`.
- [x] `apps/api/src/config.ts` -- add `BINANCE_WS_URL`, `UPSTREAM_SILENCE_MS`, `UPSTREAM_CONNECT_TIMEOUT_MS` to `AppConfig`, the schema and `loadConfig`.
- [x] `apps/api/src/infrastructure/binance/binance-frames.ts` -- Zod wrapper, depth and ticker schemas, decimal parsing, and `buildStreamTable(pairs)`. `normalizeFrame(raw, table, receivedAt)` returns `DepthUpdate | TickerUpdate | null`.
- [x] `apps/api/src/infrastructure/binance/upstream-socket.ts` -- a minimal `UpstreamSocket` interface: `open`, `message(text | null)`, `error`, `close`, `unexpected-response(status)`, `terminate()`. `createWsSocket(url)` wraps `ws`.
- [x] `apps/api/src/infrastructure/binance/binance-market-data-adapter.ts` -- state machine, timers, counters and logging per the Boundaries.
- [x] `apps/api/src/infrastructure/binance/__fixtures__/frames.ts` -- recorded depth and ticker frames, shaped per `binance-feed.md`.
- [x] Tests: `binance-frames.test.ts` (I/O matrix normalization rows), `binance-market-data-adapter.test.ts` (fake socket factory plus fake timers: every lifecycle AC), `upstream-socket.test.ts` (a local `ws` server and an HTTP 451 server on 127.0.0.1 exercise `createWsSocket`), `config.test.ts` (the new variables: defaults and invalid values).
- [x] `apps/api/scripts/binance-live-check.ts` -- runs the adapter against live Binance for up to 5 s. Prints per-pair depth and ticker counts. Exits non-zero unless every pair got both.

**Acceptance Criteria:**
- [x] Given the five default pairs, when the adapter starts, then `createSocket` receives exactly one URL listing 10 lower-case streams.
- [x] Given `open`, then `{connected:true}` precedes the first data event. Given any loss after that, `{connected:false}` is emitted once.
- [x] Given fake timers, when any of `error`, `close`, `unexpected-response` or the connect timeout fires, alone or several together, then the attempt ends exactly once. The next `createSocket` call is at the `backoffDelay` time for attempt n. `upstream.reconnects` +1. `connect.failed` +1 only if `open` never fired.
- [x] Given 60 s connected and then a loss, then the next delay uses attempt 0. Given a loss before 60 s, the counter keeps growing, capped at 30 s.
- [x] Given open and silent for `UPSTREAM_SILENCE_MS`, then the socket is `terminate`d and a reconnect is scheduled. A frame arriving within the window postpones this.
- [x] Given `await stop()`, then the socket is terminated, `vi.getTimerCount()` is 0, and no `createSocket` call follows.
- [x] Given the repo root, when `pnpm typecheck && pnpm lint && pnpm test` runs, then all exit 0.
- [x] Given network access (manual, recorded in the PR), when the live check runs, then all five pairs get depth and ticker events within 5 s.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| ID | Location | Claim | Verdict | Route / Note |
|---|---|---|---|---|
| VG-1 | `apps/api/src/infrastructure/binance/upstream-socket.test.ts:72-97` | Test for unexpected HTTP 451 response does not verify that socket was terminated by the wrapper rather than test teardown. | `medium` | `patch` |
| BH-1 | `apps/api/src/infrastructure/binance/binance-frames.ts` | `volume24h` rejects zero quote volume. | `false` | Spec explicitly mandates "Prices and quantities must be > 0". Rejecting zero strictly complies with frozen spec constraint. |
| BH-2 | `apps/api/src/infrastructure/binance/upstream-socket.ts` | `ws.on('message')` text decoding does not handle `Buffer[]` chunked frames. | `low` | Rejected: `ws` text payload under maxPayload is always delivered as a single `Buffer`; handling `Buffer[]` adds complexity for an unreachable case in everyday use. |
| BH-3 | `apps/api/src/infrastructure/binance/binance-market-data-adapter.ts` | `createSocket(url)` is not in a `try/catch` in `connect()`. | `false` | URL is validated at startup by `loadConfig`. Runtime socket errors are emitted as `'error'` events, not thrown synchronously. |
| BH-4 | `apps/api/src/infrastructure/binance/upstream-socket.ts` | `ws.on('error')` drops error if no listeners registered yet. | `false` | Listeners are attached synchronously in `connect()` in the same event-loop tick as socket construction, guaranteeing `listenerCount('error') > 0` before any I/O event fires. |
| BH-5 | `apps/api/src/infrastructure/binance/binance-market-data-adapter.ts` | Only HTTP 451 logs a warning; other HTTP codes log nothing. | `false` | Frozen spec explicitly restricts warning logs to HTTP 451; general failure counting and reconnect delay logging handle all other non-200 responses. |
| BH-6 | `apps/api/src/infrastructure/binance/binance-market-data-adapter.ts` | `resetSilenceWatchdog` clears/sets timer on every incoming message. | `false` | Standard per ADR-008; clearing and setting timers in V8 timer wheel has negligible overhead at ~55 msgs/sec. |
| BH-7 | `apps/api/src/infrastructure/binance/binance-frames.ts` | Missing pair format / casing validation. | `false` | Alphanumeric uppercase pair validation is enforced upstream by `ConfigSchema` and contracts `PairSchema`. |
| BH-8 | `apps/api/src/infrastructure/binance/binance-market-data-adapter.ts` | `stop()` does not transition `this.state` to `'idle'` or `'disconnected'`. | `low` | Rejected: `this.state` is private and never read after `stopped = true`. No observable impact. |
| BH-9 | `apps/api/src/infrastructure/binance/binance-market-data-adapter.test.ts` | `stop()` is not tested during `connecting` or `reconnecting` phases. | `low` | Rejected: `stop()` timer cancellation is already verified by `vi.getTimerCount() === 0`. |
| BH-10 | `apps/api/src/infrastructure/binance/binance-market-data-adapter.test.ts` | Missing tests for non-451 HTTP status codes. | `low` | Rejected: Non-451 status codes follow the exact same code path as 451 minus the warning log. |
| BH-11 | `apps/api/scripts/binance-live-check.ts` | Script does not pass logger or counters to adapter. | `low` | Rejected: Logger and counters are optional parameters in adapter options. |
| BH-12 | `apps/api/src/config.ts` | Whitespace `BINANCE_WS_URL` fails validation rather than falling back to default. | `false` | Failing fast on an explicit whitespace string with `"Invalid BINANCE_WS_URL"` is correct and expected configuration behavior. |
| BH-13 | `apps/api/src/infrastructure/binance/binance-frames.test.ts` | Missing test for explicit plus sign in ticker `P: "+3.50"`. | `low` | Rejected: Positive and negative tickers are already tested; explicit plus signs are an edge case. |
| BH-14 | `apps/api/src/infrastructure/binance/binance-frames.ts` | `bids` and `asks` arrays have no `.max(20)` length check. | `false` | The frozen spec does not specify an array length limit on raw depth payloads. |
| BH-15 | `apps/api/src/infrastructure/binance/binance-market-data-adapter.ts` | `this.sink` calls are not wrapped in `try/catch`. | `false` | Catching sink errors would violate the architectural requirement that programmer errors fail loudly. |


## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm test` -- expected: exit 0
- `grep -rn "binance" apps/api/src/domain apps/api/src/application` -- expected: only the `SourceKind` literal
- `pnpm --filter @pulsecrypto/api exec tsx scripts/binance-live-check.ts` -- expected (manual): every pair reports depth ≥ 1 and ticker ≥ 1 within 5 s
