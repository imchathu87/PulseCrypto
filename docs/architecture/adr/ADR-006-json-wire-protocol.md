# ADR-006: JSON wire protocol with shared Zod contracts

## Context

The brief requires a documented payload that identifies its pair (CAP-4) and `/pairs/meta`
(CAP-5). The API and the mobile app must not drift. ADR-004 caps traffic at one message per client
per interval.

## Decision

- **JSON text frames**, envelope `{ v: 1, type, t }`, where `t` is server send time. Every wire time is an integer ms epoch.
- Server → client:
  - `market.snapshot { pairs }`: all configured pairs
  - `market.batch { pairs }`: changed pairs only
  - `market.status { source, upstream: { connected, since }, stalePairs, intervalMs, heartbeatMs, serverTime }`
  - `error { code: 'BAD_REQUEST', message }`
- Client → server: `client.setInterval { intervalMs }`, an integer `10..1000`.
- `PairSnapshot`: `pair`, `rev`, `timestamp`, `lastDepthAt`, `lastTickerAt`, `price`,
  `change24hPct`, `high24h`, `low24h`, `volume24h` (quote), `bids`, `asks` (`[price, qty][]`, best
  first, `max(20)`), `spread`, `buyPressure`, `sellPressure`. Every field except `pair`, `rev`,
  `bids` and `asks` is nullable before first data. This covers the brief's example fields; the
  brief's `timestamp` is in seconds, ours is in ms, and the difference is documented.
- `rev` is meaningful only within one connection.
- `pair` is the only identity key, validated as `^[A-Z0-9]+$`. The pair list is server config, not an enum.
- `/pairs/meta` → `{ pairs: Array<{ pair, displayName, tradingStatus: 'TRADING' | 'HALTED', high24h, low24h, volume24h }> }`.
- Schemas use Zod's default `.strip()`. Additive fields are non-breaking and do not bump `v`.
- `packages/contracts` (Zod 4.6.5) holds the schemas, `DISPLAY_LEVELS = 10`, `MAX_LEVELS = 20`,
  the default heartbeat, and `decodeServerMessage(raw: unknown)`. The decoder is the **only** place
  a server message is typed without a full parse. It full-parses in `__DEV__` and envelope-parses
  in production (engineering-standards §6).
- `docs/contracts/websocket-protocol.md` is the single field reference, and the README links to it.
  Schema, document and tests change together.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Binary (protobuf, msgpack) | Harder to debug; parse cost not shown to matter (to be measured in the stress test); non-goal |
| JSON deltas | See ADR-004 |
| TS types without runtime schemas | Types vanish at runtime; boundaries require a parse (AGENTS.md) |
| Prices as strings on the wire | Prices round-trip as numbers; the brief's example uses numbers |
| `.strict()` schemas | Any additive server field would break a `__DEV__` client |

## Consequences

- **Trade-offs:** larger frames than binary; JSON parse on the JS thread (cost to be measured in the stress test).
- **Failure modes:** drift is caught by contract tests and the `__DEV__` parse. A `v` mismatch is
  shown as `INCOMPATIBLE` and not retried.
- **Migration:** `v` allows negotiating binary or delta encodings per connection later.

## Status

Accepted (JSON adopted; message set defined here). The production envelope-only decode is the
explicit exception recorded in AGENTS.md (approved 2026-09-19). Requirements: CAP-4, CAP-5, NFR-2, NFR-6.
