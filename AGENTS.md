# AGENTS.md

## Before changing code

1. Read the story and every requirement ID it references. If no story covers the change, stop and say so.
2. Read `docs/architecture/architecture.md` and every ADR the change touches.
3. Read `docs/contracts/` if the change touches the wire protocol.
4. Inspect the existing implementation; do not assume it.
5. State the intended change and its architectural impact before editing.

## Always

- Follow the approved architecture and ADRs.
- TypeScript strict. `unknown` at external boundaries, narrowed by a Zod parse. Never `any`; never `as unknown as X` to evade it.
  - Sole exception: `decodeServerMessage` in `packages/contracts` may type a server message after an envelope-only parse in production builds (engineering-standards §6, ADR-006). No other cast of external data is permitted.
- Validate external data at every boundary: upstream frames, client control messages, REST responses.
- Keep domain logic independent of transport. No Binance-shaped object crosses the adapter boundary.
- Keep high-frequency market state isolated from broad UI state.
- Preserve bounded memory: server state is O(pairs), never O(events). No per-client message queue.
- Key order-book rows by index (`0..19`), never by price level.
- Accumulate telemetry in a ref; flush it to the store on a 1 Hz timer.
- Use counters in the ingest, normalize and broadcast paths. Log only on state transitions.
- Clean up subscriptions, timers and sockets on teardown.
- Add or update tests for every behavioural change.

## Never

- Rewrite unrelated code or "improve" files the story does not touch.
- Add a dependency without a one-line justification in the PR description.
- Introduce a database, Redis, Kafka, microservices, Kubernetes, event sourcing, a custom binary protocol or a GPU rendering pipeline. Each needs an approved ADR that does not currently exist.
- Change a public contract without updating the schema, the contract document and the tests in the same change.
- Update React state for a raw upstream event.
- Subscribe a component to more market state than it renders.
- Advance a client's cursor for a frame skipped due to backpressure. The value must re-send on the following tick; this invariant is the basis of the losslessness claim.
- Display or document a metric that was not actually measured.
- Weaken, skip or disable a lint rule, type check or test to make something pass.
- Commit secrets, `.env` files or API keys. Binance public market streams need none.
- Modify anything under `docs/reference/`. The assignment, mockup and engineering guide are immutable inputs.
- Implement a mockup-only feature without explicit scope approval.
- Change architecture or an ADR silently.

## Stop and ask

Raise it and wait, rather than deciding alone, when:

- the story is ambiguous or conflicts with a requirement;
- an ADR appears wrong (follow the architecture change protocol in `docs/architecture/scope-boundaries.md`);
- the minimal fix would cross an architectural boundary;
- a requirement cannot be satisfied without one of the prohibitions above.

Discovering an approved decision is wrong is a good outcome. Working around it silently is the failure mode.

## Completion report

Fill after every story:

```
Requirement IDs:
Files changed:
Tests added/updated:
Commands run + results:
Architecture impact:
Unresolved risks:
```

- A section with nothing to report says "none". Never invent content.
- Tick an acceptance-criteria checkbox only if you actually verified it. An unverified tick is worse than an unticked box.
