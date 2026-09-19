# ADR-011: MarketDataSource abstraction — Binance and simulator

## Context

Stress testing needs 1000+ events/s, deterministic and offline (testing-strategy); CI cannot
reach Binance; `stream.binance.com` returns HTTP 451 to US IPs. Domain code must never see a
provider payload (engineering-standards §3).

## Decision

```ts
interface MarketDataSource {
  readonly kind: 'binance' | 'simulator';
  start(sink: MarketEventSink): void;
  stop(): Promise<void>;
}
type MarketEvent = DepthUpdate | TickerUpdate | SourceStatusChange;
```

- `BinanceMarketDataAdapter` (ADR-001/002) and `SimulatorMarketDataSource` both emit only domain
  `MarketEvent`s. ESLint forbids `domain/` and `application/` from importing either.
- **Status contract:** every source emits `SourceStatusChange{connected:true}` before its first
  data event and `{connected:false}` on any loss. The simulator emits `connected:true` on start.
  The status monitor derives `upstream.connected` only from these events.
- **Selection:** `MARKET_SOURCE=binance|simulator` at startup (default `binance`), resolved in the
  composition root. `SIMULATOR_RATE` = total events/s, split evenly across pairs, with at least one depth event per pair per 100 ms. No runtime switching.
- **No automatic fallback.** If Binance is unreachable, the server stays upstream-disconnected and
  keeps reconnecting (ADR-008). Silently substituting synthetic prices would misreport the market.
- **Visibility:** the active source is in `market.status.source` and `GET /health`. The app shows
  a `SIMULATED` chip whenever `source ≠ binance`.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Auto-fallback to simulator | Users could see fake prices labelled live; hides a real outage |
| Mock at the socket level (fake Binance server) | Tests the adapter, not the pipeline, and cannot easily hit 1000+/s |
| Simulator-only in dev | The real-feed path would be under-exercised |

## Consequences

- **Trade-offs:** an operator must restart to switch source; acceptable for a local assignment.
- **Failure modes:** a simulator drifting from Binance semantics. Mitigated because both emit the same
  Zod-validated domain events and the simulator reuses the normalization tests.
- **Migration:** additional exchanges become further adapters; a multi-source merge would need its own ADR.

## Status

Accepted. Referenced by testing-strategy.md (stress and CI). Requirements: CAP-1, CAP-6, NFR-1, NFR-7.
