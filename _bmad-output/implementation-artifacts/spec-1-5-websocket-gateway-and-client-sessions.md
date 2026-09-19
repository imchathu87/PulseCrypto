---
title: 'Story 1.5: WebSocket gateway and client sessions'
type: 'feature'
created: '2026-09-19'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/architecture/adr/ADR-004-snapshot-broadcasting.md'
  - '{project-root}/docs/architecture/adr/ADR-008-connection-lifecycle.md'
  - '{project-root}/docs/architecture/adr/ADR-011-market-data-source.md'
  - '{project-root}/docs/contracts/websocket-protocol.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/api/src/server.ts` is still the walking skeleton: it opens Binance directly, broadcasts raw tickers to every client and ignores sources, the buffer, cadence and status. Clients need a snapshot on connect, then only changed pairs at their own interval, plus a status heartbeat that exposes staleness. Requirements: CAP-2, CAP-4, CAP-6, CAP-15 (server), CAP-17, NFR-4, NFR-5, NFR-6, AR-9, AR-17, AR-18, AR-20, AR-21, AR-24.

**Approach:** Add the `/ws` gateway (`presentation/`), a per-client `ClientSession` and an upstream-status tracker (`application/`), and `composition-root.ts`, which selects exactly one source from `MARKET_SOURCE` and wires source → buffer → sessions. `server.ts` becomes a thin entry point. `config.ts` gains `BROADCAST_INTERVAL_MS` and `STALE_AFTER_MS`.

## Boundaries & Constraints

**Always:**
- On connect, send `market.snapshot` (every configured pair once), then `market.status`. Set `cursor = buffer.currentRev` at snapshot time.
- Each tick sends `market.batch` with the pairs whose `rev > cursor`, then sets the cursor to the highest `rev` sent. An empty tick sends nothing.
- Each session has exactly one `setTimeout` chain. An accepted `client.setInterval` re-arms it to `min(new, remaining)` and immediately sends `market.status` as the ack.
- Upstream `connected`/`since` are derived only from `SourceStatusChange`. `since` is the `at` of the last value change and `null` before the first.
- `stalePairs` is the complete set from `domain/staleness.ts#isPairStale`.
- Status goes out on connect, on the first tick where the status content (everything except `t`/`serverTime`) differs from the last one sent, and on any tick where `now − lastStatusSentAt ≥ heartbeatMs` (`DEFAULT_HEARTBEAT_MS`).
- Each pair's JSON fragment is cached per `rev`, built lazily, and shared by every session.
- Inbound: binary frames, non-JSON, `v ≠ 1`, an unknown `type` and schema failures all get `error BAD_REQUEST`. The third rejection on a connection sends its `error`, then closes with `1008`. `maxPayload: 4096` makes `ws` close oversized frames with `1009`.
- One gateway-wide 15 s interval pings every socket and `terminate()`s any socket with no pong for ≥ 30 s since open or its last pong, incrementing `ws.clients.timedOut`.
- `ws.clients.active` goes +1 on connect and −1 on close. Close clears the session timer and removes the session.
- Connect and disconnect are logged at `info`. Ticks are never logged.
- `stop()` stops the source, clears the ping interval, closes every socket and closes Fastify.

**Agent decisions (minimal, recorded):**
1. Status change detection and the heartbeat both run on the session tick. This keeps one timer per session, and latency is ≤ `intervalMs` (≤ 1 s), within one heartbeat.
2. `STALE_AFTER_MS` defaults to `5000`. It is a positive integer, is a config default (not a measurement), and is below `UPSTREAM_SILENCE_MS`.
3. `BROADCAST_INTERVAL_MS` defaults to `100` and must be an integer from 10 to 1000.
4. `HOST`/`PORT` stay hard-coded as `0.0.0.0:8080` until Story 1.7.
5. `/health` keeps its current `{ ok: true }` body until Story 1.7.
6. No new dependencies.

**Never:**
- Implement the backpressure gate, `4008`, or `WS_*`/`SLOW_CLIENT_*` config. Those belong to Story 1.6.
- Implement `/pairs/meta`, a real `/health` body, `HOST`/`PORT` or event-loop delay. Those belong to Story 1.7.
- Queue messages per client.
- Map `PairState → PairSnapshot` outside `presentation/`.
- Import `infrastructure/` anywhere except `composition-root.ts`.
- Start or reference a simulator when the configured source is Binance.
- Change contracts, contract docs, `domain/` or the adapters.
- Log in the ingest, normalize or broadcast paths.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Connect before data | no events yet | snapshot with all pairs `rev:0`, nulls, `[]`; status `connected:false`, `since:null`, all pairs stale | N/A |
| Burst | 1000 events/s for 1 s at 100 ms | 10 batches, each pair at most once, no empty batch | N/A |
| Valid setInterval | `{v:1,type:'client.setInterval',intervalMs:250}` | immediate status `intervalMs:250`; next tick at `min(250, remaining)` | N/A |
| Rejected | `intervalMs` 5, 1001, 250.5 or `"250"`; missing field; unknown type; `v:2`; binary; `not json` | `error BAD_REQUEST`, interval unchanged | 3rd rejection → close `1008` |
| Oversize | inbound frame > 4 KiB | close `1009`, no `error` | handled by `ws` |
| Upstream lost | `status{connected:false}` | next status: `connected:false`, every pair stale; socket stays open; no batches | N/A |
| Silent client | no pong | terminated at 30 s; `ws.clients.timedOut` +1 | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/server.ts` -- skeleton to replace. It currently opens Binance directly with the global `WebSocket`.
- `apps/api/src/application/latest-value-buffer.ts` -- `apply(depth|ticker)`, `values()`, `currentRev`. It rejects status events, so route those to the status tracker.
- `apps/api/src/application/counters.ts` -- `increment(name, by)`. Use `by = -1` to decrement `ws.clients.active`.
- `apps/api/src/domain/staleness.ts` -- `isPairStale(state, {upstreamConnected, now, staleAfterMs})`. Reuse it.
- `apps/api/src/domain/market-event.ts` -- `MarketDataSource`, `SourceKind`, `SourceStatusChange{connected, at}`.
- `apps/api/src/domain/pair-state.ts` -- `PairState` has exactly the `PairSnapshot` fields, so the mapping is a field copy with the book tuples spread into mutable arrays.
- `apps/api/src/infrastructure/{binance,simulator}/*` -- constructors take `{pairs, ...}`. Map config to options only in the composition root.
- `packages/contracts/src/ws-messages.ts` -- `ClientMessageSchema` (discriminated union, currently only `client.setInterval`), the server schemas, and `DEFAULT_HEARTBEAT_MS`, `MIN/MAX_INTERVAL_MS`.
- `apps/api/src/config.ts` + `config.test.ts` -- extend them in the existing style (default when unset or empty, `/^\d+$/` guard, `Invalid <VAR>` message).
- `apps/api/eslint.config.js` -- forbids domain and application from importing concrete adapters. It is not changed.
- `@fastify/websocket` 11.3.1 -- register with `{ options: { maxPayload: 4096 } }`. The handler is `(socket, request)`, where `socket` is a `ws` `WebSocket`.
- `ws` 8.21.3 -- the client supports `autoPong: false` for the ping-timeout test. `message` gives `(data, isBinary)`.
- `vitest.shared.ts` -- in real-socket tests, fake only `setTimeout`, `setInterval` and `Date`.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/api/src/config.ts`, `config.test.ts` -- add `BROADCAST_INTERVAL_MS` and `STALE_AFTER_MS`, with tests for defaults and invalid values.
- [ ] `apps/api/src/application/upstream-status.ts` -- tracks `connected`/`since` from `SourceStatusChange`. Add `market-event-router.ts`, which builds a `MarketEventSink` sending depth and ticker events to the buffer and status events to the tracker.
- [ ] `apps/api/src/application/client-session.ts` -- the cursor, the single timer, `setInterval(ms)`, status change and heartbeat detection, and `dispose()`. Depends on the injected `SessionSocket { send(text) }` and `SessionEncoder { snapshot, batch, status }` interfaces.
- [ ] `apps/api/src/presentation/pair-snapshot-encoder.ts` -- `toPairSnapshot` plus the per-pair `{rev, json}` fragment cache. Builds the `snapshot`, `batch`, `status` and `error` JSON strings. `serialize` is injectable so tests can count calls.
- [ ] `apps/api/src/presentation/ws-gateway.ts` -- registers `/ws`. Creates and removes sessions, parses inbound messages, counts strikes, runs the ping/pong timeout, updates counters and logs.
- [ ] `apps/api/src/presentation/http-server.ts` -- `createHttpServer(deps)`: Fastify, the websocket plugin, `/health` stub and the gateway. Returns the app and `close()`.
- [ ] `apps/api/src/composition-root.ts` -- `createMarketDataSource(config)` switches on `MARKET_SOURCE` with no fallback. `compose(config, overrides?)` wires everything and returns `{ app, start, stop }`. The source override exists only for tests.
- [ ] `apps/api/src/server.ts` -- `loadConfig`, `compose`, `listen(0.0.0.0:8080)`, and stop on SIGINT/SIGTERM.
- [ ] Tests: `client-session.test.ts` and `upstream-status.test.ts` (unit, fake timers). `pair-snapshot-encoder.test.ts`. `test/ws-gateway.integration.test.ts` (real Fastify on 127.0.0.1:0, real `ws` clients, fake `MarketDataSource`, every I/O row, every message full-parsed with contracts schemas). `composition-root.test.ts` (source selection, no fallback).

**Acceptance Criteria:**
- Given a client connects, then the first message is `market.snapshot` with every configured pair exactly once, the second is `market.status`, and both arrive before any batch.
- Given clients at 100 ms and 1000 ms and one changing pair, then each gets its own cadence from the shared buffer.
- Given upstream disconnects and later reconnects, then the client sees `connected:false` with every pair stale within one heartbeat, its socket stays open, and it then gets `connected:true` and fresh batches with no restart.
- Given `source.kind === 'binance'` and the source never connects, over several heartbeats every status has `source:'binance'`, `connected:false` and every pair stale, and no batch is sent.
- Given `MARKET_SOURCE=binance`, then `createMarketDataSource` returns a `BinanceMarketDataAdapter` and the simulator module is never constructed.
- Given three clients and a pair that changes once, then that pair is serialized exactly once.
- Given a client closes, then its timer is cleared (`vi.getTimerCount()` drops), `ws.clients.active` decrements, and the other clients keep receiving.
- Given the repo root, when `pnpm typecheck && pnpm lint && pnpm test` runs, then all exit 0.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

The application layer never sees wire types. `ClientSession` calls `encoder.batch(states, t)` and gets back a string. The presentation encoder builds that string from cached fragments:

```ts
`{"v":1,"type":"market.batch","t":${t},"pairs":[${states.map(fragment).join(',')}]}`
```

`fragment(state)` returns the cached JSON when `cache.get(pair)?.rev === state.rev`. Otherwise it serializes the state and replaces the cache entry. The snapshot uses the same fragments. The session tick order is: status check, then batch.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm test` -- expected: exit 0
- `grep -rn "infrastructure/" apps/api/src --include=*.ts | grep -v "^apps/api/src/infrastructure\|composition-root"` -- expected: no output
- `MARKET_SOURCE=simulator pnpm --filter @pulsecrypto/api start` and a `ws` client on `ws://127.0.0.1:8080/ws` -- expected (manual): snapshot, status, then batches about every 100 ms
