# ADR-001: One combined Binance stream for all pairs

## Context

The gateway ingests order book and ticker data for five pairs (CAP-1). The spike on 2026-09-19
showed that a `depth20@100ms` frame carries only `lastUpdateId`, `bids` and `asks`: **no symbol
and no event time**. On a raw per-stream socket the frame identifies its pair only through
the socket it arrived on, and that link is easy to lose in shared handler code.

## Decision

Open **one** connection to `/stream?streams=<pair>@depth20@100ms/<pair>@ticker/...` (10 streams for
5 pairs). Every message arrives as `{ stream, data }`. The adapter derives the pair from `stream`
(`btcusdt@depth20@100ms` → `BTCUSDT`) and parses the wrapper and the payload with Zod.

The reason is **correctness, not connection count**: the wrapper is the only in-band field that
attributes a depth frame to a pair. The connection count is a side benefit.

## Alternatives considered

| Option | Rejected because |
|---|---|
| One raw socket per stream (10 sockets) | Pair attribution depends on closure/socket identity, not data; 10 lifecycles to supervise |
| One raw socket per pair, 2 streams each | Raw multi-stream sockets drop the wrapper on non-combined endpoints; attribution again out-of-band |
| Infer pair from price magnitude | Unsound; prices overlap across pairs over time |

## Consequences

- **Trade-offs:** one socket is a single failure domain; losing it stales all five pairs at once.
  For five pairs from one provider that matches reality, since the pairs share network and host anyway.
- **Failure modes:** a malformed wrapper or unknown stream name is dropped and counted
  (`upstream.frames.invalid`). A whole-socket drop is handled by ADR-008.
- **Migration:** Binance allows up to 1024 streams per connection, so adding pairs is a `PAIRS` config
  change. Beyond that, shard pairs across N combined connections behind the same adapter.

## Status

Accepted (adopted, settled before this document). Requirements: CAP-1, CAP-4, NFR-5.
