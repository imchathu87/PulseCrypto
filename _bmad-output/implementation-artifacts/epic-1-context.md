# Epic 1 Context: Live market gateway

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Build the backend half of PulseCrypto: a single Node.js process that ingests live Binance market data for five USDT pairs (BTC, ETH, SOL, DOGE, XRP), keeps only the latest state per pair, and serves any WebSocket client a full snapshot on connect followed by changed pairs at that client's own interval. The backend must survive Binance outages without a restart, stay memory-bounded under slow clients, and optionally run offline on a deterministic, clearly labelled synthetic source. Epic 1 also sets up the toolchain, CI and shared wire contracts, so every later story, including the whole mobile epic running on the simulator, is held to the same type, lint and test gates.

## Stories

- Story 1.1: Toolchain baseline and CI
- Story 1.2: Wire contracts and protocol conformance
- Story 1.3: Domain model, latest-value buffer and simulator source
- Story 1.4: Binance market data adapter
- Story 1.5: WebSocket gateway and client sessions
- Story 1.6: Slow-consumer backpressure
- Story 1.7: REST endpoints and server configuration

## Requirements & Constraints

- All five pairs get fresh book and last-price data within 5 s of start, and data keeps arriving.
- Clients receive about one emission per interval (default 100 ms) whatever the upstream burst rate. A per-client `client.setInterval` accepts integers from 10 to 1000 ms.
- Every message validates against the shared schema and identifies its pair. Book-derived fields (`spread`, `buyPressure`, `sellPressure`) are `null` when a book side is empty, never `0` or `50`.
- A client that stops reading must not grow server memory. Server state is O(pairs), with no per-client or per-event queue. The 60 s flat-memory claim is measured in Epic 3, not asserted here.
- When upstream drops, clients receive stale status while their sockets stay open. After automatic reconnection they receive fresh data.
- Synthetic data is never substituted automatically. With the Binance source selected and Binance unreachable, clients see `upstream.connected: false`, every pair stale, and no prices.
- `GET /pairs/meta` returns one entry per pair with display name, trading status, precisions and live 24h high, low and volume. `GET /health` always returns 200 with counters.
- Recoverable errors are handled, counted and surfaced through `market.status`, and the process never crashes on them. Programmer errors fail loudly. Nothing is caught and ignored.
- No performance claim appears unless it was measured. Defaults chosen during implementation are labelled as config defaults.
- CI never contacts Binance. Tests use the simulator, fixtures or fake sockets.
- Out of scope: database, Redis, broker, microservices, K8s, event sourcing, binary protocol, auth, trading, and scale-out stubs.

## Technical Decisions

- **Toolchain:** pnpm 12.4.2 workspace (`nodeLinker: hoisted`, `allowBuilds: { esbuild: true }`), Node pinned `>=22.13 <23` via `engines` and `.nvmrc` (locked ESLint 10.10.0 requires `^22.13.0`), TypeScript 6.0.3 run through `tsx` (`tsc` only typechecks), Fastify 5 with `@fastify/websocket` on one port, and `zod` pinned at the root. Contracts export TS source with no build step. Every package enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax` and `noFallthroughCasesInSwitch`. If a flag conflicts with the Expo base config, stop and raise it rather than drop the flag.
- **Testing:** Vitest for the API and contracts; Jest with `jest-expo` and RNTL for mobile. Every cadence, backoff and heartbeat test uses fake timers. With real sockets, fake only `setTimeout`, `setInterval` and `Date`. There is no coverage threshold.
- **Layering:** `presentation → application → domain`. `infrastructure/{binance,simulator}` implements domain interfaces and only `composition-root.ts` imports it. ESLint `no-restricted-imports` enforces this, and a test proves it through the ESLint Node API. `domain/` never imports contracts. Nothing in `domain/` or `application/` is named after Binance. Only `presentation/` maps `PairState → PairSnapshot`.
- **Contracts:** Zod schemas use the default `.strip()`. The envelope is `{ v: 1, type, t }`, and wire times are integer ms epoch. `pair` matches `^[A-Z0-9]+$` and is not an enum. Constants: `DISPLAY_LEVELS = 10`, `MAX_LEVELS = 20`, `DEFAULT_HEARTBEAT_MS = 5000`. `decodeServerMessage(raw, 'full' | 'envelope')` is the only permitted cast of external data. Contracts hold no I/O, timers or module state. Schema, contract document and tests change together.
- **Backoff:** one pure helper, `floor(random() × min(cap, base × 2^attempt))`, with `random` injected. Upstream uses 1 s / 30 s. Downstream (mobile) uses 0.5 s / 5 s.
- **Source abstraction:** `MarketDataSource { kind; start(sink); stop() }` emits only `DepthUpdate | TickerUpdate | SourceStatusChange`. A source emits `{connected:true}` before its first data event and `{connected:false}` on any loss. `MARKET_SOURCE` is chosen once at startup, with no runtime switch and no fallback.
- **Binance adapter:** one combined connection carries `<pair>@depth20@100ms` and `<pair>@ticker` in lower case. The pair comes from the wrapper `stream` name because depth frames carry no symbol. Each depth frame replaces the whole book, with no diff sync. Every frame is Zod-parsed and its strings converted to numbers. A book is valid when bids are strictly descending, asks strictly ascending and bestBid < bestAsk (an empty side is valid). Invalid frames are dropped and counted, and never thrown or logged per frame. The client is `ws` 8.21.3, declared directly, with states `idle → connecting → connected → disconnected → reconnecting`. An attempt ends once, on the first of error, close, unexpected-response or connect timeout. A silence watchdog runs from `open`. The retry counter resets after 60 s connected. HTTP 451 logs one hint naming `wss://data-stream.binance.vision`. Timers are bound to a generation id.
- **Domain math:** `spread = bestAsk − bestBid`. `buyPressure = round2(100 × ΣbidQty / (ΣbidQty + ΣaskQty))` over the first 10 levels only, and `sellPressure = round2(100 − buyPressure)`. The ticker supplies `c` for price, `P` for 24h change, `h` and `l`, and `q` for quote volume. `lastDepthAt` and `lastTickerAt` are server receive times, and `timestamp` is the later of the two. A pair is stale iff upstream is disconnected, the pair has no depth yet, or `now − lastDepthAt > STALE_AFTER_MS`.
- **Latest-value buffer:** a `Map<Pair, PairState>` overwritten in place. Every mutation stamps `rev` from one process-wide monotonic sequence.
- **Sessions:** on connect, send `market.snapshot` (all pairs, nullable fields and `[]` books before data), then `market.status`, and set the cursor. Each tick sends a `market.batch` of pairs with `rev > cursor`. An empty tick sends nothing. Each session has one timer, cleared on close. An accepted interval re-arms the timer to `min(new, remaining)` and acks with `market.status`. Each pair is serialized once per rev into a lazily cached JSON fragment.
- **Backpressure:** only `market.batch` is gated. When `bufferedAmount > WS_SOFT_LIMIT_BYTES`, the tick is skipped and the cursor is **not** advanced. Eviction closes `4008` after continuous stall for `SLOW_CLIENT_MAX_STALL_MS`, checked on every tick including empty ones, or when `bufferedAmount > WS_HARD_LIMIT_BYTES`.
- **Gateway input:** `maxPayload` is 4 KiB (oversize closes `1009`). Invalid, binary, non-JSON or `v ≠ 1` input gets `error BAD_REQUEST`, and the third rejection closes `1008`. The server pings every 15 s and terminates after 30 s without a pong. `market.status { source, upstream{connected,since}, stalePairs (complete set), intervalMs, heartbeatMs, serverTime }` goes out on connect, on any change and every `heartbeatMs`.
- **Observability:** integer counters `upstream.frames.{received,invalid}`, `upstream.connect.failed`, `upstream.reconnects`, `buffer.mutations`, `ws.frames.{sent,skipped}` and `ws.clients.{active,evicted,timedOut}`, plus `monitorEventLoopDelay`, all exposed read-only on `/health`. Pino logs state transitions only. Nothing logs in the ingest, normalize or broadcast paths.
- **Config:** `config.ts` Zod-parses once and fails fast before listening, naming the bad variable. Variables: `HOST`/`PORT` (`0.0.0.0`/`8080`), `MARKET_SOURCE` (`binance`), `BINANCE_WS_URL` (`wss://stream.binance.com:9443`), `PAIRS` (the five uppercase pairs), `BROADCAST_INTERVAL_MS` (100), `STALE_AFTER_MS`, `UPSTREAM_SILENCE_MS`, `UPSTREAM_CONNECT_TIMEOUT_MS`, `SLOW_CLIENT_MAX_STALL_MS` (chosen in implementation), `WS_SOFT_LIMIT_BYTES` (1 MiB), `WS_HARD_LIMIT_BYTES` (8 MiB) and `SIMULATOR_RATE` (total events/s split evenly, at least one depth event per pair per 100 ms). Every `PAIRS` entry must have static meta.

## Cross-Story Dependencies

- Story 1.1's gates (flags, lint boundaries, CI, `docs/ai/ai-development-log.md`) apply to every later story. Each story records any rejected review findings in that log.
- Story 1.2's contracts, `decodeServerMessage` and backoff helper feed 1.4 (upstream backoff), 1.5 (message schemas), 1.7 (REST schemas) and Epic 2's `MarketSocket`.
- Story 1.3 creates `config.ts` with `PAIRS`, `MARKET_SOURCE` and `SIMULATOR_RATE`. Stories 1.4, 1.5 and 1.6 each add only their own variables, and 1.7 completes the set and the fail-fast startup. No story depends on a later one for its config.
- Story 1.3's domain types, buffer and simulator are the base for 1.4 (a second source), 1.5 (which reads the buffer), 1.6 (which gates sessions from 1.5) and 1.7 (which reads the buffer for meta).
- Epic 2 runs entirely against this gateway on `MARKET_SOURCE=simulator`. Epic 3 measures the CAP-3 memory claim and the stress numbers on the simulator.
