# ADR-002: Partial top-20 depth, not diff-depth reconciliation

## Context

The UI shows 10 levels per side plus a depth visual (CAP-10, figma-scope). Binance offers two
book feeds: `depth20@100ms` (a complete top-20 book each frame) and `depth@100ms` diffs that must
be merged onto a REST snapshot with `U`/`u` sequence checks.

## Decision

Subscribe to `<pair>@depth20@100ms`. Each frame **replaces** the pair's book outright. No local
order book, no REST snapshot, no sequence reconciliation.

The system needs *current top-of-book state*, not an exact full book. A replacing snapshot is
self-correcting: a dropped or malformed frame is repaired by the next one about 100 ms later, by
the stream's definition.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Diff depth + REST snapshot sync | Gap detection, resync, a REST dependency and unbounded-depth maps, all to show 10 levels |
| `depth5` / `depth10` | Too shallow for the depth visual; no saving worth the loss |
| `bookTicker` only | Best bid/ask only; cannot draw a book |

## Consequences

- **Trade-offs:** capped at 20 levels per side; the book cannot show deeper liquidity. Cadence
  is capped at Binance's 100 ms partial-depth rate, which matches the default emit interval.
- **Failure modes:** a crossed or mis-ordered frame is dropped and counted (architecture §3); the
  book is at most one frame stale. No resync storm is possible because there is no sync.
- **Migration:** full depth would add an order-book component *inside the adapter* that still
  emits the same `DepthUpdate`. The domain and the wire contract are unchanged.

## Status

Accepted (adopted). Requirements: CAP-1, CAP-10, NFR-4.
