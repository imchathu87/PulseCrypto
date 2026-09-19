# ADR-007: Derived values on the server; timestamp from the server receive clock

## Context

Market details need spread, buy/sell pressure, 24h change and a last-updated time (CAP-7,
CAP-10). Two questions were open: where to compute the derived values, and where `timestamp`
comes from, given that the depth stream has no event time and the ticker's `E` arrives about once
per second.

## Decision

**Derived values, server, in pure domain functions:**

- `spread = bestAsk − bestBid`; `null` if either side is empty.
- `buyPressure = 100 × Σ bidQty / (Σ bidQty + Σ askQty)` over the **10 displayed levels** per
  side (spec assumption), rounded to 2 decimals on the server; `sellPressure = round2(100 − buyPressure)`;
  both `null` when a side is empty. Rounding stops float noise from causing client commits.
- `change24hPct` = ticker `P`, passed through, not recomputed.
- `volume24h` = quote volume (`q`). `DISPLAY_LEVELS = 10` is a contracts constant, shared with the book UI.
- The client computes only presentation: TOTAL = cumulative quantity; bar width = cumulative qty ÷
  max cumulative qty over both displayed sides; liquidity gap % = `spread / mid × 100`; the pressure
  label comes from `buyPressure` (≥ 55 Buy Heavy, ≤ 45 Sell Heavy, else Balanced).

Why server: the brief's own payload puts `spread`/`buyPressure`/`sellPressure` in the message;
the math runs once per mutation instead of once per client per render; and the spec requires unit
tests of this math in backend processing.

**Timestamps:** `lastDepthAt` and `lastTickerAt` = server receive time (ms epoch) of each stream;
`timestamp` = the later of the two. Staleness uses `lastDepthAt` only.

| Source | Consequence |
|---|---|
| Ticker `E` | Up to ~1 s behind the book it labels; freezes while depth keeps flowing; absent in the simulator |
| **Server receive clock (chosen)** | Moves with every book change; same semantics for Binance and the simulator; one server clock for timestamps and staleness |

## Alternatives considered

Client-side derivation (N clients × renders, math tested twice, logic duplicated); computing
pressure over 20 levels (disagrees with what the user sees); `E` as the timestamp (above).

## Consequences

- **Trade-offs:** `timestamp` includes network latency and server-clock skew, so it is not exchange
  time. The UI shows "last updated" and computes age as `(now − localReceiveAt) + (t − timestamp)`,
  never comparing the device clock with server time.
- **Failure modes:** empty side → `null`, rendered as `—` (never `0` or `50`; testing-strategy).
- **Migration:** exchange time can be added later as an optional `sourceTime` field without
  changing `timestamp` semantics.

## Status

Accepted. Amended 2026-09-19 (human-approved): 2-decimal pressure rounding, adopted from engineering
guide §6.9. Requirements: CAP-7, CAP-10, NFR-7.
