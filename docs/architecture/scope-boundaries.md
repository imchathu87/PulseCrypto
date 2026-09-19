# Scope Boundaries

What this system deliberately does not do, what a production version might add, and how
an agent must handle a conflict with the agreed architecture.

## 1. Deliberate exclusions

Unless a mandatory requirement or a measured need proves otherwise, this project does not include:

> authentication · user accounts · real trading or order placement · payments ·
> blockchain integration · database · Redis · Kafka · Kubernetes · microservices ·
> cloud deployment · event sourcing · custom binary WebSocket protocol ·
> GPU-specific rendering pipeline

This is a decision, not an omission. The system serves five trading pairs in a local
assignment. A single Node.js process holding current state in memory is defensible, easier
to reason about, and easier to verify. Each exclusion above would add operational surface
without improving any requirement in the assignment.

The three most likely to be questioned:

| Exclusion | Why not, in this system's numbers |
|---|---|
| Database | The product is current state, not history: five pairs × one top-20 book and one ticker each. That fits in a few in-memory objects, and a restart rebuilds it from Binance in seconds. |
| Message broker (Kafka, Redis pub/sub) | One process ingests ~55 upstream msgs/s over a single 10-stream connection and fans out ~10 broadcasts/s. There is no second producer or consumer process to decouple. |
| Binary protocol | Each broadcast is a full top-20 snapshot, not a delta, at ~10/s. JSON at that rate is not the bottleneck, and it stays debuggable and Zod-validated on both ends. |

## 2. Future scale-out (discussion only)

A production, multi-instance deployment could introduce:

- a shared message broker or stream between ingestion and fan-out;
- independent ingestion and client-broadcast layers;
- horizontally scaled WebSocket instances;
- observability and load balancing in front of them.

**None of this is built here.** It is listed only so the boundary reads as deliberate rather
than accidental. There is no partial implementation, interface or stub for any of it, and none
should be added without an approved ADR.

## 3. Architecture change protocol

An AI agent must not silently change the system architecture. On discovering a conflict
between the agreed architecture and what the code needs, the required sequence is:

1. Name the current ADR or architecture rule.
2. Show the evidence that it creates a real problem (code, test output, measurement).
3. Propose one or two alternatives.
4. Explain the impact on requirements.
5. Explain the impact on tests.
6. Draft the ADR update.
7. Wait for human approval.
8. Then implement.

Discovering that an ADR is wrong is a good outcome. Surface it immediately; do not work around
it. Disagreement is expected and welcome. A silent workaround is the failure mode.
