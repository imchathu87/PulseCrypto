# ADR-004: Full per-pair snapshots with per-client cadence

## Context

Clients receive processed updates at a configurable interval, default 100 ms (CAP-2). Each update
identifies its pair (CAP-4). ADR-005 must be able to skip frames for slow clients without losing
data, and the slider lets each client choose its own interval (CAP-15).

## Decision

- Each pair entry on the wire is the pair's **complete current state** (ADR-006 `PairSnapshot`), never a delta.
- **On connect**, the server immediately sends `market.snapshot` with every configured pair (fields
  nullable before first data), then `market.status`, and sets `cursor` to the sequence value at
  snapshot time.
- **Each tick** sends `market.batch` with pairs whose `rev > cursor`, then sets `cursor` to the
  highest `rev` sent. A tick with no changes sends nothing.
- Each `ClientSession` owns one timer, starting at `BROADCAST_INTERVAL_MS` (env, default 100). An
  accepted `client.setInterval` (integer 10..1000) re-arms the timer so the next tick fires at
  `min(new, remaining)`, and sends `market.status` at once as the ack. The timer is cleared on close.
- Serialization cache: at most one JSON fragment per pair, replaced when that pair's `rev` changes,
  and built lazily on the first tick that needs it.

Snapshots make frame-skipping lossless: whichever frame a client receives next contains everything
it missed, because "everything" is just the latest state. That is what lets ADR-003 have no queue.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Deltas (changed levels only) | A skipped delta corrupts the client's book; needs sequence numbers, gap detection, resync |
| One global timer for all clients | Cannot serve per-client intervals |
| Scheduler with per-client due times | Same result as per-session timers, more code |
| Push on every upstream event | Upstream rate would drive render rate |
| Snapshot on the session's first tick | Up to 1 s blank screen at a 1000 ms interval; complicates cursor initialisation |

## Consequences

- **Trade-offs:** larger frames than deltas. Frame size and throughput are to be measured in the
  stress test. All sessions share one event loop, so a 10 ms client adds load for everyone.
  Cross-client impact is measured through event-loop delay in the stress test.
- **Expected rate:** `min(1000 / intervalMs, upstream pair-change rate)`, not `1000 / intervalMs`,
  because empty ticks are skipped.
- **Failure modes:** a timer leak on close (covered by teardown tests); `setInterval` drift under
  event-loop lag (visible in telemetry).
- **Migration:** deltas could be added *within* a session, keeping snapshots on connect and after any skip.

## Status

Accepted (snapshot semantics adopted; session details defined here). Requirements: CAP-2, CAP-4, CAP-15, NFR-4.
