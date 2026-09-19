# Epic 1 Context: Live market gateway

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Build the backend half of PulseCrypto: a single Node.js process that ingests live Binance market data for five USDT pairs (BTC, ETH, SOL, DOGE, XRP), keeps only the latest state per pair, and serves any WebSocket client a full snapshot on connect, then only the pairs that changed, at an interval each client chooses. The backend must survive Binance outages without a restart, keep memory bounded when clients are slow, and be able to run offline on a deterministic synthetic source that is always labelled as synthetic. The epic also sets up the toolchain, CI and shared wire contracts. Every later story, including the mobile epic, which runs entirely against the simulator, is held to the same type, lint and test gates.

## Stories

- Story 1.1: Toolchain baseline and CI
- Story 1.2: Wire contracts and protocol conformance
- Story 1.3: Domain model, latest-value buffer and simulator source
- Story 1.4: Binance market data adapter
- Story 1.5: WebSocket gateway and client sessions
- Story 1.6: Slow-consumer backpressure
- Story 1.7: REST endpoints and server configuration

## Requirements & Constraints

- **Ingestion:** all five pairs receive fresh book and last-price data within 5 s of start, and data keeps arriving continuously. Automated tests use recorded frames and a fake socket factory. CI never contacts Binance.
- **Cadence:** each client gets one emission per interval (default 100 ms) regardless of the upstream burst rate. `client.setInterval` accepts integers from 10 to 1000. Values outside that range get `error BAD_REQUEST` and the old interval is kept.
- **Bounded memory:** server state is O(pairs), never O(events). There is no per-client message queue anywhere. A stalled client cannot grow memory and does not affect healthy clients.
- **Payload:** every message validates against the shared schema. Each pair carries at least `pair`, `timestamp`, `price`, `spread`, `buyPressure`, `sellPressure`, `bids` and `asks`.
- **Metadata:** `GET /pairs/meta` returns one entry per pair with display name, trading status, and 24h high, low and volume.
- **Resilience:** when the upstream connection drops, clients get a stale status while their sockets stay open. After the automatic reconnect they get fresh data, with no restart.
- **Synthetic source:** it is chosen only at startup. It is never substituted automatically when Binance fails, so with Binance unreachable, clients see stale status and no fake prices.
- **Errors:** recoverable errors are handled, counted and surfaced through `market.status`, and never crash the process. Programmer errors fail loudly. There is no catch-and-ignore.
- **Honest numbers:** no performance claim is made unless it was measured. Tunable values are documented as config defaults, never as measurements. The 60 s flat-memory proof belongs to the Epic 3 stress run.
- **Scope:** no DB, Redis, broker, microservices, K8s, event sourcing, binary protocol, auth or trading, and no stubs for scaling out.

## Technical Decisions

- **Stack:** Node 22 (`>=22.13 <23`) runs TypeScript via `tsx`, with `tsc` for typechecking only and no build step. The package manager is pnpm 12.4.2 with a hoisted linker. Fastify 5 and `@fastify/websocket` serve HTTP and WS on one port. The upstream client is `ws` 8.21.3. Tests use Vitest (api, contracts). Every cadence, backoff and heartbeat test uses fake timers; with real sockets, fake only `setTimeout`, `setInterval` and `Date`.
- **Strictness:** enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax` and `noFallthroughCasesInSwitch`. `any` is banned. `unknown` appears only at boundaries and is narrowed by a Zod parse.
- **Layering:** `presentation → application → domain`. `infrastructure/{binance,simulator}` implements domain interfaces and is imported only by `composition-root.ts`, which ESLint enforces. `domain/` never imports contracts. No Binance-named identifier appears in `domain/` or `application/`. Only `presentation/` maps `PairState → PairSnapshot`.
- **Source abstraction:** `MarketDataSource { kind; start(sink); stop() }` emits only `DepthUpdate | TickerUpdate | SourceStatusChange`. Each source emits `connected:true` before its first data event and `connected:false` on any loss. `MARKET_SOURCE=binance|simulator` is selected once at startup. The simulator is seeded and deterministic. `SIMULATOR_RATE` is the total events/s, split evenly across pairs, with at least one depth event per pair every 100 ms.
- **Binance adapter:**
  - One combined stream carries `<pair>@depth20@100ms` and `<pair>@ticker` for every pair, in lower case. The pair comes from the wrapper's `stream` name. Each depth frame replaces the book, with no diff sync.
  - Every frame is Zod-parsed and its strings converted to numbers.
  - A book is valid when bids are strictly descending, asks strictly ascending, and `bestBid < bestAsk` when both sides exist. An empty side is valid.
  - Invalid frames are dropped and counted, never thrown.
- **Upstream connection lifecycle:**
  - States: `idle → connecting → connected → disconnected → reconnecting`.
  - An attempt ends once, on whichever comes first: `error`, `close`, `unexpected-response` or the connect timeout.
  - A silence watchdog starts at `open`.
  - Backoff is `floor(random() × min(cap, base × 2^attempt))`, using the shared contracts helper, with base 1 s and cap 30 s. The attempt counter resets after 60 s connected.
  - Timers and callbacks are bound to a generation id.
  - An HTTP 451 response logs one warning that suggests `BINANCE_WS_URL` / `wss://data-stream.binance.vision`.
- **Domain math:**
  - `spread = bestAsk − bestBid`.
  - `buyPressure = round2(100 × ΣbidQty / (ΣbidQty + ΣaskQty))` over the top 10 levels. `sellPressure = round2(100 − buyPressure)`.
  - All three are `null` when a side is empty, never 0 or 50.
  - Ticker fields: 24h change = `P`, volume = quote volume `q`.
  - `lastDepthAt` and `lastTickerAt` are server receive times. `timestamp` is the later of the two.
  - A pair is stale when upstream is disconnected, it has never had a depth update, or `now − lastDepthAt > STALE_AFTER_MS`.
- **Buffer:** a `Map<Pair, PairState>` is overwritten in place. Every mutation stamps `rev` from one process-wide monotonic sequence.
- **Sessions:**
  - On connect, send `market.snapshot` (every pair; nullable fields and `[]` books before first data), then `market.status`, and set `cursor` to the sequence at that moment.
  - Each tick sends `market.batch` with the pairs whose `rev > cursor`, then advances the cursor. An empty tick sends nothing.
  - Each session has one timer. On a `setInterval` change, re-arm it to `min(new, remaining)` and send `market.status` as the acknowledgement.
  - Each pair is serialized to JSON at most once per rev, lazily.
- **Backpressure:**
  - Only `market.batch` is gated.
  - When `bufferedAmount > WS_SOFT_LIMIT_BYTES`: skip the tick, do not advance the cursor, and count it.
  - Close with `4008` when the socket stays above the soft limit for `SLOW_CLIENT_MAX_STALL_MS` (checked every tick, including empty ones) or exceeds `WS_HARD_LIMIT_BYTES`.
- **Gateway hygiene:**
  - Inbound `maxPayload` is 4 KiB; a larger frame closes the connection with `1009`.
  - Binary, non-JSON, invalid or `v ≠ 1` input gets `error BAD_REQUEST`. The third rejection closes the connection with `1008`.
  - Ping every 15 s and terminate after 30 s without a pong.
  - `market.status { source, upstream{connected,since}, stalePairs, intervalMs, heartbeatMs, serverTime }` carries the complete stale set. It is sent on connect, on any change, and every `heartbeatMs` (default 5000).
- **Contracts package:**
  - Zod schemas use the default `.strip()`. The envelope is `{ v: 1, type, t }`, with integer epoch-ms times. `pair` matches `^[A-Z0-9]+$` and is not an enum.
  - Constants: `DISPLAY_LEVELS = 10`, `MAX_LEVELS = 20`, `DEFAULT_HEARTBEAT_MS = 5000`.
  - `decodeServerMessage(raw, mode)` is the only permitted cast of external data.
  - The package has no I/O, timers or state.
  - A schema, its protocol document and its tests always change together.
- **Config:** `config.ts` is a Zod schema that grows story by story and fails fast on invalid input. Defaults: `HOST=0.0.0.0`, `PORT=8080`, `MARKET_SOURCE=binance`, `BINANCE_WS_URL=wss://stream.binance.com:9443`, `PAIRS=BTCUSDT,ETHUSDT,SOLUSDT,DOGEUSDT,XRPUSDT`, `BROADCAST_INTERVAL_MS=100`, soft limit 1 MiB, hard limit 8 MiB. `STALE_AFTER_MS`, `UPSTREAM_SILENCE_MS`, `UPSTREAM_CONNECT_TIMEOUT_MS` and `SLOW_CLIENT_MAX_STALL_MS` are chosen during implementation and labelled as defaults. `/pairs/meta` static fields come from config, and startup fails if a pair has no meta.
- **Observability:**
  - Hot paths (ingest, normalize, broadcast) only increment integer counters: `upstream.frames.{received,invalid}`, `upstream.connect.failed`, `upstream.reconnects`, `buffer.mutations`, `ws.frames.{sent,skipped}` and `ws.clients.{active,evicted,timedOut}`.
  - Event-loop delay is measured with `monitorEventLoopDelay`.
  - `/health` exposes all of these read-only and returns 200 whenever HTTP is served.
  - Pino logs state transitions only.
- **Cleanup:** `stop()` and client close clear every socket, timer and session.
- **Process:** every new dependency gets a one-line justification in its PR. Rejected review findings are logged in `docs/ai/ai-development-log.md`.

## Cross-Story Dependencies

- 1.1 gates everything: its lint boundaries and CI apply from the first commit.
- 1.2 provides the schemas, constants, `decodeServerMessage` and `backoffDelay` used by 1.4 (backoff), 1.5 (message validation), 1.7 (`PairsMetaResponse`, `HealthResponse`) and by Epic 2.
- 1.3 defines `MarketDataSource`, `PairState`, the buffer and the simulator. 1.4 implements a second source against the same interface. 1.5 consumes both through the composition root.
- 1.6 extends the 1.5 session tick with the backpressure gate. 1.7 completes the config set and the fail-fast startup that 1.3–1.6 build up.
- Epic 2 (mobile) depends on this epic's protocol and runs fully on the simulator. Epic 3 measures CAP-3 memory flatness and the stress figures that this epic only makes configurable.
