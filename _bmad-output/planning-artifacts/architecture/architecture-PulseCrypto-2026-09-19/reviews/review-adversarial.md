# Adversarial Architecture Review: PulseCrypto

- Date: 2026-09-19
- Lens: adversarial. For each finding I describe two units (stories or developers) that each follow every ADR and rule exactly and still build things that do not fit together.
- Inputs read: `docs/architecture/architecture.md`, `docs/architecture/adr/ADR-001..012`, `AGENTS.md`,
  `docs/architecture/engineering-standards.md`, `docs/architecture/testing-strategy.md` (including the uncommitted 10..1000 edit),
  `docs/architecture/scope-boundaries.md`, `_bmad-output/specs/spec-pulsecrypto/SPEC.md` and its companions,
  plus the skeleton code (`packages/contracts/src/index.ts`, `apps/api/src/server.ts`, `apps/mobile/App.tsx`).
- Not present: `docs/contracts/` (named by AGENTS.md:7 and ADR-006:22). Because of this, every wire-semantics gap below is still open.
  Nothing has settled it yet.

## Verdict

The server's core design holds up: the latest-value map, the global rev, the single-integer cursor and the skip-without-advance rule.
The seams between units do not. The wire contract is specified at the level of field names but not
field semantics, and several of those semantics decide whether the pieces fit. Examples:
- whether `market.snapshot` replaces or merges
- whether fields are nullable before the first ticker
- whether `rev` may be compared across connections
- the heartbeat period
- how interval ownership works
- how favourites replay works

Two independent developers would build the pieces differently.
There are 3 critical, 10 high, 11 medium and 6 low findings.

---

## Critical

### A-01 · critical · `rev` restarts at zero on server restart, and the client may treat rev as a freshness guard
- **Where:** architecture.md:80-85, ADR-003:13-16, ADR-004:11-14, ADR-009:11-13
- **Unit A (API buffer story):** keeps the process-wide sequence in memory (ADR-003:19, "state in memory only").
  After a restart it begins again at 1.
- **Unit B (mobile marketStore story):** `rev` is on the wire in every `PairSnapshot` and is described as
  "totally ordered" (ADR-003:14). A careful store author adds `if (incoming.rev <= stored.rev) ignore` to
  guard against reordering. No rule forbids this, and it is a reasonable defence against duplicates.
- **Divergence:** after the backend restarts (acceptance demo 6), every incoming pair has a lower rev than the
  stored one. The client discards them all, and the UI stays frozen on the old data while showing `CONNECTED`. CAP-13 fails.
- **Tightening:** "`rev` is meaningful only within one WebSocket connection; the client must never compare a
  `rev` received on one connection with one received on another, and `market.snapshot` unconditionally
  replaces the stored rev for every pair it carries." Also add a protocol test: restart server, then the client applies the new snapshot.

### A-02 · critical · On reconnect, "snapshot replaces all pairs" clashes with "data is never cleared" and with nullable pre-ticker fields
- **Where:** architecture.md:112 ("a fresh `market.snapshot` replaces all pairs"), architecture.md:150-151
  ("data is never cleared on disconnect"), architecture.md:161 ("Pair without ticker or depth yet → Emit with `null`s")
- **Unit A (API buffer):** after a restart, the first `market.snapshot` holds all five pairs with `price: null`,
  `bids: []` and so on, because upstream has not delivered yet (the buffer is pre-seeded, as the failure-mode table implies).
- **Unit B (mobile store):** follows §5 literally and replaces every pair with the snapshot entry.
- **Divergence:** the last known prices are replaced by `—`. That is exactly the blanking §6 forbids and CAP-13
  ("keeps showing the last received data") prohibits. Other developers pick other options: merge,
  skip null fields, or keep the whole old pair. Each is consistent with some sentence in the architecture.
- **Tightening:** "Applying a `PairSnapshot`, from either `market.snapshot` or `market.batch`, overwrites a stored field only when the
  incoming value is non-null; a pair absent from a `market.snapshot` is retained and marked stale, never
  deleted." Alternatively, forbid the server from emitting a pair before its first ticker. Either choice works if it is written once and tested.

### A-03 · critical · Favourites "toggles recorded as operations and replayed" reverses the user's intent
- **Where:** architecture.md:139-140, ADR-009:19-20, testing-strategy.md:60
- **Unit A (favouritesStore):** stores pre-hydration operations as `toggle(pair)`, which is the natural reading of "toggles … recorded".
- **Unit B (watchlist row):** renders the star from the store before hydration, so it shows unfavourited.
- **Divergence:** BTC is persisted as favourited. Before hydration the user sees an empty star and taps it to favourite.
  Hydration loads `{BTC}`, and replaying `toggle(BTC)` removes it. The user's action produced the opposite of what they intended.
  The listed test ("toggled before hydration are not lost") passes if it hydrates an empty set, so the test gives false confidence.
- **Tightening:** "Pre-hydration favourite changes are recorded as absolute intents `{pair, favourite: boolean}`
  and applied last-write-wins over the hydrated set; the test hydrates a set that already contains the toggled pair."

---

## High

### A-04 · high · The mobile heartbeat watchdog depends on a server env var that is not on the wire
- **Where:** architecture.md:108, 118-119, 194; ADR-008:19
- **Unit A (API status monitor):** sets `STATUS_INTERVAL_MS` "in implementation" (architecture.md:194), for example 5000.
- **Unit B (MarketSocket):** needs "3 × `STATUS_INTERVAL_MS`" but the value is not available on the device. The `market.status` fields are
  `source, upstream, stalePairs, intervalMs, serverTime`, and `intervalMs` is the broadcast interval, not the heartbeat interval.
  The developer hardcodes 1000, so the timeout becomes 3 s.
- **Divergence:** the mobile socket kills a healthy connection every 3 s, which causes a reconnect storm with jitter. Tuning the server
  env in the stress test silently breaks the client.
- **Tightening:** "`market.status` carries `heartbeatMs`; `MarketSocket` computes its liveness timeout as
  `3 × heartbeatMs` from the most recent status and uses a documented contract constant only before the first status."

### A-05 · high · Nobody owns `upstream.connected`, and the simulator never has to report it
- **Where:** ADR-011:12-17 (`SourceStatusChange` in `MarketEvent`), architecture.md:26 (status monitor in application),
  architecture.md:117-118, ADR-008:19, architecture.md:196 (`SIMULATOR_RATE`)
- **Unit A (simulator story):** implements `start(sink)` that emits `DepthUpdate`/`TickerUpdate` at `SIMULATOR_RATE`.
  It has no socket, so it never emits `SourceStatusChange`, and no rule requires it to.
- **Unit B (status-monitor story):** derives `upstream.connected` from `SourceStatusChange` events, starting at `false`.
- **Divergence:** in simulator mode, which is the mode the stress test and CI use, every pair is reported stale indefinitely. A related split: the
  upstream silence watchdog and backoff could live either in the Binance adapter (infrastructure) or in
  `application/backoff` (architecture.md:206). The state machine could end up with two owners or with none.
  `SIMULATOR_RATE` also does not say whether it counts per pair or in total, or how it splits between depth and ticker. A ticker-only simulator makes every pair
  "no depth update for `STALE_AFTER_MS`".
- **Tightening:** "Every `MarketDataSource` emits `SourceStatusChange{connected:true}` before its first data
  event and `{connected:false}` on any loss; the upstream reconnect state machine and silence watchdog live
  inside the adapter; the status monitor derives `upstream.connected` only from these events;
  `SIMULATOR_RATE` is total events/s split evenly across pairs, with at least one depth event per pair per 100 ms."

### A-06 · high · Two owners of the effective broadcast interval, and `setInterval` can starve a session's timer
- **Where:** architecture.md:89-92, 114-115, 133, 193; ADR-004:15-16; SPEC Assumptions:100
- **Unit A (settingsStore/slider):** initialises the chosen interval to `100` (the documented default) and, per §5,
  "re-sends its chosen interval after every connect". The slider sends `client.setInterval` on every
  `onValueChange`, about 60 per second while dragging.
- **Unit B (ClientSession):** on each `setInterval`, clears and re-arms its timer at the new interval.
- **Divergence:**
  1. The `BROADCAST_INTERVAL_MS` env default no longer matters for any mobile client, because the client always overrides it with its own hardcoded 100.
  2. While the user drags toward 1000 ms, every message re-arms the timer, so the session emits nothing and the mobile
     heartbeat may time out.
  3. There is no ack message. One developer waits for `market.status.intervalMs` to confirm; another updates the UI optimistically.
     The architecture does not say whether an interval change counts as a "change" that triggers an immediate status.
  4. The architecture also does not say whether `intervalMs` must be an integer.
- **Tightening:** "`settingsStore.intervalMs` is `null` until the user moves the slider and only a non-null value
  is re-sent on connect; the slider sends `client.setInterval` on release only; the server treats
  `market.status.intervalMs` as the ack and sends a status immediately after any accepted change; on change the
  session re-arms so the next tick fires at `min(newInterval, timeRemaining)`; `intervalMs` is an integer."

### A-07 · high · AGENTS.md requires a Zod parse at every boundary, but engineering-standards §6 skips it in production
- **Where:** AGENTS.md:14-15, engineering-standards.md:20-21 and 79-80, architecture.md:148-149, ADR-006:20-21
- **Unit A (MarketSocket, reading engineering-standards §6):** parses only `{v,type,t}` in production. To give the
  payload a type it needs `data as MarketBatch`, which is effectively `as unknown as X` on JSON.
- **Unit B (reviewer or agent applying AGENTS.md:14):** rejects the cast. "`unknown` at external boundaries, narrowed by a
  Zod parse. … never `as unknown as X`." A compliant rewrite adds a full parse and undoes the documented CPU trade-off.
- **Divergence:** the two rules cannot both be satisfied. engineering-standards §4 (lines 60-61) also says a schema mismatch
  on our own contract should "fail loudly". Under `__DEV__` it is unclear whether a failed parse at 10 Hz should throw
  (a red screen every 100 ms) or drop and count. Also unspecified: what the client does on a `v` mismatch.
- **Tightening:** "The only permitted cast of a server message is inside `packages/contracts`'
  `decodeServerMessage(raw: unknown)`, which envelope-parses in production and full-parses in `__DEV__`; a
  `__DEV__` parse failure is logged once per message type and the message is dropped; a `v` mismatch closes
  the socket with a visible `INCOMPATIBLE` state." Record this exception in AGENTS.md.

### A-08 · high · Three names and three shapes for the entity that crosses boundaries
- **Where:** engineering-standards.md:53-54 ("only `MarketSnapshot` leaves it"), ADR-011:17
  (`MarketEvent = DepthUpdate | TickerUpdate | SourceStatusChange`), ADR-006:14-16 (`PairSnapshot`),
  architecture.md:25 (`PairState`), skeleton `packages/contracts/src/index.ts:3-7` (`MarketSnapshot {pair, price, lastUpdated}`)
- **Unit A (adapter story):** follows engineering-standards and emits a `MarketSnapshot`, reusing the skeleton contract type
  with `lastUpdated`.
- **Unit B (domain/buffer story):** follows ADR-011 and consumes `DepthUpdate`/`TickerUpdate`, then builds `PairState` and
  serialises it as `PairSnapshot` with `timestamp`.
- **Divergence:** the types do not match at the sink. It is also unclear whether `domain/` may import
  `packages/contracts`, meaning whether `PairState` is simply the wire type. If yes, the wire contract is tied to the domain.
  If no, nobody is assigned the mapping step.
- **Tightening:** "The adapter emits only `MarketEvent` (ADR-011); `PairState` is a domain type that never
  imports `packages/contracts`; `presentation/ws-gateway` maps `PairState → PairSnapshot` (the only wire
  type, replacing the skeleton's `MarketSnapshot`/`lastUpdated`); engineering-standards §3 is corrected to say so."

### A-09 · high · A literal "cached per rev" serialisation cache grows O(events)
- **Where:** architecture.md:93-94, ADR-004:17
- **Unit A (serializer story):** implements `Map<rev, string>`, a literal reading of "cached per `rev`", and fills it eagerly on each mutation.
- **Unit B (buffer story):** meets "server state is O(pairs)" (AGENTS.md:18) in the `Map<Pair, PairState>`.
- **Divergence:** the cache grows with the event rate: at 1000 events/s that is about 3.6 M entries per hour. Even with eviction, eager
  serialisation at 1000 events/s produces JSON for revisions no client ever reads. That undermines the stress-test claim that
  serialisation is O(changed pairs) per tick.
- **Tightening:** "The serialisation cache holds at most one fragment per pair, keyed `(pair, rev)` and
  replaced when that pair's rev changes; fragments are produced lazily on the first tick that needs them."

### A-10 · high · Staleness uses depth only, while `timestamp` moves on depth or ticker
- **Where:** ADR-007:24-25 and 30 ("drives staleness with one clock"), architecture.md:117-118 ("no depth update for `STALE_AFTER_MS`")
- **Unit A (domain timestamp):** stamps `timestamp` on depth or ticker mutation.
- **Unit B (status monitor):** marks a pair stale when it has had no depth update for `STALE_AFTER_MS`.
- **Divergence:** if the depth stream for a pair stops while the ticker continues, the Terminal shows "last updated 0 s ago" next to a
  `STALE` chip. The two sources contradict each other on screen, and ADR-007 incorrectly claims they use one clock. The architecture also leaves open
  when a pair that has never received data becomes stale: from boot, or never.
- **Tightening:** "A pair is stale iff upstream is disconnected, or it has never received a depth update, or
  `now − lastDepthAt > STALE_AFTER_MS`; `PairSnapshot` carries `lastDepthAt` and `lastTickerAt` separately and the UI
  labels `timestamp` as the later of the two."

### A-11 · high · Semantics of `stalePairs` and the per-row "live connection indicator" are undefined
- **Where:** architecture.md:117-119, ADR-008:22, ADR-009:11, SPEC CAP-7, figma-scope.md:10
- **Unit A (API):** when upstream is disconnected, sends `stalePairs: []` and `upstream.connected:false`, reasoning that the
  flag already covers it. Another developer lists all five pairs.
- **Unit B (row indicator):** reads only `stalePairs.includes(pair)`. The header chip reads socket state.
  Neither knows which takes precedence among `SIMULATED`, `RECONNECTING`, `STALE` and `LIVE`.
- **Divergence:** during an upstream outage, rows show live while the header shows stale. While the mobile socket itself is down,
  the last status received still says nothing is stale. It is also unspecified whether `stalePairs` is a full set or a delta, and
  whether an unchanged heartbeat status creates a new array that re-renders every selector reading it.
- **Tightening:** "`stalePairs` is the complete set on every status, including all pairs while upstream is
  disconnected; `marketStore` exposes one derived `pairLiveness(pair): 'offline'|'stale'|'live'` with precedence
  socket-down > stale > live, and the header chip uses the same precedence plus `SIMULATED`; a status equal
  to the stored one produces no commit."

### A-12 · high · Order of the first messages on connect and interaction with the backpressure gate
- **Where:** architecture.md:86-88, 110, 118-119; ADR-008:20; testing-strategy.md:47
- **Unit A (ws-gateway):** sends `market.status` first on connect (source, stale set), then `market.snapshot` on the session's
  first tick. That is up to 1000 ms later if the client has already sent `setInterval(1000)`.
- **Unit B (MarketSocket):** resets backoff and sets `CONNECTED` on the first snapshot (ADR-008:20), so a status arriving before any pairs
  exist hits a store that has no pairs.
- **Divergence:** it is undefined whether the snapshot is sent at once or on the first tick. It is undefined whether `market.snapshot` and
  `market.status` pass through the `bufferedAmount` gate. It is undefined what the new session's cursor is: if the snapshot does not
  set it, the first batch re-sends everything.
- **Tightening:** "On connect the server immediately sends `market.snapshot` (all configured pairs) then
  `market.status`, both bypassing the soft-limit gate, and sets the session cursor to the global sequence value
  at snapshot time; `market.status` heartbeats also bypass the gate but count toward the hard limit."

### A-13 · high · Eviction plus "backoff resets on first snapshot" produces an eviction loop
- **Where:** ADR-005:17, ADR-008:20, architecture.md:110, 163
- **Unit A (API):** closes a slow client with `4008`.
- **Unit B (MarketSocket):** reconnects with backoff, and backoff resets on the first `market.snapshot`, which always arrives straight away.
- **Divergence:** a client that is persistently slow reconnects, gets a snapshot, resets to base 0.5 s, and is evicted again. This repeats
  indefinitely at about 0.5 s cadence. That is the "reconnect storm" the engineering-standards §9 checklist names. The same applies to a
  backend that crashes just after it sends the snapshot. The upstream side correctly resets only after 60 s of stability; the downstream side does not.
- **Tightening:** "Downstream backoff resets only after the socket has stayed open for `DOWNSTREAM_STABLE_MS`
  (default 10 s) after its first snapshot; a `4008` close never resets the attempt counter."

---

## Medium

### A-14 · medium · Two owners of the pair list, and the pair-id and display-name format
- **Where:** architecture.md:131, 141-142; ADR-006:18; SPEC CAP-8 ("leaves only BTC / USDT")
- **Unit A (watchlist):** builds its rows from `/pairs/meta`, which carries the display names.
- **Unit B (marketStore):** builds pairs from `market.snapshot`.
- **Divergence:** if the meta fetch fails (a testing-strategy.md:117 scenario), watchlist A is empty while the WebSocket is healthy.
  Watchlist B shows `BTCUSDT` until meta arrives. Search may be case-sensitive or not, and may match `displayName`, `pair` or both.
  A developer who derives "BTC / USDT" by splitting the id has to guess where base ends and quote begins.
  Favourites might be keyed by `displayName`. The shape of `/pairs/meta` (array or record), the values of `tradingStatus`
  (enum or free string), and whether high/low/volume can be null before the first ticker are all unspecified.
- **Tightening:** "The watchlist row set is the key set of `marketStore.pairs` (WS); `/pairs/meta` only decorates
  rows and a missing entry falls back to the raw `pair` id; favourites and all keys use the `pair` id
  (`^[A-Z0-9]+$`); search is case-insensitive over `pair` and `displayName`; `/pairs/meta` is
  `{ pairs: Array<{pair, displayName, tradingStatus: 'TRADING'|'HALTED', high24h|null, low24h|null, volume24h|null}> }`;
  startup config fails fast if any `PAIRS` entry lacks static meta."

### A-15 · medium · `volume24h` units and the price used for "liquidity gap" are not specified
- **Where:** ADR-006:15-16, ADR-007:18, binance-feed.md:16 (`v` base vs `q` quote), SPEC Assumptions:102
- **Unit A (adapter):** maps `v` (base volume, for example BTC).
- **Unit B (Terminal UI):** labels the value "Vol (USDT)" and computes the liquidity gap as `spread / price`, where price is the last traded price.
  Another developer divides by mid-price.
- **Tightening:** "`volume24h` is quote-asset volume (Binance `q`); liquidity gap % = `spread / midPrice × 100`
  where `midPrice = (bestBid + bestAsk) / 2`, computed client-side and `null` when spread is null."

### A-16 · medium · Levels: pressure is computed over 10, the payload carries 20, and "20" reads as a fixed length
- **Where:** ADR-007:15-16, architecture.md:146-147, ADR-004:11-12 ("20 bids, 20 asks"), AGENTS.md:19, figma-scope.md:15-16
- **Unit A (contracts):** reads "20 bids, 20 asks" and writes `z.array(Level).length(20)`. The simulator or a thin book sends fewer,
  and the `__DEV__` parse fails.
- **Unit B (depth visual and totals):** computes bid/ask totals and a "Sell Heavy" label over all 20 levels, while `buyPressure`
  comes from the server over 10. The screen then shows "Buy 58%" next to "Sell Heavy". The number 10 is also hardcoded separately
  in the API domain and in mobile.
- **Tightening:** "`bids`/`asks` are `z.array(Level).max(20)`; `DISPLAY_LEVELS = 10` is exported from
  `packages/contracts` and used by both the pressure function and the book; the pressure label is derived
  from server `buyPressure` only (Buy Heavy ≥ 55, Sell Heavy ≤ 45, else Balanced)."

### A-17 · medium · A skip budget counted in ticks evicts fast clients during a GC pause
- **Where:** architecture.md:96-98, ADR-005:17 and 32 (rejects "punishes a transient emulator GC pause")
- **Unit A (session at 10 ms):** hits `SLOW_CLIENT_MAX_SKIPS=20` after 200 ms of stall and is evicted.
- **Unit B (session at 1000 ms):** can stall for 20 s before eviction.
- **Divergence:** the policy ADR-005 rejects returns for fast clients, and eviction speed depends on a user slider.
  It is also undefined whether a tick with nothing to send counts as a skip, or resets the counter, when `bufferedAmount` is over the soft limit.
- **Tightening:** "The eviction budget is time-based: close with 4008 when `bufferedAmount` has stayed above the
  soft limit for `SLOW_CLIENT_MAX_STALL_MS`, measured on every tick including ticks with nothing to send."

### A-18 · medium · The connection state machine has no state for being backgrounded
- **Where:** engineering-standards.md:99, ADR-008:10-11 and 21, architecture.md:107, 166
- **Unit A (MarketSocket):** on `AppState background`, closes the socket. The close event moves the machine to `disconnected`,
  then `reconnecting`, and backoff schedules a reconnect while the app is backgrounded.
- **Unit B (AppState handler):** expects the socket to stay closed until `active`.
- **Divergence:** the app reconnects in the background, contradicting "close" in ADR-008:21. Old watchdog timers that resume after
  backgrounding can fire against the newly opened socket.
- **Tightening:** "Add state `paused` (entered on `background`, left only on `active` → `connecting`);
  every timer and callback is bound to a socket generation id and ignored if the generation has changed."

### A-19 · medium · Clock used for "last updated" age on the device
- **Where:** ADR-006:11 (`t`), ADR-007:24, 39-40, architecture.md:119 (`serverTime`)
- **Unit A (Terminal):** shows `Date.now() − timestamp`. The emulator clock is commonly off by seconds or minutes, so the display shows negative ages
  or "5 min ago".
- **Unit B (a different developer):** uses `t − timestamp`.
- **Tightening:** "Client-side ages are computed as `(Date.now() − localReceiveAt) + (t − timestamp)` using the
  envelope `t` of the message that carried the value; the device clock is never compared directly with a server
  timestamp. All wire times are integer ms epoch."

### A-20 · medium · CAP-2 and CAP-15 promise a rate the design deliberately does not deliver
- **Where:** SPEC CAP-2 ("one emission per interval … regardless"), CAP-15, architecture.md:88 ("A tick with no change sends nothing")
- **Unit A (API):** skips empty ticks.
- **Unit B (acceptance demo 8):** expects msgs/s ≈ 1000/interval. At 10 ms the observed rate is limited to the upstream change rate
  (about 55/s for Binance), not 100/s. At 1000 ms, `market.status` heartbeats add to the count if the counter includes them.
- **Tightening:** "Expected downstream rate is `min(1000/intervalMs, upstream pair-change rate)`; the msgs/s tile
  counts `market.batch` and `market.snapshot` only; README states this against CAP-2/CAP-15."

### A-21 · medium · "One algorithm" for backoff is implemented twice, because contracts may not hold logic
- **Where:** ADR-008:10-13, architecture.md:28 (contracts: "Hold runtime logic other than schemas" is a *Must not*), 206, 211
- **Unit A (`apps/api/src/application/backoff`):** `attempt` starts at 0, and `random(0, cap]`.
- **Unit B (`apps/mobile/src/services/backoff`):** `attempt` starts at 1, `Math.random()*…` floored, and no reset hook.
- **Divergence:** the "same algorithm" differs in off-by-one and in bounds. Tests in each app confirm their own version.
- **Tightening:** "Backoff is `delay(attempt) = floor(random() × min(cap, base × 2^attempt))` with `attempt` starting
  at 0 and `random` injected; both copies share one table-driven test vector file", or explicitly allow pure helpers in `packages/contracts`.

### A-22 · medium · Engineering-standards §4 says errors are surfaced through `market.status`, but the status schema has no field for them
- **Where:** engineering-standards.md:58-59, architecture.md:118-119
- **Divergence:** a developer following §4 adds `errors`/`invalidFrames` to `market.status`, which changes the public contract without
  a schema or doc update. Another developer leaves it out. The contract document does not exist yet, so neither is caught.
- **Tightening:** "Expected errors are surfaced to clients only as `upstream.connected` and `stalePairs`;
  counts are exposed only on `GET /health`."

### A-23 · medium · The status field `upstream.since` and the `/health` status code are undefined
- **Where:** architecture.md:76, 118-119, 174-175; testing-strategy.md:38
- **Divergence:** `since` could mean the last connect or the last state change, and before any connect it could be null or the boot time.
  `/health` could return 503 while upstream is down, which a readiness-minded developer would do. That breaks testing-strategy "returns 200" and
  the resilience scenario "WebSocket fails while REST is healthy".
- **Tightening:** "`upstream.since` = ms epoch of the last `connected` transition, `null` before the first;
  `/health` returns 200 whenever the process serves HTTP, with upstream state in the body."

### A-24 · medium · The mobile base URL format is ambiguous for REST and WS
- **Where:** architecture.md:197 (`10.0.2.2:8080`), stack.md:25
- **Unit A (meta fetcher):** `fetch(`${EXPO_PUBLIC_API_URL}/pairs/meta`)`, which expects `http://…`.
- **Unit B (MarketSocket):** `new WebSocket(`ws://${EXPO_PUBLIC_API_URL}/ws`)`, which expects a bare host.
- **Tightening:** "`EXPO_PUBLIC_API_URL` is an `http(s)://host:port` origin; the WS URL is derived by replacing the
  scheme with `ws(s)` and appending `/ws`, in one `api-endpoints.ts` module."

---

## Low

### A-25 · low · Inbound control-message size is not bounded
- **Where:** architecture.md:27, 35. By default `ws` has a `maxPayload` of 100 MiB, which contradicts CAP-3's bounded memory.
- **Tightening:** "The WS gateway sets `maxPayload` to 4 KiB; oversize or non-JSON input gets `error BAD_REQUEST` and the socket is closed after 3 such errors."

### A-26 · low · Book validity: is "not crossed" strict, and is an empty side allowed?
- **Where:** architecture.md:67-68, ADR-002:30. The simulator may emit a locked book (bid = ask). One developer drops it; another keeps it.
- **Tightening:** "Valid iff bids strictly descending, asks strictly ascending, and `bestBid < bestAsk` when both sides are non-empty; an empty side is valid."

### A-27 · low · Zod object strictness is undecided
- **Where:** ADR-006:14 ("carries at least"). A `.strict()` mobile schema rejects any additive server field in `__DEV__`, while `.strip()` accepts it.
- **Tightening:** "Wire schemas use default `.strip()`; additive fields are non-breaking and do not bump `v`."

### A-28 · low · The `error` message code set is not closed
- **Where:** architecture.md:90-91, ADR-006:12. Unknown `type`, malformed JSON and out-of-range values all map to `BAD_REQUEST`, or a developer invents new codes.
- **Tightening:** "`error.code` is `z.enum(['BAD_REQUEST'])` in v1, with a `message` string for detail."

### A-29 · low · The Figma TOTAL column and depth-bar normalisation are undefined
- **Where:** ADR-007:18. The total could be cumulative quantity or cumulative notional. Bar width could be relative to the max of 10 levels, of 20 levels, or of each side.
- **Tightening:** "TOTAL = cumulative quantity; bar width = cumulative qty / max(cumulative qty over both displayed sides)."

### A-30 · low · Two homes for the payload documentation
- **Where:** SPEC CAP-4 ("the README documents every field"), ADR-006:22 and AGENTS.md:7 (`docs/contracts/websocket-protocol.md`, not yet created).
- **Tightening:** "`docs/contracts/websocket-protocol.md` is the single field reference; README links to it."

---

## Internal contradictions (cross-document)

| # | Statement A | Statement B | Finding |
|---|---|---|---|
| 1 | AGENTS.md:14 "`unknown` … narrowed by a Zod parse; never `as unknown as X`" | engineering-standards.md:79 envelope-only in production | A-07 |
| 2 | engineering-standards.md:54 "only `MarketSnapshot` leaves [the adapter]" | ADR-011:17 `MarketEvent` | A-08 |
| 3 | ADR-007:30 "drives staleness with one clock" | architecture.md:118 depth-only staleness | A-10 |
| 4 | architecture.md:112 "snapshot replaces all pairs" | architecture.md:150 "data is never cleared" | A-02 |
| 5 | ADR-005:32 rejects evicting on a transient GC pause | tick-count skip budget at 10 ms intervals | A-17 |
| 6 | ADR-008 "one algorithm" | architecture.md:28 contracts hold no logic; two `backoff` files in §10 | A-21 |
| 7 | engineering-standards.md:59 "surface it via `market.status`" | status schema has no error field | A-22 |
| 8 | testing-strategy.md:52 "within the heartbeat window" | architecture.md:119 status "on every change" (immediate) | Test is weaker than the rule; assert emission within one event-loop turn of `SourceStatusChange` |
| 9 | ADR-008:21 `background → close` | engineering-standards.md:99 state list has no paused state | A-18 |
| 10 | SPEC CAP-2 "one emission per interval regardless" | architecture.md:88 empty tick sends nothing | A-20 |
| 11 | ADR-004:11-12 "20 bids, 20 asks" | ADR-002:28 "capped at 20"; thin or simulator books | A-16 |

## Testing gaps (the tests needed to prove the tightenings)

These are missing from testing-strategy.md:
- server restart followed by applying the new snapshot (A-01, A-02)
- toggle before hydration over a non-empty persisted set (A-03)
- heartbeat timeout derived from status (A-04)
- simulator emits `SourceStatusChange` (A-05)
- rapid `setInterval` sequence does not starve ticks (A-06)
- serialisation cache size stays at or below the pair count at 1000 events/s (A-09)
- depth-silent pair with live ticker (A-10)
- message order on connect (A-12)
- no tight reconnect loop after `4008` (A-13)
- `paused` state (A-18)

## CAP coverage

| CAP | Covered? | Gap |
|---|---|---|
| 1 | Yes (§3, ADR-001/002) | "within 5 s of start" has no mechanism or test; depends on the 451/endpoint open question |
| 2 | Partly | Conflicts with the empty-tick rule (A-20) |
| 3 | Yes (ADR-005) | Tick-based budget (A-17); inbound `maxPayload` (A-25); cache growth (A-09) |
| 4 | Partly | Nullability, level count and strictness undefined (A-02, A-16, A-27); contract doc missing (A-30) |
| 5 | Partly | Response shape, nullability and `tradingStatus` enum undefined (A-14) |
| 6 | Partly | Ownership of `upstream.connected` and the simulator case undefined (A-05) |
| 7 | Partly | Per-row "live connection indicator" source undefined (A-11) |
| 8 | Partly | Case sensitivity, and whether search matches the id or the display name (A-14) |
| 9 | Flawed | Replay semantics can reverse intent (A-03); AsyncStorage write failure not covered |
| 10 | Partly | Clock used for the timestamp label (A-19); pressure over 10 vs 20 (A-16) |
| 11 | Yes | Flash on snapshot-after-reconnect not specified (minor) |
| 12 | Yes (render-cadence rule) | FPS ≥ 55 relies on measurement; selector isolation test is only "where practical" |
| 13 | Flawed | A-01, A-02, A-13, A-18 |
| 14 | Yes | Depends on the pair list staying WS-owned (A-14) |
| 15 | Partly | Interval ownership, ack and timer starvation (A-06); which messages the msgs/s tile counts (A-20) |
| 16 | Yes (delivery) | README vs contract doc (A-30) |

## Component checklist

| Component | Where | Status |
|---|---|---|
| Node + TS runtime/build | architecture.md:33-34, ADR-012 | Covered |
| Fastify HTTP | architecture.md:35 | Covered |
| WS server and connection handling | architecture.md:27, 35, 86-99 | Partial: connect message order (A-12), `maxPayload` (A-25) |
| Binance ingestion | §3, ADR-001 | Covered; reconnect-machine owner ambiguous (A-05) |
| Normalization at the adapter boundary | §3, engineering-standards §3 | Contradictory type names (A-08); strictness of the crossed check (A-26) |
| Latest-value buffering with revisions | §4, ADR-003 | Covered; rev scope across restarts (A-01); cache (A-09) |
| Configurable batching, default 100 ms, how configured | §4, §9 (`BROADCAST_INTERVAL_MS` + `client.setInterval`) | Env default silently overridden by the client (A-06) |
| Backpressure | §4, ADR-005 | Covered; gate bypass for snapshot and status undefined (A-12) |
| Slow-consumer detection and policy | ADR-005 | Tick-based budget (A-17); eviction loop (A-13) |
| `/pairs/meta` and `/health` | §3, §8 | Shapes and status codes undefined (A-14, A-23) |
| RN + Expo + TS | ADR-009, ADR-012 | Covered |
| Efficient rendering | §6, ADR-009 | Covered; status heartbeat commits (A-11) |
| Where high-frequency updates land | §6 (`marketStore`, one commit per message) | Covered; merge semantics undefined (A-02) |
| Favourites persistence and hydration | §6, ADR-009 | Replay bug (A-03) |
| REST vs WS separation | §6 | Owner of the pair list (A-14); base URL (A-24) |
| Reconnection | §5, ADR-008 | Heartbeat period (A-04), backoff reset (A-13), paused state (A-18), duplicated algorithm (A-21) |
| Offline and stale behaviour | §5, §6 | A-02, A-10, A-11 |
| Telemetry | §8, ADR-010 | Covered; which messages the msgs/s counter counts (A-20) |
