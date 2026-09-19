# WebSocket Protocol

Status: accepted · protocol `v: 1` · 2026-09-19 · Story 2 · CAP-2, CAP-3, CAP-4, CAP-6, CAP-13, CAP-15

This is the **single field reference** for the market WebSocket (ADR-006). It is where the bounded-memory,
backpressure, initial-state and upstream-health requirements become concrete and testable. The Zod
schemas in `packages/contracts`, this document and the contract tests change together, in one change
(AGENTS.md). Every example in §9 must parse; every case in §10 must be rejected (testing-strategy.md,
contract tests).

Decisions come from ADR-003 (buffer), ADR-004 (snapshots and cadence), ADR-005 (backpressure),
ADR-006 (wire format), ADR-007 (derived values and timestamps) and ADR-008 (liveness). Where this
document differs from §6 of the engineering guide, §11 lists each difference and the reason.

REST endpoints are in [`rest-api.md`](rest-api.md).

## 1. Transport

| Property | Value |
|---|---|
| Endpoint | `ws://<host>:<port>/ws`, same origin as REST; the app derives it from `EXPO_PUBLIC_API_URL` |
| Frames | UTF-8 **text** frames, one JSON object per frame |
| Direction | Server → client: `market.snapshot`, `market.status`, `market.batch`, `error`. Client → server: `client.setInterval` |
| Inbound limit | `maxPayload` 4 KiB. A larger frame is closed by the WebSocket layer with `1009`, with no `error` message |
| Auth | None. Binance public market data needs no keys |

## 2. Envelope

Every server message:

```ts
type ServerEnvelope = {
  v: 1;          // protocol version; a breaking change increments it
  type: string;  // discriminant
  t: number;     // server clock at send time, integer epoch milliseconds
};
```

Every client message:

```ts
type ClientEnvelope = {
  v: 1;
  type: string;
  t?: number;    // optional client clock; ignored by the server, never compared with server time
};
```

**All times in this protocol are integer epoch milliseconds on the server clock.** This is a
deliberate deviation from the assignment's example payload (`"timestamp": 1720802025`, a
seconds-like value). Milliseconds match Binance's own `E`, keep sub-second update times visible,
and remove unit conversions from both ends (ADR-006, ADR-007).

### Versioning

- Schemas use Zod's default `.strip()`. A new field is **additive and non-breaking**; it does not bump `v`.
- Removing or renaming a field, changing its type or unit, or changing a message's meaning is
  **breaking** and increments `v`.
- A client that receives `v ≠ 1` moves its socket to `INCOMPATIBLE` and stops retrying (ADR-006, ADR-008).
- `rev` is meaningful only within one connection. A client never compares `rev` across connections.

## 3. `PairSnapshot`

The unit carried by `market.snapshot` and `market.batch`: one pair's **complete current state**,
never a delta (ADR-004).

```ts
type Pair = string;                         // /^[A-Z0-9]+$/, e.g. "BTCUSDT"; set by server config, not an enum
type OrderBookLevel = [price: number, quantity: number];

type PairSnapshot = {
  pair: Pair;                                // identity key
  rev: number;                               // integer ≥ 0; 0 = never mutated since server start

  // time (§6)
  timestamp: number | null;                  // "Last Updated" = max(lastDepthAt, lastTickerAt)
  lastDepthAt: number | null;                // server receive time of the latest depth frame
  lastTickerAt: number | null;               // server receive time of the latest ticker frame

  // ticker group: from <pair>@ticker
  price: number | null;                      // last traded price (Binance `c`); not the mid-price
  change24hPct: number | null;               // 24h change in percent (Binance `P`); 1.82 means +1.82 %
  high24h: number | null;                    // Binance `h`
  low24h: number | null;                     // Binance `l`
  volume24h: number | null;                  // 24h QUOTE-asset volume (Binance `q`), e.g. USDT

  // book group: from <pair>@depth20@100ms
  bids: OrderBookLevel[];                    // ≤ 20, best (highest) first, strictly descending price
  asks: OrderBookLevel[];                    // ≤ 20, best (lowest) first, strictly ascending price
  spread: number | null;                     // bestAsk − bestBid; null if either side is empty
  buyPressure: number | null;                // 0..100, 2 dp, app-derived (§7); null if either side is empty
  sellPressure: number | null;               // round2(100 − buyPressure); null with buyPressure
};
```

### Field rules

- **Nullable fields are always present.** Before first data a field is `null`, never omitted.
  `pair`, `rev`, `bids` and `asks` are never null; an empty book side is `[]`.
- **Group consistency.** The book group (`bids`, `asks`, `spread`, `buyPressure`, `sellPressure`,
  `lastDepthAt`) and the ticker group (`price`, `change24hPct`, `high24h`, `low24h`, `volume24h`,
  `lastTickerAt`) are each written atomically by one upstream event:
  - `lastDepthAt === null` ⇒ `bids` and `asks` are `[]` and the derived book fields are `null`.
  - `lastTickerAt === null` ⇒ every ticker field is `null`.
  - `timestamp === null` ⇔ both `lastDepthAt` and `lastTickerAt` are `null`.
- **Book validity.** A book on the wire has passed the adapter check: bids strictly descending,
  asks strictly ascending, and `bids[0][0] < asks[0][0]` when both sides exist. Every price and
  quantity is finite and `> 0`. Therefore `spread`, when non-null, is `> 0`.
- **Depth.** The wire carries up to `MAX_LEVELS = 20` per side. The UI shows `DISPLAY_LEVELS = 10`
  per side, and pressure is computed over those 10 (§7). Rows are keyed by index `0..19`, never by
  price (AGENTS.md).
- **`rev`** is stamped from one process-wide monotonic sequence on every mutation (ADR-003).
  Within one connection, a given pair's `rev` strictly increases from message to message.
- **Why 24h statistics are on the socket.** The watchlist needs `change24hPct` live on every row,
  and the assignment's `/pairs/meta` field list does not include a 24h change. So `change24hPct`
  travels over WebSocket, not `/pairs/meta`, by decision. `high24h`, `low24h` and `volume24h` travel
  here too, because they come from the same ticker event and the UI reads live values from one
  source (architecture §6). `/pairs/meta` also returns high, low and volume, read from the same
  in-memory map at request time, because the assignment requires them there.

## 4. Messages

### 4.1 Inventory

| Direction | `type` | When | Backpressure gate |
|---|---|---|---|
| server → client | `market.snapshot` | Once, immediately on connect: the **first** message of every connection | No |
| server → client | `market.status` | Right after the snapshot; on any status change; every `heartbeatMs`; as the ack of an accepted `client.setInterval` | No |
| server → client | `market.batch` | On a session tick where at least one pair has `rev > cursor` | **Yes** (§5) |
| server → client | `error` | A client message was rejected | No |
| client → server | `client.setInterval` | The user releases the update-frequency slider (Telemetry & Settings screen, CAP-15); re-sent on connect only if the user has set one | n/a |

### 4.2 `market.snapshot`

```ts
{ v: 1, type: 'market.snapshot', t, pairs: PairSnapshot[] }
```

- Contains **every configured pair exactly once**, including pairs with no data yet (nullable fields
  `null`, book sides `[]`). Array order carries no meaning.
- Sent before any `market.batch`. The session `cursor` is set to the sequence value at snapshot time.
- A client applies it unconditionally: it replaces stored `rev` values for this connection.
  It does **not** delete pairs missing from the payload. Pairs are never deleted client-side, so
  last data stays visible across a backend restart (architecture §6, CAP-13).

### 4.3 `market.batch`

```ts
{ v: 1, type: 'market.batch', t, pairs: PairSnapshot[] }   // pairs.length ≥ 1
```

- Contains only pairs whose `rev > cursor`, each at most once, each as a **complete** snapshot.
- After a successful write, `cursor` becomes the highest `rev` sent.
- A tick with no changed pairs sends **nothing**. An empty `pairs` array is never sent.
- Client apply rule: the book group replaces the stored group only when `lastDepthAt` is non-null;
  the ticker group likewise with `lastTickerAt` (architecture §6).

### 4.4 `market.status`

```ts
{
  v: 1, type: 'market.status', t,
  source: 'binance' | 'simulator',
  upstream: {
    connected: boolean,       // derived only from SourceStatusChange events (ADR-011)
    since: number | null,     // time `connected` last changed value (either direction); null before the first change
  },
  stalePairs: Pair[],         // the COMPLETE stale set, not a diff
  intervalMs: number,         // this session's current broadcast interval
  heartbeatMs: number,        // the interval at which this status repeats
  serverTime: number,         // server clock when the status was built; equal to `t`
}
```

- **`upstream.connected`** keeps the app from showing "Connected" over frozen prices when Binance
  drops while the local socket stays healthy. When upstream drops, downstream sockets stay open
  (ADR-008) and this field says so within one heartbeat.
- **`source`** is `binance` or `simulator`. When `source ≠ binance` the app shows `SIMULATED`, so
  synthetic data is never mistaken for the live market (ADR-011, CAP-17).
- **Staleness.** A pair is stale iff upstream is disconnected, **or** it has never had a depth update,
  **or** `now − lastDepthAt > STALE_AFTER_MS`. Staleness uses `lastDepthAt` only.
- "Status change" means any change to `source`, `upstream`, the stale set, `intervalMs` or `heartbeatMs`.
- Error counts are **not** in this message; they are on `GET /health`.

### 4.5 `client.setInterval`

```ts
{ v: 1, type: 'client.setInterval', t?: number, intervalMs: number }   // integer, 10 ≤ intervalMs ≤ 1000
```

- Affects only the sending connection. The server default is `BROADCAST_INTERVAL_MS` (env, default `100`).
- **Accepted:** the session timer re-arms so the next tick fires at `min(new, remaining)`, and a
  `market.status` carrying the new `intervalMs` is sent immediately as the acknowledgement.
- **Rejected** (out of range, non-integer, wrong type): `error BAD_REQUEST`, previous interval kept.
- The range matches the slider in SPEC CAP-15 (10 ms – 1000 ms). No rate limit: the slider sends
  only on release, and each accepted change costs one timer re-arm.

### 4.6 `error`

```ts
{ v: 1, type: 'error', t, code: 'BAD_REQUEST', message: string }
```

- Sent for any rejected client message: binary frame, non-JSON, unknown `type`, `v ≠ 1`, or a
  schema failure.
- `message` is human-readable and **not stable**. Clients branch on `code` only.
- The **third** rejected message on one connection closes it with `1008` (policy violation).

### 4.7 Close codes

| Code | Sent by | Meaning | Client reaction |
|---|---|---|---|
| `4008` | server | Slow consumer evicted (§5) | Reconnect; backoff is **not** reset (ADR-008) |
| `1008` | server | Third rejected client message | Reconnect with backoff |
| `1009` | WebSocket layer | Inbound frame over 4 KiB | Reconnect with backoff |
| `1006` | observed by client | Abnormal closure, including a server `terminate()` after ping timeout (§8) | Reconnect with backoff |

## 5. Backpressure and the slow-consumer policy

Per ADR-005. Before sending to each connected client, the server reads that socket's pending
output, `bufferedAmount`. Only `market.batch` passes through the gate; `market.snapshot`,
`market.status`, `error` and protocol pings are rare and small, and bypass it.

**Policy.** Per session, on **every** tick (including ticks with nothing to send), before the write:

| Condition | Action | Counter |
|---|---|---|
| `bufferedAmount ≤ WS_SOFT_LIMIT_BYTES` | Send the batch (if non-empty); advance `cursor` to the highest `rev` sent | `ws.frames.sent` |
| `bufferedAmount > WS_SOFT_LIMIT_BYTES` | **Skip** the batch; **do not advance `cursor`** | `ws.frames.skipped` |
| Above the soft limit on every tick for `SLOW_CLIENT_MAX_STALL_MS`, **or** `bufferedAmount > WS_HARD_LIMIT_BYTES` at any check | Close with `4008` `"slow consumer"`; log once | `ws.clients.evicted` |

| Parameter | Default | Notes |
|---|---|---|
| `WS_SOFT_LIMIT_BYTES` | `1048576` (1 MiB) | Env. Defaults chosen here, tuned in the stress test, never presented as measured |
| `WS_HARD_LIMIT_BYTES` | `8388608` (8 MiB) | Env. Only ungated messages can push the buffer this far; this limit is their backstop |
| `SLOW_CLIENT_MAX_STALL_MS` | set during implementation (story 6) | Env. The stall timer starts on the first tick seen above soft and resets on any tick seen at or below soft |

- **The stall budget is time, not ticks.** A 10 ms client and a 1000 ms client get the same
  tolerance, independent of the slider (ADR-005).
- **Losslessness.** Each message carries complete current snapshots, not deltas, and the cursor
  advances only on a successful write. So a skip loses nothing from the client's point of view:
  the client gets the newer value one tick later. **Advancing the cursor on a skipped frame is a
  defect**; it would lose a value until the pair next changes (AGENTS.md, ADR-003).
- **Recovery after eviction.** An evicted client reconnects and receives a fresh `market.snapshot`
  as the first message of its new connection.
- **Memory bound (user space, per client):** `max(soft + largest batch, hard) + largest ungated message`.
  Kernel socket buffers are outside this bound. No per-client queue exists anywhere (ADR-003).
- **Scope.** The gate sees only clients that are slow on the **network**. React Native drains its
  socket without flow control, so a slow JS thread never shows up in `bufferedAmount`; the device
  handles that by coalescing per display frame (ADR-009).

**Testable assertions** (protocol and integration tests):

1. With `bufferedAmount` above soft, a tick sends no batch, `cursor` is unchanged, and `ws.frames.skipped` increments.
2. The value that changed during the skipped tick arrives on the first tick after the buffer drops to or below soft.
3. A client above soft for `SLOW_CLIENT_MAX_STALL_MS` is closed with `4008`, and `ws.clients.evicted` increments.
4. A client above hard at any check is closed with `4008`.
5. A healthy client's message rate is not reduced while another client is stalled (asserted in the stress test).

## 6. Timestamps and "Last Updated" provenance

The Binance partial-depth stream (`<symbol>@depth20@100ms`) carries only `lastUpdateId`, `bids`
and `asks`: **no event time and no symbol**. Two consequences:

1. The pair comes from the combined-stream wrapper's `stream` name, the only in-band attribution
   for a depth frame (ADR-001).
2. Depth-only changes have no upstream timestamp. So:

> **`timestamp` (the UI's "Last Updated") is the server's receive time of the most recent upstream
> event that mutated this pair, whichever stream produced it.** Precisely:
> `lastDepthAt` and `lastTickerAt` are the server receive times of each stream's latest applied
> event, and `timestamp = max(lastDepthAt, lastTickerAt)`.

- It is **not exchange time**. It includes network latency and server-clock skew (ADR-007).
- Ticker `E` is not used. It arrives about once per second, freezes while depth keeps changing, and
  does not exist for the simulator.
- Clients never compare the device clock with server time. Display age is
  `(Date.now() − localReceiveAt) + (t − timestamp)`, where `localReceiveAt` is the device time the
  message arrived and `t` is the envelope time.

## 7. Numeric and edge-case rules

- **Strings to numbers once.** Binance sends every price and quantity as a string. The adapter
  converts them once. No Binance-shaped object crosses the adapter boundary.
- **JSON numbers are IEEE-754 doubles.** Prices round-trip exactly. Long volumes can lose trailing
  digits. Clients format for display with `pricePrecision` / `quantityPrecision` from
  `/pairs/meta`, and math tests use tolerances.
- **Integers:** `v`, `t`, `rev`, `timestamp`, `lastDepthAt`, `lastTickerAt`, `since`, `serverTime`,
  `intervalMs`, `heartbeatMs`.
- **`spread`** with an empty side is `null`, **never `0`**. A zero spread is a meaningful and false
  market claim. The UI renders `—`. `spread` is not rounded on the server.
- **Buy/sell pressure is an application-derived visualization metric, not a Binance metric and not a
  market-wide measure.** Definition (ADR-007):

  ```
  levels       = first DISPLAY_LEVELS (10) of each side, or fewer if the side is shorter
  buyPressure  = round2(100 × Σ bid.qty / (Σ bid.qty + Σ ask.qty))
  sellPressure = round2(100 − buyPressure)
  round2(x)    = Math.round(x × 100) / 100
  ```

  - If either side is empty, both are `null`, **never `50`**, rendered `—`.
  - Rounding to 2 decimals happens on the server, so the client does not re-render on float noise.
  - Range `0..100`. `buyPressure + sellPressure = 100` within floating-point tolerance.
- **`change24hPct`** is Binance `P` passed through, not recomputed. It is a percent and may be negative.
- **`volume24h`** is quote-asset volume (`q`), not base volume (`v`).
- **Per-pair precision.** DOGE and XRP need more decimals than BTC. The wire does not round prices;
  display precision comes from `/pairs/meta` (`rest-api.md`).

## 8. Liveness and heartbeat

Mobile sockets go half-open when Android dozes or the network changes, and neither side gets a
close event. Both ends detect it.

| Mechanism | Side | Rule |
|---|---|---|
| Status heartbeat | server → client | `market.status` every `heartbeatMs`. Default `DEFAULT_HEARTBEAT_MS = 5000` (contracts constant); the value in use is in every status |
| Dead-man timer | client | No message of **any** type for `3 × heartbeatMs` (from the latest `market.status`, the contract default before the first) ⇒ the socket is dead; enter reconnect (ADR-008) |
| Protocol ping | server | A WebSocket ping frame every **15 s**. No pong within **30 s** of the last pong (or of `open`) ⇒ `terminate()`, counted in `ws.clients.timedOut` (ADR-008) |

- The heartbeat feeds the client's dead-man timer even in a completely still market. That is what
  makes "no data" distinguishable from "no connection".
- Pings are protocol control frames, not JSON messages. They do not pass through the backpressure
  gate and never touch `cursor`. React Native's native WebSocket answers pings automatically; this
  is to be confirmed in the manual resilience run.
- A client that stops reading also stops answering pings. Whichever of the ping timeout (30 s) and
  the stall eviction (`SLOW_CLIENT_MAX_STALL_MS`) comes first closes it. Both bound memory.

## 9. Examples

These examples assume a server started with `PAIRS=BTCUSDT,ETHUSDT`, so the snapshot is complete
with two entries. The books are shortened to three and two levels per side (the schema allows
`0..20`). Every derived value is computed from the levels shown. Each example must parse
(contract tests).

**9.1 `market.snapshot`**: BTC has data, ETH has none yet.

```json
{
  "v": 1,
  "type": "market.snapshot",
  "t": 1789765834100,
  "pairs": [
    {
      "pair": "BTCUSDT",
      "rev": 42,
      "timestamp": 1789765834020,
      "lastDepthAt": 1789765834020,
      "lastTickerAt": 1789765833510,
      "price": 81199.71,
      "change24hPct": 6.133,
      "high24h": 81400,
      "low24h": 76259.98,
      "volume24h": 1843456789.12,
      "bids": [[81199.5, 1.2], [81199.25, 0.8], [81199, 2]],
      "asks": [[81200.25, 0.5], [81200.5, 1.5], [81201, 1]],
      "spread": 0.75,
      "buyPressure": 57.14,
      "sellPressure": 42.86
    },
    {
      "pair": "ETHUSDT",
      "rev": 0,
      "timestamp": null,
      "lastDepthAt": null,
      "lastTickerAt": null,
      "price": null,
      "change24hPct": null,
      "high24h": null,
      "low24h": null,
      "volume24h": null,
      "bids": [],
      "asks": [],
      "spread": null,
      "buyPressure": null,
      "sellPressure": null
    }
  ]
}
```

**9.2 `market.status`**: sent right after the snapshot. ETH is stale because it has never had a depth update.

```json
{
  "v": 1,
  "type": "market.status",
  "t": 1789765834101,
  "source": "binance",
  "upstream": { "connected": true, "since": 1789765800000 },
  "stalePairs": ["ETHUSDT"],
  "intervalMs": 100,
  "heartbeatMs": 5000,
  "serverTime": 1789765834101
}
```

**9.3 `market.batch`**: ETH's first depth frame (no ticker yet) and a new BTC book.

```json
{
  "v": 1,
  "type": "market.batch",
  "t": 1789765834200,
  "pairs": [
    {
      "pair": "ETHUSDT",
      "rev": 43,
      "timestamp": 1789765834150,
      "lastDepthAt": 1789765834150,
      "lastTickerAt": null,
      "price": null,
      "change24hPct": null,
      "high24h": null,
      "low24h": null,
      "volume24h": null,
      "bids": [[2500.5, 3.25], [2500.25, 1.75]],
      "asks": [[2500.75, 2], [2501, 4]],
      "spread": 0.25,
      "buyPressure": 45.45,
      "sellPressure": 54.55
    },
    {
      "pair": "BTCUSDT",
      "rev": 44,
      "timestamp": 1789765834180,
      "lastDepthAt": 1789765834180,
      "lastTickerAt": 1789765833510,
      "price": 81199.71,
      "change24hPct": 6.133,
      "high24h": 81400,
      "low24h": 76259.98,
      "volume24h": 1843456789.12,
      "bids": [[81199.5, 1.5], [81199.25, 0.8], [81199, 2]],
      "asks": [[81200.25, 0.5], [81200.5, 1.5], [81201, 1]],
      "spread": 0.75,
      "buyPressure": 58.9,
      "sellPressure": 41.1
    }
  ]
}
```

**9.4 `client.setInterval`** and its acknowledgement

```json
{ "v": 1, "type": "client.setInterval", "intervalMs": 250 }
```

```json
{
  "v": 1,
  "type": "market.status",
  "t": 1789765835003,
  "source": "binance",
  "upstream": { "connected": true, "since": 1789765800000 },
  "stalePairs": [],
  "intervalMs": 250,
  "heartbeatMs": 5000,
  "serverTime": 1789765835003
}
```

**9.5 `error`**

```json
{ "v": 1, "type": "error", "t": 1789765835010, "code": "BAD_REQUEST", "message": "intervalMs must be an integer between 10 and 1000" }
```

**9.6 Upstream lost**: downstream stays open, every pair is stale, last values stay on screen.

```json
{
  "v": 1,
  "type": "market.status",
  "t": 1789765900000,
  "source": "binance",
  "upstream": { "connected": false, "since": 1789765899120 },
  "stalePairs": ["BTCUSDT", "ETHUSDT"],
  "intervalMs": 250,
  "heartbeatMs": 5000,
  "serverTime": 1789765900000
}
```

## 10. Invalid cases (the schemas must reject)

| Case | Example fragment |
|---|---|
| `client.setInterval` out of range | `"intervalMs": 5`, `"intervalMs": 1001` |
| `client.setInterval` not an integer | `"intervalMs": 250.5`, `"intervalMs": "250"`, field missing |
| Unknown message `type` | `"type": "client.subscribe"` |
| Lower-case or empty pair | `"pair": "btcusdt"`, `"pair": ""` |
| More than 20 levels on a side | `bids` with 21 entries |
| Malformed level | `[81199.5]`, `[81199.5, 1.2, 0]`, `{ "p": 81199.5, "q": 1.2 }`, `[0, 1]`, `[81199.5, -1]` |
| Nullable field omitted | a `PairSnapshot` with no `spread` key |
| Pressure out of range | `"buyPressure": 100.5`, `"buyPressure": -1` |
| Non-integer time or `rev` | `"timestamp": 1789765834020.5`, `"rev": -1` |
| `market.batch` with no pairs | `"pairs": []` |
| Unknown `source` | `"source": "coinbase"` |
| Unknown error code | `"code": "RATE_LIMITED"` |

`v ≠ 1` is not a schema rejection on the client. The envelope decode reports it, and the socket
moves to `INCOMPATIBLE`. On the server, a client message with `v ≠ 1` is answered with `error BAD_REQUEST`.

## 11. Deviations from engineering guide §6

The accepted ADRs and the SPEC take precedence over the guide (decision recorded 2026-09-19).
Each difference is deliberate.

| Guide §6 | This contract | Reason |
|---|---|---|
| Type name `MarketSnapshot` | `PairSnapshot` | ADR-006; the skeleton's `MarketSnapshot` was replaced |
| `lastUpdated` | `timestamp`, plus `lastDepthAt` and `lastTickerAt` | Same meaning (§6). Staleness needs `lastDepthAt` alone, and the client apply rule needs each group's time (ADR-007) |
| Level `{ p, q }` | `[price, qty]` tuple | ADR-006; no repeated key names in every level of a 10 Hz full-book stream (frame size to be measured in the stress test) |
| `price`, `change24hPct` never null | Nullable until the first ticker | The snapshot is sent on connect, before every pair has data (ADR-004) |
| `high24h`, `low24h`, `volume24h` only in `/pairs/meta` | Also in `PairSnapshot` | The UI reads live values from one source; meta reads the same map (architecture §3, §6) |
| `depthUpdateId` (Binance `lastUpdateId`) | Not on the wire | A provider-specific field with no simulator equivalent; debugging stays inside the adapter |
| No `rev` | `rev` | The cursor and the client's per-connection ordering depend on it (ADR-003) |
| Batch key `updates` | `pairs` | One reducer shape for snapshot and batch (ADR-006) |
| Snapshot deletes pairs it does not contain | Pairs are never deleted | Keeps last data visible across a backend restart (CAP-13, architecture §6) |
| Status sent **before** the snapshot | Snapshot first, then status | ADR-004. Either order gives the client both messages before the first batch |
| Status `upstream{connected, connectedSince, lastEventAt, reconnectAttempts, source}` + `client{intervalMs, skippedFrames}` | `source`, `upstream{connected, since}`, `stalePairs`, `intervalMs`, `heartbeatMs`, `serverTime` | ADR-006. Per-pair staleness needs `stalePairs`. The client dead-man timer needs `heartbeatMs`. Counts, including skips, are on `/health` |
| Per-client `skippedFrames` | Global `ws.frames.skipped` on `/health` | Not adopted (decision 2026-09-19). A changing counter in status would break the "equal status → no commit" rule |
| Heartbeat fixed at 5 s; client dead after 10 s | `heartbeatMs` (default 5000) carried in status; client dead after `3 × heartbeatMs` | ADR-008. One missed heartbeat is not treated as death |
| `client.setInterval` range 50–2000 ms | 10–1000 ms | SPEC CAP-15 fixes the slider at 10–1000 ms (ADR-004) |
| Rate limit one change/s; excess silently ignored | No rate limit | The slider sends on release only. A silent drop would leave the UI showing an interval the server did not apply |
| Client messages carry `t` | `t` optional and ignored | The server never trusts the device clock |
| Pressure over the top 20 levels | Over the 10 displayed levels | ADR-007. The number must agree with the book the user sees (decision 2026-09-19) |
| Pressure `null` only when total depth is zero | `null` when **either** side is empty | ADR-007. A one-sided book would give 0 or 100, which is also a false claim |
| Slow consumer: close `1013` after `bufferedAmount > HARD` for 10 consecutive ticks | ADR-005: close `4008` after `SLOW_CLIENT_MAX_STALL_MS` above soft, or above hard at once | Batches are gated at the soft limit, so batches alone cannot push the buffer past about `soft + one batch`. The guide's hard-limit rule would therefore be reached only through the ungated backlog, which is effectively never. A tick-counted budget also varies with the client's slider (decision 2026-09-19) |
| Justification for the combined stream "in ADR-003" | ADR-001 | ADR numbering in this repo |

Adopted from the guide on 2026-09-19, and recorded as ADR amendments: the 15 s / 30 s server
ping (ADR-008), 2-decimal pressure rounding (ADR-007), the 5 s default heartbeat, and
`pricePrecision` / `quantityPrecision` in `/pairs/meta` (ADR-006).

## 12. Validation placement

| Boundary | Validation |
|---|---|
| Server, every upstream frame | Full Zod parse, always. A bad frame is dropped and counted (`upstream.frames.invalid`) |
| Server, every client message | Full Zod parse, always |
| Client, production | Envelope only (`v`, `type`, `t`) through `decodeServerMessage`, the one permitted cast (AGENTS.md) |
| Client, `__DEV__` | Full schema parse of every message; a failure is logged once per type and the message dropped |

Full validation of every 100 ms batch on the device costs measurable CPU on an emulator, the exact
axis being evaluated. `__DEV__` keeps contract drift visible without paying that cost in release
(engineering-standards §6).
