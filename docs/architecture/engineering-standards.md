# Engineering Standards

Rules for every change in this repo. A rule that cannot be checked in review does not belong here.

## 1. TypeScript configuration

| Flag | Reason |
|---|---|
| `strict` | Baseline: null checks, no implicit `any`, strict function types. |
| `noUncheckedIndexedAccess` | Index reads return `T \| undefined`, so empty collections must be handled. |
| `exactOptionalPropertyTypes` | `foo?: T` means absent, not `undefined`; payloads keep one shape. |
| `noImplicitOverride` | Overriding a base member requires `override`; renames cannot silently orphan it. |
| `verbatimModuleSyntax` | Type-only imports use `import type`, so emitted JS matches the source. |
| `noFallthroughCasesInSwitch` | Every non-empty `case` must `break`/`return`; lifecycle switches stay exhaustive. |

`noUncheckedIndexedAccess` matters most here: `bids[0]` on an empty book side is
`OrderBookLevel | undefined`, so the WebSocket contract's null-spread handling is forced
at compile time, not discovered at runtime.

`any` is banned (`@typescript-eslint/no-explicit-any: error`). `unknown` is allowed only
at external boundaries and must be narrowed immediately by a Zod parse.

## 2. Naming conventions

| Thing | Convention |
|---|---|
| React components, domain types | `PascalCase` |
| Hooks | `useSomething` |
| Stores | `somethingStore` / `useSomethingStore` |
| Services / adapters | `SomethingService` / `SomethingAdapter` |
| Zod schemas | `SomethingSchema` |
| Files | `kebab-case`, unless a framework convention requires otherwise |
| True constants | `UPPER_SNAKE_CASE` |

No third-party provider name appears outside its adapter. The domain abstraction is
`MarketDataSource`; `BinanceMarketDataAdapter` and `SimulatorMarketDataSource` implement it.
A type, function, variable or file named after Binance in `domain/` or `application/` is a defect.

## 3. Module boundaries

Layering is `presentation → application → domain`. `infrastructure/` implements interfaces
defined in `domain/` and is imported only by the composition root.

Enforced by ESLint in `apps/api/eslint.config.js`, scoped to `src/domain/**` and `src/application/**`:

```js
'no-restricted-imports': ['error', { patterns: [
  { group: ['**/infrastructure/binance/**', '**/infrastructure/simulator/**'],
    message: 'Depend on MarketDataSource, not a concrete adapter.' },
]}]
```

No Binance-shaped object crosses the adapter boundary. Raw exchange payloads are parsed and
normalized inside the adapter; only `MarketSnapshot` leaves it.

## 4. Error handling

- **Expected / recoverable** (upstream disconnect, malformed frame, client socket error):
  handle it, count it, surface it via `market.status`. Never crash the process.
- **Programmer error** (schema mismatch on our own contract, impossible state): fail loudly
  and early. Do not defensively swallow.
- No catch-and-ignore in an adapter. A malformed upstream frame is dropped *and* counted.

## 5. Logging

Structured JSON via pino (bundled with Fastify). Levels: `error`, `warn`, `info`, `debug`.

**Hot-path rule:** no log call in the ingest, normalize or broadcast path. At 1000 events/sec
a per-event log line dominates the CPU profile and corrupts the stress numbers this project
must produce. Hot paths increment counters; logs fire only on state transitions: upstream
connect/disconnect, client connect/disconnect, slow-consumer threshold crossed, reconnect attempt.

## 6. Validation placement

| Boundary | Validation |
|---|---|
| Server, upstream (every Binance frame) | Full Zod parse, always |
| Server, downstream (every client control message) | Full Zod parse, always |
| Client, production | Envelope only: `v`, `type`, `t` |
| Client, `__DEV__` | Full schema parse of every message |

Full per-batch validation on device at 10 Hz costs measurable CPU on an emulator — the exact
axis being evaluated. `__DEV__` keeps contract drift visible without paying for it in release.

## 7. Performance guardrails

- Never update React state per raw upstream event; the backend broadcast interval drives render cadence.
- Market rows subscribe only to their own pair's slice; selectors are stable references.
- Telemetry accumulates in a ref and flushes to the store on a 1 Hz timer.
- Order-book rows are keyed by index (`0..19`), never by price level.
- Animate values and bar widths in place; never copy market state into component-local state per event.
- No new dependency without a one-line justification in the PR description.

## 8. Design patterns

Only patterns actually applied, each with the problem it solves:

- **Adapter** — isolates Binance and the simulator behind `MarketDataSource`, so domain code never sees a provider payload.
- **State machine** — connection lifecycle `idle → connecting → connected → disconnected → reconnecting`; illegal transitions are unrepresentable.
- **Strategy** — reconnect backoff policy is swappable (and fakeable in tests) without touching the connection code.

A pattern is justified by the problem it solves, in its ADR or PR description. Naming a class
after a pattern is not justification. No DB-style repositories: there is no database.

## 9. Code review expectations

Every change is reviewed against this checklist before merge:

> unbounded memory growth · slow WebSocket consumers · event-loop blocking · timer leaks ·
> reconnect storms · stale-data correctness · invalid order-book assumptions · broad React Native
> rerenders · expensive selectors · animation churn · REST/WebSocket state races · telemetry
> overhead · Android emulator networking · weak or false-confidence tests · undocumented
> assumptions · drift from approved ADRs · dead code and unjustified dependencies

Each finding states: **severity**, **file/symbol evidence**, **why it matters**, **minimal
remediation**, **the test that proves the remediation**. A finding without code evidence is not a finding.

Each finding needs human acceptance. Rejecting one with a stated reason is a valid outcome and
is recorded in `docs/ai/ai-development-log.md`.
