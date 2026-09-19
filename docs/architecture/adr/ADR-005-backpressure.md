# ADR-005: Backpressure and slow-consumer policy

## Context

`ws` queues outgoing bytes in user space when a peer's **network** reads slowly. Without a policy,
one stalled client grows server memory without bound (CAP-3). ADR-003 and ADR-004 guarantee that
skipping a frame loses nothing.

## Decision

Only `market.batch` goes through the gate. `market.snapshot`, `market.status` and `error` are rare
and small, so they bypass it.

| Condition (checked every tick, including empty ticks) | Action | Counter |
|---|---|---|
| `bufferedAmount ≤ WS_SOFT_LIMIT_BYTES` | Send; advance cursor | `ws.frames.sent` |
| `> WS_SOFT_LIMIT_BYTES` | Skip; **cursor not advanced** | `ws.frames.skipped` |
| Above soft continuously for `SLOW_CLIENT_MAX_STALL_MS`, or `> WS_HARD_LIMIT_BYTES` | Close `4008` ("slow consumer"); log once | `ws.clients.evicted` |

- The cursor rule is the losslessness invariant (AGENTS.md): skipped values go out on the next tick.
- The eviction budget is **time-based**, so eviction speed does not depend on the client's slider.
- The hard limit can only be reached through ungated messages; it is the backstop for them.
- User-space bound per client: `max(soft + largest batch, hard) + largest ungated message`.
  Kernel socket buffers are outside this bound and absorb data before `bufferedAmount` rises.
- Limits are env config: chosen at implementation, tuned in the stress test, never presented as measured.

**Scope.** The gate sees only network-slow clients. React Native's socket module drains TCP with no
flow control, so a slow JS thread (GC, a heavy render) never shows up in `bufferedAmount`. That
case is handled on the device by per-frame coalescing (ADR-009). Tests use a raw TCP client that
stops reading, not a slow app.

## Alternatives considered

| Option | Rejected because |
|---|---|
| No limit (trust TCP) | `ws` buffers in user space; unbounded growth is the failure CAP-3 forbids |
| Drop-oldest per-client queue | Needs a queue (ADR-003 forbids); snapshots make old frames redundant |
| Skip budget counted in ticks | Evicts a 10 ms client after a brief stall and tolerates a 1000 ms client for much longer |
| Disconnect at first lag | Punishes transient network hiccups |

## Consequences

- **Trade-offs:** a slow client sees fewer frames, each still current. Whether healthy clients are
  unaffected is asserted in the stress test (a healthy client's rate while another is stalled),
  not assumed.
- **Failure modes:** limits set too low evict clients on slow networks; set too high, they delay
  protection. Both show in the skip and eviction counters.
- **Migration:** limits could adapt to a measured drain rate; the cursor rule does not change.

## Status

Accepted. Requirements: CAP-3, NFR-5, NFR-6.
