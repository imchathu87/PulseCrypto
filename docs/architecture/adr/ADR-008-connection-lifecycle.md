# ADR-008: Two reconnect policies, one algorithm

## Context

There are two independent reconnect problems: API → Binance (CAP-6) and each mobile client → API
(CAP-13). They differ in who owns the far end, how liveness can be observed, and who is watching.
The skeleton used Node 22's built-in `WebSocket` (undici). Verified locally on 2026-09-19: on a
failed handshake it fires `error` but **never `close`**, leaves `readyState` at `CONNECTING`, and
does not expose the HTTP status (undici #3546, #3697, #3506).

## Decision

- **Shared algorithm, separate instances:** full-jitter exponential backoff
  `delay(attempt) = floor(random() × min(cap, base × 2^attempt))`, `attempt` from 0, `random`
  injected. It is a pure function in `packages/contracts`, tested with one shared set of test vectors.
- **Upstream client: `ws` 8.21.3**, declared in `apps/api`. It is already in the tree via
  `@fastify/websocket`. It exposes `unexpected-response` with the status code (so a 451 can be
  identified), always emits `close` after `error`, and gives explicit ping/pong. Its pong reply
  answers Binance's 20 s ping.
- **Ownership:** the upstream state machine, watchdog and backoff live inside the Binance adapter.
  It emits `SourceStatusChange` (ADR-011).

| | Upstream | Downstream (mobile) |
|---|---|---|
| Base / cap | 1 s / 30 s: third party; retry storms risk bans | 0.5 s / 5 s: our local backend; the user is watching |
| Attempt ends | First of `error` / `close` / `unexpected-response` / `UPSTREAM_CONNECT_TIMEOUT_MS` | First of `error` / `close` / heartbeat timeout |
| Liveness | Silence watchdog from `open` (`UPSTREAM_SILENCE_MS`) | No message for `3 × heartbeatMs` (from `market.status`) |
| Reset | After 60 s connected | After `DOWNSTREAM_STABLE_MS` past the first snapshot; `4008` never resets |
| Extra | 24 h close handled as an ordinary close; 451 logged with `BINANCE_WS_URL` hint | `paused` on background (no retry); `active` → connect at once |
| Outage effect | Downstream sockets stay open; all pairs stale | Last data kept; `RECONNECTING` |

Transitions are idempotent. Every timer and callback carries a socket generation id and is ignored
once that generation is superseded.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Keep the built-in `WebSocket` + connect timeout | Works, but the 451 cause stays invisible and relies on known-buggy event semantics |
| One shared policy object | Different owners and tolerances; one tuning is wrong for the other |
| Fixed-interval retry | Synchronised reconnect storms; hammers Binance during outages |
| RN `WebSocket.ping()` for liveness | Non-standard: a ping frame on iOS but an empty binary message on Android, and no pong event in JS |
| Close downstream sockets when upstream drops | Needless mobile reconnects; hides "stale" behind "offline" |

## Consequences

- **Trade-offs:** one declared dependency (`ws`), justified above. A 30 s cap can delay recovery
  after Binance returns.
- **Failure modes:** double-fired events (handled by idempotence plus the generation id); a persistently slow
  client is evicted and reconnects with growing backoff, not in a loop.
- **Migration:** parameters are config; proactive 23 h rotation can be added to the upstream side alone.

## Status

Accepted. Requirements: CAP-6, CAP-13, NFR-5.
