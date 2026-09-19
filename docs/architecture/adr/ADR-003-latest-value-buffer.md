# ADR-003: In-memory latest-value map with revisions and per-client cursors

## Context

Upstream delivers a nominal 10 depth frames/s per pair plus 1 ticker/s per pair; clients need at
most one update per pair per emit interval (CAP-2). Slow clients must not grow memory
(CAP-3). The product is **current state**: an older book for a pair has no value once a newer one
exists.

## Decision

- The buffer is `Map<Pair, PairState>`, overwritten in place: five entries for five pairs.
- Each mutation stamps `PairState.rev` from one process-wide monotonic integer, so revisions are
  per pair *and* totally ordered within one process lifetime. The sequence restarts with the
  process, so clients never compare `rev` across connections (ADR-006).
- Each `ClientSession` holds one integer `cursor`: the highest `rev` it has been sent. It
  sends pairs with `rev > cursor`.
- **No per-client message queue anywhere.** What a client has not yet received is derived from
  the map and its cursor.
- Single Node.js process, state in memory only. No database, Redis or broker (scope-boundaries §1).

Memory is O(pairs) for market state plus O(clients) for one cursor and timer each, independent of
event rate.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Per-client ring buffer / queue | Memory O(clients × backlog); a slow client's backlog is stale data by definition |
| Global event log + per-client offset | Grows with event rate; needs compaction to reach the same "latest" answer |
| Per-client `Record<Pair, rev>` cursor | Works, but a single integer is simpler given the global stamp |
| Redis / DB as the state store | A second process for five objects; restart rebuilds from the first upstream frames |

## Consequences

- **Trade-offs:** intermediate values between two ticks are coalesced away, which is correct for current
  state and wrong for a trade tape (out of scope). State is lost on restart (acceptable: it rebuilds from upstream).
- **Failure modes:** a bug that advances a cursor on a skipped send loses a value until the pair next
  changes. Guarded by the protocol test "cursor not advanced on skip" (testing-strategy).
- **Migration:** scaling out would move the map behind a shared store, with each gateway instance
  keeping per-client cursors. Not built (scope-boundaries §2).

## Status

Accepted (adopted). Requirements: CAP-2, CAP-3, NFR-4.
