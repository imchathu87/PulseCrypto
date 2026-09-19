---
id: SPEC-pulsecrypto
companions:
  - binance-feed.md
  - figma-scope.md
  - stack.md
  - acceptance-demos.md
  - ../../../docs/architecture/architecture.md
  - ../../../docs/architecture/testing-strategy.md
sources:
  - ../../../docs/reference/EP-Practical Assignment - Staff Engineer - Mobile Apps (Architect - Mobile Apps) 2.pdf
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# PulseCrypto — Real-Time Market Gateway and Mobile Viewer

## Why

Mandate: a Staff Engineer (Mobile Apps) take-home assessment. Evaluators judge the architecture, whether the system stays responsive and maintainable under sustained real-time updates, and how effectively AI tools were used. Visual polish is explicitly not the goal. Every trade-off resolves toward a defensible, explainable design that visibly performs under load on the Android emulator.

## Capabilities

- **CAP-1**
  - **intent:** Backend ingests live Binance public market data (order book and last trade with 24h stats) for BTC, ETH, SOL, DOGE and XRP against USDT; more pairs optional.
  - **success:** With the backend running, all five pairs receive fresh order book and last-price data within 5s of start, and data keeps arriving continuously.
- **CAP-2**
  - **intent:** Backend buffers or batches upstream updates and emits processed updates to clients at a configurable interval, default 100ms.
  - **success:** A client observes one emission per interval (default ~10/s) regardless of upstream burst rate; changing the configured interval changes the observed rate.
- **CAP-3**
  - **intent:** Slow or stalled clients cannot cause unbounded backend memory growth.
  - **success:** A client that stops reading for 60s leaves backend memory flat (bounded per-client buffer), and healthy clients are unaffected; covered by a unit test.
- **CAP-4**
  - **intent:** Backend WebSocket server broadcasts processed market updates; every update identifies its pair; the payload format is documented.
  - **success:** Each message validates against the shared contract schema and carries at least the brief's example fields (`pair`, `timestamp`, `price`, `spread`, `buyPressure`, `sellPressure`, `bids`, `asks`); the README documents every field.
- **CAP-5**
  - **intent:** `GET /pairs/meta` returns, per supported pair, display name, trading status, 24h high, 24h low and 24h volume.
  - **success:** The endpoint returns one entry per supported pair with all five fields, validated by the shared contract.
- **CAP-6**
  - **intent:** Backend survives loss of the Binance connection: it reconnects automatically and tells clients when data is stale.
  - **success:** Forcibly dropping the upstream socket results in clients receiving a stale status, then fresh data after automatic reconnection, with no backend restart.
- **CAP-7**
  - **intent:** User sees a watchlist of all supported pairs; each row shows pair, current price, 24h change, live connection indicator and favourite toggle.
  - **success:** All five pairs appear with live-updating price and 24h change, a visible connection indicator, and a working favourite toggle.
- **CAP-8**
  - **intent:** User can search or filter the watchlist.
  - **success:** Typing `btc` leaves only BTC / USDT; clearing the query restores all pairs.
- **CAP-9**
  - **intent:** User can favourite pairs, and favourites survive app restarts.
  - **success:** Favourite a pair, kill and relaunch the app, and the pair is still favourited.
- **CAP-10**
  - **intent:** Selecting a pair shows its market details: current price, buy pressure, sell pressure, spread, live order book (bids and asks), last-updated timestamp.
  - **success:** Tapping any watchlist row opens the details view with all six elements updating live for that pair.
- **CAP-11**
  - **intent:** Price increases briefly highlight green, decreases red; order book volume changes animate smoothly.
  - **success:** In the screen recording, price ticks visibly flash in the correct colour and depth bars transition rather than jump.
- **CAP-12**
  - **intent:** The UI stays smooth and responsive during sustained update bursts.
  - **success:** On the Android emulator at the default 100ms interval across all pairs, the JS FPS readout stays at or above 55 and scrolling, search and navigation remain responsive.
- **CAP-13**
  - **intent:** When the backend is unavailable, the app shows the connection status, keeps showing the last received data, and reconnects automatically once the backend returns.
  - **success:** Killing the backend flips the status indicator while last prices remain on screen; restarting it restores live data with no user action.
- **CAP-14**
  - **intent:** Pull-to-refresh reloads `/pairs/meta` without interrupting the live stream.
  - **success:** During a pull-to-refresh the prices keep updating and the WebSocket connection is not closed or reopened.
- **CAP-15**
  - **intent:** A Telemetry & Settings screen (per the Figma) lets the user adjust update frequency and see real JS frame rate and WebSocket message rate.
  - **success:** Moving the slider between 10ms and 1000ms changes the observed msgs/sec for that client; FPS and msgs/sec tiles show live measured values, not constants.
- **CAP-16**
  - **intent:** Reviewers receive a runnable repo, a screen recording, and a README covering setup, build/run, architecture decisions, buffering strategy, payload format, assumptions, trade-offs and AI-tool usage.
  - **success:** A reviewer can follow the README from a fresh clone to a running Android app; the recording covers every item in `acceptance-demos.md`.
- **CAP-17**
  - **intent:** Backend can run on a deterministic, offline synthetic market source at a configurable event rate for stress tests and CI; synthetic data is never substituted for Binance automatically and is always labelled as synthetic in the app.
  - **success:** Started on the synthetic source at 1000 events/s, all five pairs stream to the app under a visible `SIMULATED` label with no network access to Binance; started on Binance with Binance unreachable, clients see stale status and no synthetic prices.

## Constraints

- Backend is Node.js + TypeScript with Fastify and WebSockets; mobile is React Native on Expo.
- The mobile app runs in **Expo Go**: no native modules outside the Expo Go SDK (rules out MMKV and other custom native libraries).
- The Android emulator is the required target; the iOS simulator is optional. The backend URL is configurable per platform (see `stack.md`).
- "Current price" means the **last traded price** from the Binance ticker, not the order book mid-price.
- Binance depth payloads carry no symbol and no event time; pair identity and timestamps come from elsewhere (see `binance-feed.md`).
- The brief evaluates these quality attributes, labelled as in `architecture.md` §0: NFR-1 clean architecture, NFR-2 maintainable code, NFR-3 responsive UI under continuous updates, NFR-4 efficient state management, NFR-5 robust connection handling, NFR-6 appropriate error handling, NFR-7 separation of concerns.
- Only Binance public market streams are used; no API keys, accounts or order placement.
- The UI follows the provided Figma PNG only and stays minimal; `figma-scope.md` defines what is in and out.
- Wire contracts live in the shared workspace package `packages/contracts` (Zod schemas plus inferred types) and are used by both apps.
- Tests follow `testing-strategy.md`: unit, backend integration, protocol and contract tests, a stress test on the synthetic source, and a manual resilience run; no end-to-end or device-automation tests.
- No performance or resilience claim appears anywhere unless it was measured and recorded in `docs/verification/`; telemetry tiles show measured values or are omitted.
- Wire `timestamp` is milliseconds since epoch (server receive time), not the brief's example seconds; the README states the unit.

## Non-goals

- Authentication, user accounts, profiles, API-key management, trade history, support, sign-out (the Figma drawer).
- Placing orders or any trading action.
- Market cap, binary protocol compression, adaptive polling, and the GPU acceleration, API latency and storage-cache telemetry cards shown in the Figma.
- A dev-client or bare native build; Expo Go only.
- End-to-end or device-automation tests.
- Visual polish beyond the Figma reference.

## Success signal

On the Android emulator, a reviewer watches all five pairs stream live at 100ms, opens a pair to see its order book animate, kills the backend and sees the app hold its last data and then recover on its own, all while the FPS readout stays at or above 55. Every scenario in `acceptance-demos.md` is shown in the screen recording, and `docs/verification/stress-results.md` shows 1000+ synthetic events/s coalesced to about 10 broadcasts/s with buffered state bounded by pair count and flat RSS.

## Assumptions

- The Q1 answer "stick to the screenshot" is read as: build the screens shown in the PNG, minimally, with real data only; fabricated or web-only widgets are omitted.
- The update-frequency slider sets a per-client emit interval on the backend; the server-wide default (100ms) comes from environment config.
- Buy pressure = bid quantity as a percentage of total bid + ask quantity over the displayed levels; sell pressure = 100 − buy pressure.
- Spread = best ask − best bid; the Figma "liquidity gap" shows spread as a percentage of price.
- 24h change, high, low and volume come live from the Binance ticker; `/pairs/meta` mocks only display name and trading status.
- The Settings tab opens the same combined Telemetry & Settings screen shown in the PNG.
- Test thresholds not set by the brief were chosen by the spec: data within 5s of start (CAP-1), a 60s stalled client (CAP-3), FPS ≥ 55 (CAP-12).
- Watchlist 24h change uses the brief's arrow format (`▲ 1.82%` / `▼ 0.41%`).

## Open Questions

- What is the deadline or time budget? It affects how much of CAP-15 to build.
