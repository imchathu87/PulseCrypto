# REST API

Status: accepted · 2026-09-19 · Story 2 (contract), Story 7 (endpoints) · CAP-5, CAP-14, NFR-6

The HTTP endpoints served by `apps/api`. The Zod schemas in `packages/contracts` (`rest` module),
this document and the contract tests change together, in one change (AGENTS.md). Decisions come
from ADR-006 (shapes), ADR-007 (values) and architecture §3 and §8. The live market stream is in
[`websocket-protocol.md`](websocket-protocol.md).

## 1. Conventions

| Property | Value |
|---|---|
| Base URL | `http://<host>:<port>`, the same origin as `/ws`. The app reads it from `EXPO_PUBLIC_API_URL` (default `http://10.0.2.2:8080` on Android, `http://localhost:8080` on iOS) |
| Format | `application/json`, UTF-8 |
| Auth | None |
| Times | Integer epoch milliseconds on the server clock, as on the socket |
| Numbers | JSON numbers, converted from Binance strings once at the adapter |
| Compatibility | Additive fields are non-breaking; clients parse with Zod's default `.strip()` and ignore unknown keys |

## 2. `GET /pairs/meta`

Returns metadata for every supported pair (CAP-5). The app uses it for display names, trading
status and per-pair number formatting. Pull-to-refresh re-fetches it without touching the live
socket (CAP-14).

### Response `200`

```ts
type PairsMetaResponse = {
  pairs: PairMeta[];               // exactly one entry per configured pair (PAIRS)
};

type PairMeta = {
  pair: string;                    // /^[A-Z0-9]+$/; the same identity key as PairSnapshot.pair
  displayName: string;             // e.g. "BTC / USDT"
  tradingStatus: 'TRADING' | 'HALTED';
  high24h: number | null;          // Binance `h`; null before the pair's first ticker
  low24h: number | null;           // Binance `l`; null before the pair's first ticker
  volume24h: number | null;        // 24h QUOTE-asset volume (Binance `q`); null before the first ticker
  pricePrecision: number;          // integer 0..8: decimal places for displaying prices and spread
  quantityPrecision: number;       // integer 0..8: decimal places for displaying order-book quantities
};
```

### Field sources

| Field | Source | Notes |
|---|---|---|
| `pair` | `PAIRS` env | Startup fails if a configured pair has no static meta entry (architecture §3) |
| `displayName`, `tradingStatus` | Static server config | The brief allows metadata to be mocked. `tradingStatus` is not live exchange status |
| `pricePrecision`, `quantityPrecision` | Static server config | Next to `displayName`. No request to Binance `exchangeInfo`; no REST dependency on the exchange |
| `high24h`, `low24h`, `volume24h` | Latest-value map at request time | The same values the socket carries. The UI shows live 24h stats from the socket (architecture §6); these fields exist here because the assignment lists them |

`change24hPct` is **not** in this response, by decision: the assignment's metadata list does not
include a 24h change, and the watchlist needs it live, so it travels over WebSocket
(`websocket-protocol.md` §3).

### Precision rules

DOGE and XRP need more decimals than BTC. Without per-pair precision, DOGE at 0.1 renders as `0.10`
and looks broken.

- `pricePrecision` formats `price`, `high24h`, `low24h`, order-book prices and `spread`.
- `quantityPrecision` formats order-book quantities and cumulative totals.
- Precision is **display-only**. The server never rounds prices or quantities on the wire.
  (It rounds only the derived pressure percentages, to 2 dp: ADR-007.)
- Percentages (`change24hPct`, pressures) are formatted with 2 decimals and do not use these fields.
- If meta is not loaded yet, or has no entry for a pair, the app falls back to the raw `pair` id
  and a default of 2 price decimals / 4 quantity decimals. Prices keep updating either way.

The config values follow Binance's `tickSize` / `stepSize` per symbol. The values in the example
below are illustrative. Story 7 sets the real config values and checks them against Binance
`exchangeInfo` once, by hand.

### Example

```json
{
  "pairs": [
    { "pair": "BTCUSDT",  "displayName": "BTC / USDT",  "tradingStatus": "TRADING", "high24h": 81400,   "low24h": 76259.98, "volume24h": 1843456789.12, "pricePrecision": 2, "quantityPrecision": 5 },
    { "pair": "ETHUSDT",  "displayName": "ETH / USDT",  "tradingStatus": "TRADING", "high24h": 2612.4,  "low24h": 2455.1,   "volume24h": 912345678.9,   "pricePrecision": 2, "quantityPrecision": 4 },
    { "pair": "SOLUSDT",  "displayName": "SOL / USDT",  "tradingStatus": "TRADING", "high24h": null,    "low24h": null,     "volume24h": null,          "pricePrecision": 2, "quantityPrecision": 3 },
    { "pair": "DOGEUSDT", "displayName": "DOGE / USDT", "tradingStatus": "TRADING", "high24h": 0.10912, "low24h": 0.10133,  "volume24h": 145678901.5,   "pricePrecision": 5, "quantityPrecision": 0 },
    { "pair": "XRPUSDT",  "displayName": "XRP / USDT",  "tradingStatus": "HALTED",  "high24h": 0.5321,  "low24h": 0.5102,   "volume24h": 87654321.25,   "pricePrecision": 4, "quantityPrecision": 1 }
  ]
}
```

SOL shows the state before the first ticker: nullable stats are `null`, never omitted. XRP shows
the mocked `HALTED` status; nothing in the live pipeline changes because of it.

### Invalid cases (the schema must reject)

| Case | Example fragment |
|---|---|
| Unknown trading status | `"tradingStatus": "BREAK"` |
| Non-integer or out-of-range precision | `"pricePrecision": 2.5`, `"pricePrecision": -1`, `"quantityPrecision": 9` |
| Nullable stat omitted | an entry with no `high24h` key |
| Lower-case pair | `"pair": "btcusdt"` |
| Missing `pairs` wrapper | a bare array at the top level |

### Client behaviour

- Owned by TanStack Query under key `['pairs','meta']`. Meta only **decorates** rows; the watchlist
  row set is the key set of `marketStore.pairs` from the socket (architecture §6, ADR-009).
- Pull-to-refresh calls `refetch()` and never closes, reopens or pauses the WebSocket.
- A failed request keeps the cached meta. With no cache, rows show raw ids, and prices are unaffected.
- The response is fully Zod-parsed on the device, always. It arrives once per refresh, so the
  `__DEV__`-only exception for socket messages does not apply (AGENTS.md: validate REST responses).

## 3. `GET /health`

An operational endpoint for people, the stress test and integration tests. The app does not call it.

- Returns **`200` whenever the process serves HTTP**, including while upstream is disconnected.
  It reports process liveness, not market readiness. Upstream health is in the body.
- **Read-only.** Reading it never resets a counter or a histogram.
- Hot paths only increment counters; this endpoint is the only reader (ADR-010).

### Response `200`

```ts
type HealthResponse = {
  status: 'ok';
  source: 'binance' | 'simulator';
  upstream: {
    connected: boolean;               // same derivation as market.status.upstream.connected
    since: number | null;             // time `connected` last changed value; null before the first change
  };
  uptimeMs: number;                   // integer, since process start
  serverTime: number;                 // integer epoch ms
  counters: {
    'upstream.frames.received': number;
    'upstream.frames.invalid': number;   // dropped by the adapter's Zod parse or book check
    'upstream.connect.failed': number;
    'upstream.reconnects': number;
    'buffer.mutations': number;
    'ws.frames.sent': number;            // market.batch frames written
    'ws.frames.skipped': number;         // market.batch frames skipped by backpressure
    'ws.clients.active': number;         // gauge: currently open sessions
    'ws.clients.evicted': number;        // closed with 4008 (slow consumer)
    'ws.clients.timedOut': number;       // terminated after ping timeout
  };
  eventLoopDelayMs: {                 // perf_hooks.monitorEventLoopDelay, cumulative since start
    mean: number;
    p50: number;
    p99: number;
    max: number;
  };
};
```

Counter names are exactly those in architecture §8. Every counter except the `ws.clients.active`
gauge is a non-negative integer that only increases during one process lifetime. New counters may
be added without a version change.

### Example

```json
{
  "status": "ok",
  "source": "binance",
  "upstream": { "connected": true, "since": 1789765800000 },
  "uptimeMs": 34101,
  "serverTime": 1789765834101,
  "counters": {
    "upstream.frames.received": 1873,
    "upstream.frames.invalid": 0,
    "upstream.connect.failed": 0,
    "upstream.reconnects": 0,
    "buffer.mutations": 1873,
    "ws.frames.sent": 311,
    "ws.frames.skipped": 0,
    "ws.clients.active": 1,
    "ws.clients.evicted": 0,
    "ws.clients.timedOut": 0
  },
  "eventLoopDelayMs": { "mean": 10.4, "p50": 10.2, "p99": 12.9, "max": 18.3 }
}
```

The numbers above are **illustrative shape only, not measurements**. Measured figures appear only
in `docs/verification/` (testing-strategy.md).

## 4. Errors

Neither endpoint takes parameters or a body, so there is no client-error case to document.
Unknown routes return Fastify's default `404`. An unexpected server failure returns Fastify's
default `500` error body. Clients treat any non-`200` as a failed request, and nothing else
depends on its body.
