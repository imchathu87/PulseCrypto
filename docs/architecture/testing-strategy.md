# Testing Strategy

## Tooling

| Area | Tool |
|---|---|
| Backend (`apps/api`) | Vitest |
| Mobile (`apps/mobile`) | Jest (`jest-expo` preset) + React Native Testing Library |
| Shared contracts (`packages/contracts`) | Vitest against the Zod schemas |

**Rule: fake timers** for every test involving broadcast cadence, reconnect backoff or the
status heartbeat. A 100ms interval tested against real time is slow and intermittently red.
In tests with real sockets, fake only `setTimeout`, `setInterval` and `Date`
(`vi.useFakeTimers({ toFake: [...] })`); faking `setImmediate`/`nextTick` stalls socket I/O.

**No coverage threshold.** Deliberately: a coverage gate in a take-home rewards low-value tests
over the specific high-value ones listed below.

## Backend unit tests

- Market normalization from each upstream stream shape (depth, ticker).
- Buy/sell pressure calculation, including the zero-depth case.
- Spread calculation, including the empty-book-side case.
- Latest-value replacement semantics.
- Revision counter increments on mutation.
- Broadcast timing policy at the configured interval.
- Malformed upstream input is dropped and counted, not thrown.
- Reconnect backoff sequence, including jitter bounds and reset after stability.
- Slow-consumer threshold policy at the soft and hard limits.

## Backend integration tests

A distinct layer; do not fold these into the unit list. Wire a fake `MarketDataSource` through
normalization and the buffer to a real downstream WebSocket client:

- Fake upstream source → normalization → buffer → connected WS client.
- `GET /pairs/meta` returns the documented shape.
- `GET /health` returns 200.
- Multiple concurrent clients each receive correct data.
- A client disconnecting does not disturb the others.
- Upstream disconnect and reconnect, with the downstream socket staying open.
- A downstream client that deliberately reads slowly triggers the documented skip policy, and
  recovers correctly once it drains.

## Protocol behaviour tests

- A newly connected client receives `market.snapshot` containing **all** pairs before any `market.batch`.
- A client's cursor is **not** advanced when a frame is skipped for backpressure; the value
  arrives on the following tick.
- `client.setInterval` outside 50–2000 ms is rejected with `BAD_REQUEST`; the previous interval is retained.
- Two clients on different intervals each receive their own cadence from shared state.
- `market.status` reports `upstream.connected: false` within the heartbeat window after the
  upstream adapter drops, while the downstream socket stays open.
- `spread` and `buyPressure` are `null` — not `0`, not `50` — when a book side is empty.

## Mobile tests

- Search / filter.
- Favourite persistence and restoration.
- Favourites toggled **before** AsyncStorage hydration completes are not lost.
- Watchlist selector isolation, where practical.
- Disconnect state retains previously received data.
- Automatic reconnection state transitions.
- Pull-to-refresh reloads metadata without closing the WebSocket.
- Price-direction highlight (up / down / unchanged).
- Order-book rendering and animation, at component level.
- AppState background → active produces a reconnect and a fresh snapshot.

## Contract tests

Validate representative messages with the shared Zod schemas on both ends. Every example message
in `docs/contracts/websocket-protocol.md` must parse; every documented invalid case must be
rejected. This is what keeps the contract document and the contract code from drifting apart.

## Stress testing

Runs against the simulator data source defined in ADR-011; it is not redefined here.

Configuration: `SIMULATOR_RATE=1000`, `BROADCAST_INTERVAL_MS=100`, five pairs, 60 s run.

Measure and record to `docs/verification/stress-results.md`:

- input events/sec · normalized events/sec · buffered pair snapshots · broadcasts/sec
- dropped or coalesced updates · process RSS sampled per second · CPU, if easily collected
- event-loop lag · downstream `bufferedAmount` · client messages/sec
- observed mobile responsiveness

The proof required:

```
1000+ upstream events/sec → latest-value coalescing → ~10 broadcasts/sec at 100ms
→ mobile remains responsive
```

with the buffered snapshot count bounded by pair count (5), not event count, and flat RSS
across the run.

Record the exact command used to reproduce. Report measured numbers only. No performance claim
may appear anywhere in the repository unless it is in `stress-results.md`.

## Resilience testing

Manual, recorded to `docs/verification/resilience-results.md`. Primary scenario:

1. App connected normally.
2. Stop the backend.
3. UI shows disconnected / reconnecting.
4. Last market data remains visible.
5. Restart the backend.
6. App reconnects automatically.
7. Updates resume.

Secondary scenarios:

- Upstream Binance disconnect while the local mobile connection stays alive.
- Malformed upstream event.
- REST metadata request fails while the WebSocket is healthy.
- WebSocket fails while REST is healthy.

## Explicitly not tested

| Out of scope | Why |
|---|---|
| Visual fidelity against the mockup | Checked by manual review, not assertions. |
| Real Binance connectivity in CI | Non-deterministic; CI runs against the simulator. |
| iOS | Optional per the assignment; Android emulator is the target. |
