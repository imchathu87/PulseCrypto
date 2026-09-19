# Binance Feed — Verified Facts

Facts observed live on 2026-09-19 (walking-skeleton spike) or from Binance's public stream rules. Architecture decides how to use them.

## Endpoint and combined streams

- Combined stream URL: `wss://stream.binance.com:9443/stream?streams=<s1>/<s2>/...` (stream names lowercase, e.g. `btcusdt@depth20@100ms`).
- Default host `wss://stream.binance.com:9443`, overridable through `BINANCE_WS_URL` (architecture §9). `wss://data-stream.binance.vision` is the market-data-only alternative for reviewers that get HTTP 451; the backend logs a 451 with this hint (ADR-008).
- Every combined-stream message is wrapped as `{ "stream": "<name>", "data": { ... } }`.

## Stream payloads observed

| Stream | `data` keys | Notes |
|---|---|---|
| `btcusdt@depth20@100ms` (partial book, top 20) | `lastUpdateId`, `bids`, `asks` | **No symbol, no event time.** `bids`/`asks` are `[priceString, qtyString][]`, best price first. Pair must be derived from `stream`. |
| `btcusdt@ticker` (24h rolling, ~1s) | `e`, `E`, `s`, `p`, `P`, `w`, `x`, `c`, `Q`, `b`, `B`, `a`, `A`, `o`, `h`, `l`, `v`, `q`, `O`, `C`, `F`, `L`, `n` | `e`="24hrTicker", `E`=event time (ms), `s`=symbol, `c`=last price, `P`=24h change %, `h`/`l`=24h high/low, `v`=base volume, `q`=quote volume. |

Sample depth: `{"lastUpdateId":100324344395,"bids":[["81199.71000000","1.20623000"],...],"asks":[["81199.72000000","3.55133000"],...]}`

Sample ticker: `{"e":"24hrTicker","E":1789765834016,"s":"BTCUSDT","c":"81199.71000000","P":"6.133","h":"81400.00000000","l":"76259.98000000","v":"23121.08288000",...}`

## Behavioural facts

- All prices and quantities are **strings**; precision differs sharply per pair (BTC ≈ 81,000; DOGE ≈ 0.1).
- Ticker emits about once per second; depth20@100ms emits about 10/s per pair. With 5 pairs, upstream is about 55 msgs/s.
- Binance closes each connection after 24h; the server pings every 20s and disconnects if no pong arrives within about 1 min.
- `stream.binance.com` returns HTTP 451 for US-located IPs.
- A single connection supports up to 1024 streams; 5 pairs × 2 streams = 10.
- Brief's example `timestamp` (`1720802025`) is in seconds; Binance `E` is in milliseconds.
