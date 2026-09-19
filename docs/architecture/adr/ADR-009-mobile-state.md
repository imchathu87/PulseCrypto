# ADR-009: Mobile state — Zustand for market data, TanStack Query for REST

## Context

The app receives up to one message per interval (10–1000 ms), each with up to five full pair
snapshots, and must stay smooth (CAP-12). It fetches `/pairs/meta` with pull-to-refresh (CAP-14)
and persists favourites (CAP-9). React Native's socket module has no flow control, so a slow JS
thread builds a backlog on the device (ADR-005). Expo Go rules out non-SDK native modules.

## Decision

- **Coalescing:** `MarketSocket.onmessage` decodes and merges pairs into a pending
  `Map<Pair, PairSnapshot>` (latest wins). One `requestAnimationFrame` flush commits it to
  `marketStore`.
- **Render-cadence rule:** at most one market commit per display frame, never more than one per
  message, and never per upstream event. No market state is copied into component state; components
  use per-pair, per-field selectors.
- **Apply rules:** the book group and the ticker group each replace atomically, only when their
  `lastDepthAt` / `lastTickerAt` is non-null. Pairs are never deleted. `rev` is compared only within one
  connection.
- **TanStack Query** owns `['pairs','meta']` (display name, trading status). Rows are the keys of
  `marketStore.pairs`, and meta only decorates them. Pull-to-refresh calls `refetch()` and never
  touches the socket.
- **Favourites:** keyed by `pair` id and persisted to AsyncStorage. Pre-hydration changes are
  absolute intents `{pair, favourite}`, applied last-write-wins. Tested against a non-empty
  persisted set.
- **Settings:** the interval is `null` until the user moves the slider. It is sent on release and
  re-sent on connect only if set.
- `MarketSocket` is a module-level service started once at app root, so navigation never reconnects.
- Animation uses core `Animated` with the native driver (opacity, `scaleX` with `transformOrigin`).
  Reanimated is not added: core `Animated` covers these needs without a dependency or worklet setup.
  The Hermes memory regression is fixed in the pinned RN 0.86.3, so it is not the reason.
  `FlatList` suffices for the row count.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Commit once per message | Device-side backlog after a JS stall replays as a burst of renders |
| React Context for market data | Every consumer re-renders on every commit |
| Redux Toolkit | Same selector model, more ceremony |
| TanStack Query for WS data | Built for request/response caching, not a push stream |
| MMKV | Native module, not in Expo Go (spec constraint) |

## Consequences

- **Trade-offs:** two state libraries, each used for what it is built for. New dependencies:
  Zustand 5.x and TanStack Query 5.x, plus AsyncStorage via `npx expo install` (the SDK 57 pin).
  Each is justified in its PR.
- **Failure modes:** an over-broad selector re-renders every row (review checklist; to be measured
  in the stress test). JSON parse still runs per message; coalescing saves render work, not parse work.
- **Migration:** if parse cost dominates, decode could move off the JS thread. Store shape unchanged.

## Status

Accepted (Zustand + TanStack Query adopted; the rest defined here). Requirements: CAP-7..CAP-14, NFR-3, NFR-4.
