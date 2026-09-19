# ADR-010: Telemetry isolated from the market-data path

## Context

CAP-15 requires real JS FPS and WS msgs/s on screen; the stress test needs server counters.
Telemetry that re-renders on every message or logs in hot paths would distort the numbers it
reports and could slow the path it measures.

## Decision

- **Mobile:** a `requestAnimationFrame` loop increments a frame counter in a ref;
  `MarketSocket.onmessage` increments a message counter for `market.batch` and `market.snapshot` only. A 1 Hz timer reads-and-resets both and
  commits once to a separate `telemetryStore`. Only the Telemetry screen subscribes to it.
- **Server:** plain integer counters in the ingest, normalize and broadcast paths, plus
  `monitorEventLoopDelay`. They are exposed read-only via `GET /health`. No logging in hot paths.
- **One-way dependency:** market code may *increment* a counter and nothing else. No market path
  reads a counter, awaits telemetry, branches on it, or shares a store or timer with it.
- **Honesty:** a tile shows a measured value or is omitted. The memory tile appears only if Expo Go
  exposes a real Hermes heap reading.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Per-message store updates | Makes telemetry itself the render-churn source it is meant to expose |
| Telemetry fields inside `marketStore` | Every 1 Hz flush would notify market subscribers |
| Prometheus / OpenTelemetry exporter | Infrastructure beyond the scope boundaries for one process |
| Hot-path debug logging | Can dominate CPU at stress rates (engineering-standards §5) |

## Consequences

- **Trade-offs:** 1 Hz resolution; the rAF sampler measures JS-thread FPS, not UI-thread FPS.
  Sampler overhead is to be measured in the stress test.
- **Failure modes:** a throwing flush affects only `telemetryStore`; the market path does not call it.
- **Migration:** counters can be exported to a real metrics backend without touching the market path.

## Status

Accepted. Requirements: CAP-12, CAP-15, NFR-6, NFR-7.
