# PulseCrypto Architecture

Status: accepted · 2026-09-19 · Decisions: [`adr/`](adr/) ADR-001 to ADR-012 ·
Rules for agents: [`AGENTS.md`](../../AGENTS.md) · Scope: [`scope-boundaries.md`](scope-boundaries.md) ·
Contracts: [`websocket-protocol.md`](../contracts/websocket-protocol.md), [`rest-api.md`](../contracts/rest-api.md)

## 0. Requirement IDs used here

Functional IDs: spec capabilities `CAP-1`..`CAP-16` ([`SPEC.md`](../../_bmad-output/specs/spec-pulsecrypto/SPEC.md)).
The brief's non-functional list has no IDs; labelled here for traceability only:

| NFR-1 | NFR-2 | NFR-3 | NFR-4 | NFR-5 | NFR-6 | NFR-7 |
|---|---|---|---|---|---|---|
| Clean architecture | Maintainable code | Responsive UI under continuous updates | Efficient state management | Robust connection handling | Appropriate error handling | Separation of concerns |

## 1. System context and component boundaries *(NFR-1, NFR-7)*

A single Node.js process sits between one upstream market-data connection and N mobile clients. It
holds only current state: one latest entry per pair. The app's render cadence is bounded by the
server's emit interval and the display frame, never by upstream event rate.

| Component | Owns | Must not |
|---|---|---|
| api · `infrastructure/binance`, `infrastructure/simulator` | Upstream socket, reconnect state machine, silence watchdog, raw-frame Zod parse, normalization; emits `MarketEvent` (ADR-011) | Let a provider-shaped object leave the adapter |
| api · `domain` | `PairState`, derived math (spread, pressure), staleness rule | Import infrastructure or `packages/contracts` |
| api · `application` | Latest-value buffer, `ClientSession` (cursor, timer, backpressure gate), status monitor | Queue events per client (ADR-003) |
| api · `presentation` | Fastify `/health`, `/pairs/meta`, WS gateway `/ws`; maps `PairState → PairSnapshot`; parses control messages | Compute market values |
| `packages/contracts` | Zod schemas, inferred types, shared constants, pure helpers (`decodeServerMessage`, backoff delay) | Hold I/O, timers or state |
| mobile · `services` | `MarketSocket` (state machine, backoff, liveness, per-frame coalescing), `api-endpoints`, meta fetcher | Render or hold React state |
| mobile · `stores` | `marketStore`, `favouritesStore`, `settingsStore`, `telemetryStore` (Zustand); meta in TanStack Query | Mix telemetry into market state (ADR-010) |
| mobile · `features` | Watchlist, Terminal, Telemetry & Settings screens | Subscribe to more state than they render |

Runtime/build: Node 22.23.0 runs TypeScript 6.0.3 via `tsx` 4.23.13; `tsc` typechecks only; no build
step (ADR-012). Fastify 5.12.5 + `@fastify/websocket` 11.3.1 serve HTTP and WS on one port (no further
decision). Upstream client: `ws` 8.21.3 (ADR-008).

## 2. Data flow

```mermaid
flowchart LR
  B[(Binance combined stream<br/>depth20@100ms + ticker × pairs)] -->|raw JSON frames| A
  S[(Simulator<br/>SIMULATOR_RATE)] -.->|alternative, ADR-011| A
  subgraph API[apps/api — one process]
    A[Source adapter<br/>Zod parse · drop+count bad frames<br/>reconnect · watchdog] -->|MarketEvent| N
    N[Domain: apply + derive<br/>spread, pressure, timestamps] -->|mutate, stamp rev| L
    L[Latest-value map<br/>Map&lt;Pair, PairState&gt; · O(pairs)] -->|read on tick| C
    C[ClientSession × N<br/>cursor · own timer<br/>bufferedAmount gate] -->|snapshot / batch / status| W
    L --> R[GET /pairs/meta]
  end
  W[MarketSocket<br/>decode · coalesce per pair] -->|≤ 1 commit per frame| Z[marketStore]
  R -->|TanStack Query| Q[meta cache]
  Z -->|per-pair selectors| U[Rows · Terminal · Order book]
  Q -->|decorates| U
  W -.->|counter++ only| T[telemetry refs → 1 Hz → telemetryStore]
```

Nominal upstream rate is 10 depth + 1 ticker frames/s per pair (Binance stream definition); actual rates to be measured in the stress test.

## 3. Ingestion, normalization, REST *(CAP-1, CAP-5, CAP-6, NFR-6)*

- One combined connection for all pairs and both stream types; the pair is derived from the wrapper
  `stream` name, because `depth20` frames carry no symbol (ADR-001). Each partial top-20 frame
  replaces the book, with no diff sequencing (ADR-002).
- The adapter Zod-parses every frame and converts strings to `number`. A book is valid iff bids are
  strictly descending, asks strictly ascending, and `bestBid < bestAsk` when both sides exist; an
  empty side is valid. Invalid frames are dropped and counted in `upstream.frames.invalid` and never
  thrown past the adapter.
- The domain applies events to `PairState` and derives values (ADR-007): `spread`, `buyPressure`,
  `sellPressure` are `null` when a side is empty, and pressures are rounded to 2 dp; 24h change is Binance `P`; `volume24h` is quote
  volume `q`. Times are server receive clock: `lastDepthAt`, `lastTickerAt`, `timestamp` = the later.
- `GET /pairs/meta` reads the same map for 24h high/low/volume (nullable before the first ticker).
  `displayName`, `tradingStatus`, `pricePrecision` and `quantityPrecision` come from static config, since the brief allows mocking; startup
  fails if a `PAIRS` entry has no meta.
- `GET /health` returns 200 whenever the process serves HTTP, with source, upstream state, uptime
  and counters (§8) in the body.

## 4. Buffering, emission and backpressure *(CAP-2, CAP-3, CAP-4, CAP-15, NFR-4)*

- **Latest-value map** (ADR-003): `Map<Pair, PairState>`, overwritten in place. Every mutation
  stamps `rev` from one process-wide monotonic sequence. No per-client queue exists.
- **Session lifecycle** (ADR-004): on connect the server immediately sends `market.snapshot` (every
  configured pair, with nullable fields before first data), then `market.status`, and sets the
  session `cursor` to the sequence value at snapshot time. Each tick sends `market.batch` with pairs
  whose `rev > cursor`, then sets `cursor` to the highest `rev` sent. An empty tick sends nothing.
- **Cadence**: a session starts at `BROADCAST_INTERVAL_MS` (env, default `100`). `client.setInterval
  { intervalMs }` takes an integer `10..1000`; out of range → `error BAD_REQUEST`, old value kept.
  On acceptance the timer re-arms so the next tick fires at `min(new, remaining)`, and a
  `market.status` goes out immediately as the acknowledgement.
- **Serialize once**: at most one cached JSON fragment per pair, replaced when that pair's `rev`
  changes and built lazily on the first tick that needs it.
- **Backpressure** (ADR-005): only `market.batch` is gated. If `bufferedAmount >
  WS_SOFT_LIMIT_BYTES` the tick is skipped, **the cursor is not advanced**, and `ws.frames.skipped`
  is counted. When `bufferedAmount` stays above the soft limit for `SLOW_CLIENT_MAX_STALL_MS`
  (checked every tick), or exceeds `WS_HARD_LIMIT_BYTES` (reachable only through ungated messages),
  the socket is closed with `4008`. This bounds user-space memory per client; kernel socket buffers
  are outside it.
- **Gate scope**: only *network*-slow clients. RN drains its socket without flow control, so a slow JS
  thread is invisible to the server; the device handles it by coalescing (§6).
- Gateway `maxPayload` 4 KiB; binary, non-JSON or invalid input → `error BAD_REQUEST`; 3rd closes `1008`.

## 5. Connection lifecycle *(CAP-6, CAP-13, NFR-5)*

Two independent reconnect problems share one algorithm, with separate instances and parameters
(ADR-008): `delay(attempt) = floor(random() × min(cap, base × 2^attempt))`, `attempt` from 0,
`random` injected, exported once from `packages/contracts`.

| | Upstream (adapter → Binance) | Downstream (`MarketSocket` → API) |
|---|---|---|
| States | `idle → connecting → connected → disconnected → reconnecting` | same + `paused` (backgrounded) |
| Attempt ends on | First of `error`, `close`, `unexpected-response`, or `UPSTREAM_CONNECT_TIMEOUT_MS`; transitions idempotent | First of `error`, `close`, or heartbeat timeout |
| Liveness | Silence watchdog from `open`: no frame for `UPSTREAM_SILENCE_MS` → terminate | No message for `3 × heartbeatMs` (from latest `market.status`; contract default before the first); server pings every 15 s and terminates after 30 s without a pong |
| Backoff base / cap | 1 s / 30 s: a third party we do not control | 0.5 s / 5 s: our own local backend |
| Reset | After 60 s connected | After `DOWNSTREAM_STABLE_MS` open past the first snapshot; a `4008` close never resets |
| Extra | 24 h forced close is an ordinary close; HTTP 451 logged with a `BINANCE_WS_URL` hint | `AppState` background → `paused` (socket closed, no retry); `active` → `connecting` at once |

Every timer and callback is bound to a socket generation id and ignored once the generation changes.
The mobile client re-sends its interval on connect only if the user has set one.

**Source status.** Every `MarketDataSource` emits `SourceStatusChange{connected:true}` before its
first data event and `{connected:false}` on any loss; the simulator is included. The status
monitor derives `upstream.connected` only from these events.

**Staleness.** A pair is stale iff upstream is disconnected, it has never had a depth update, or
`now − lastDepthAt > STALE_AFTER_MS`. `market.status { source, upstream: { connected, since },
stalePairs, intervalMs, heartbeatMs, serverTime }` carries the **complete** stale set. It is sent
on connect, on any change, and every `heartbeatMs`. `since` = last `connected` transition, `null`
before the first. Clients learn about errors only through `upstream.connected` and `stalePairs`;
counts are on `/health`.

## 6. Mobile state and the render-cadence rule *(CAP-7..CAP-14, NFR-3, NFR-4)*

**Render-cadence rule.** `MarketSocket.onmessage` decodes a message and merges its pairs into a
pending `Map<Pair, PairSnapshot>` (latest wins). One `requestAnimationFrame` flush commits the map
to `marketStore`. The result is at most one market commit per display frame and never more than one
per message, and a device-side backlog collapses per pair. React never updates per upstream event.
Components read their own pair's fields through stable selectors.

**Apply rules.** A pair's book group (`bids`, `asks`, `spread`, pressures, `lastDepthAt`) replaces
the stored group only when `lastDepthAt` is non-null; the ticker group likewise with
`lastTickerAt`. Pairs are never deleted. `rev` is compared only within one connection; a new
connection's `market.snapshot` replaces stored revs unconditionally. Together these keep the last
data visible across a backend restart *(CAP-13)*.

| State | Owner | Source | Persistence |
|---|---|---|---|
| Live pairs, socket state, source, stale set | `marketStore` | WS | none; survives disconnects |
| `displayName`, `tradingStatus` | TanStack Query `['pairs','meta']` | REST | none |
| Favourites (keyed by `pair` id) | `favouritesStore` | user | AsyncStorage |
| Chosen interval (`null` until set) | `settingsStore` | user | none |
| FPS, msgs/s | `telemetryStore` | 1 Hz flush | none |

- **REST vs WS** *(CAP-14)*: the watchlist row set is the key set of `marketStore.pairs`. Meta only
  decorates rows, and a missing entry falls back to the raw id. Price and 24h stats are read from WS
  state only. Pull-to-refresh calls `refetch()` and never touches `MarketSocket`.
- **Search** *(CAP-8)*: case-insensitive match over `pair` and `displayName`; it does not subscribe to prices.
- **Favourites** *(CAP-9)*: pre-hydration changes are stored as absolute intents `{pair, favourite}`
  and applied last-write-wins over the hydrated set.
- **Interval** *(CAP-15)*: slider sends `client.setInterval` on release; `market.status.intervalMs` acks.
- **Liveness display** *(CAP-7, CAP-13)*: `pairLiveness(pair)` is `offline` (socket not open) >
  `stale` > `live`. The header chip uses the same precedence, plus `SIMULATED` when `source ≠
  binance`. A status equal to the stored one causes no commit.
- **Time display**: age = `(Date.now() − localReceiveAt) + (t − timestamp)`. The device clock is
  never compared directly with server time.
- **Rendering** *(CAP-11, CAP-12)*: order-book rows are keyed by index, never by price. Price flash
  and depth bars use core `Animated` with the native driver (opacity; `scaleX` anchored with
  `transformOrigin`, left for bids and right for asks). The book shows `DISPLAY_LEVELS = 10` per side
  (contracts constant); the depth visual may use up to 20. Reanimated is not added, because core
  `Animated` covers these needs.
- **Decoding**: `decodeServerMessage(raw: unknown)` in contracts envelope-parses (`v`, `type`, `t`)
  in production and full-parses in `__DEV__` (engineering-standards §6). A `__DEV__` failure is
  logged once per type and the message dropped. A `v` mismatch moves the socket to `INCOMPATIBLE`.
- **Endpoints**: `EXPO_PUBLIC_API_URL` is an `http://host:port` origin; `api-endpoints` derives the WS URL.

## 7. Failure modes

| Subsystem | Failure | Detection | Response | User-visible effect |
|---|---|---|---|---|
| Upstream | Close, 24 h rotation, network loss | `close` / `error` | Backoff reconnect | All pairs `STALE`; last values stay |
| Upstream | Handshake fails (DNS, TLS, 451) | `unexpected-response` / `error` / connect timeout | Count `upstream.connect.failed`, back off; 451 logged with URL hint | Same; no fake data substituted |
| Upstream | Open but silent | Silence watchdog | Terminate, reconnect | Same |
| Adapter | Malformed or crossed frame | Zod / book check | Drop, count | None; next frame repairs |
| Domain | Pair has no data yet | Null groups | Emit nullable fields | `—` placeholders |
| Downstream | Slow network client | `bufferedAmount` > soft | Skip tick, cursor held | Fewer, still-current frames |
| Downstream | Stalled client | Stall time / hard limit | Close `4008` | Reconnect with un-reset backoff |
| Downstream | Bad control message | Zod / size / type | `error BAD_REQUEST`; 3rd closes `1008` | Slider value not applied |
| Mobile | Slow JS thread | Pending map grows by pair only | Coalesce per frame | Intermediate ticks skipped |
| Mobile | Backend down | `close` / heartbeat timeout | Backoff reconnect | `RECONNECTING`; last data visible |
| Mobile | Backgrounded | `AppState` | `paused`; reconnect on `active` | Fresh snapshot on return |
| Mobile | Protocol `v` mismatch | Envelope decode | Stop retrying | `INCOMPATIBLE` chip |
| Mobile | `/pairs/meta` fails | Query error | Keep cached meta | Raw ids shown; prices unaffected |
| Mobile | AsyncStorage read fails | Rejection | Empty favourites; log once | Favourites not restored this launch |

## 8. Observability *(CAP-15, NFR-6)*

- **Server**: integer counters in hot paths (`upstream.frames.{received,invalid}`,
  `upstream.connect.failed`, `upstream.reconnects`, `buffer.mutations`, `ws.frames.{sent,skipped}`,
  `ws.clients.{active,evicted,timedOut}`), plus `perf_hooks.monitorEventLoopDelay`, all exposed read-only on
  `/health`. Hot paths do not log; pino logs state transitions only.
- **Mobile**: JS FPS from a `requestAnimationFrame` counter; msgs/s counts `market.batch` and
  `market.snapshot` only. Both accumulate in refs and flush to `telemetryStore` at 1 Hz (ADR-010).
  The expected downstream rate is `min(1000 / intervalMs, upstream pair-change rate)`.
- **Isolation**: market code may only increment a counter; never reads, awaits or branches on telemetry.
- **Memory tile** only if Expo Go exposes a real Hermes heap reading. Stress and resilience figures
  live only in `docs/verification/` (testing-strategy.md); nothing unmeasured is displayed.

## 9. Configuration

| Variable | Default | Owner |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `8080` | api |
| `MARKET_SOURCE` · `BINANCE_WS_URL` | `binance` · `wss://stream.binance.com:9443` | api, ADR-011 |
| `PAIRS` | `BTCUSDT,ETHUSDT,SOLUSDT,DOGEUSDT,XRPUSDT` | api |
| `BROADCAST_INTERVAL_MS` | `100` (client override `10..1000`) | api |
| `STALE_AFTER_MS` · `UPSTREAM_SILENCE_MS` · `UPSTREAM_CONNECT_TIMEOUT_MS` | chosen in implementation, tuned in stress test | api |
| heartbeat | `5000` (`DEFAULT_HEARTBEAT_MS`, contracts) | api |
| `WS_SOFT_LIMIT_BYTES` · `WS_HARD_LIMIT_BYTES` | `1048576` (1 MiB) · `8388608` (8 MiB); tuned in stress test | api |
| `SLOW_CLIENT_MAX_STALL_MS` | chosen in implementation, tuned in stress test | api |
| Downstream ping / pong timeout | 15 s / 30 s | api |
| `SIMULATOR_RATE` | total events/s, split evenly across pairs, ≥ 1 depth per pair per 100 ms | api |
| `EXPO_PUBLIC_API_URL` | unset → `http://10.0.2.2:8080` (Android), `http://localhost:8080` (iOS) | mobile |

Server config is Zod-parsed once at startup; invalid config fails fast.

## 10. Source layout (seed)

```text
apps/api/src/        domain/ · application/ · infrastructure/{binance,simulator}/ · presentation/
                     config.ts · composition-root.ts (only importer of infrastructure) · server.ts
apps/mobile/src/     services/ · stores/ · features/{watchlist,terminal,telemetry}/
packages/contracts/  ws-messages · rest · pair-snapshot · constants · decode · backoff
```

## 11. Trade-offs and deliberate exclusions *(NFR-1, NFR-2)*

- Full snapshots cost more bytes than deltas; they buy lossless skipping and stateless recovery.
  Frame size is to be measured in the stress test.
- Per-session timers cost one timer per client and share one event loop; cross-client effects are
  measured through event-loop delay in the stress test.
- JS `number`: prices round-trip; long volumes can lose trailing digits. The client rounds per pair
  for display, and math tests use tolerances.
- `timestamp` is server-clock time, not exchange time (ADR-007).
- No automatic simulator fallback, so fake data never appears labelled as live (ADR-011).
- Excluded per `scope-boundaries.md`: DB, Redis, broker, microservices, K8s, event sourcing, binary protocol, GPU, auth, trading.

## 12. Coverage

| CAP | Where | CAP | Where | CAP | Where |
|---|---|---|---|---|---|
| 1 | §3, ADR-001/002 | 7 | §6 | 13 | §5, §6, ADR-008 |
| 2 | §4, ADR-003/004 | 8 | §6 | 14 | §6, ADR-009 |
| 3 | §4, ADR-005 | 9 | §6, ADR-009 | 15 | §4, §6, §8, ADR-010 |
| 4 | §4, ADR-006 | 10 | §3, §6, ADR-007 | 16 | Delivery: README + recording; this doc supplies its architecture, buffering and trade-off sections |
| 5 | §3, ADR-006 | 11 | §6 | | |
| 6 | §3, §5, ADR-008/011 | 12 | §6, ADR-009/010 | | |
