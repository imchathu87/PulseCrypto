# Acceptance Demos

Each item must appear in the screen recording (Android emulator) and be reproducible from the README. Bracketed IDs refer to SPEC.md capabilities.

1. Backend starts; all five pairs (BTC, ETH, SOL, DOGE, XRP / USDT) stream live on the watchlist. [CAP-1, CAP-4, CAP-7]
2. Prices flash green on uptick and red on downtick. [CAP-11]
3. Search: typing `btc` filters to BTC / USDT; clearing restores the list. [CAP-8]
4. Favourite a pair, kill and relaunch the app, favourite restored. [CAP-9]
5. Open a pair: price, buy/sell pressure, spread, live bid/ask book, last-updated timestamp; depth bars animate. [CAP-10, CAP-11]
6. Kill the backend: status indicator changes, last data stays; restart backend: app reconnects unaided. [CAP-13]
7. Pull-to-refresh on the watchlist while prices keep streaming. [CAP-14]
8. Telemetry: FPS ≥ 55 under load; moving the update-frequency slider changes msgs/sec. [CAP-12, CAP-15]
9. Backend-side (terminal or test output): slow-consumer protection and upstream reconnect/stale handling. [CAP-3, CAP-6]
10. Backend on the synthetic source: `SIMULATED` chip visible, pairs streaming. [CAP-17]
