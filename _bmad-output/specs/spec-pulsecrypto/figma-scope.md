# Figma Scope

Visual reference: `../../../docs/reference/figma-reference.png` (PNG only; the Figma file itself is not accessible and not required). The assignment brief wins wherever the two conflict.

## Screens

| Figma element | Decision | Maps to |
|---|---|---|
| Bottom tabs: Terminal, Markets, Telemetry, Settings | In | Navigation |
| Header: pair name, `CONNECTED` / `LIVE` chip, live icon | In | CAP-7, CAP-13 |
| `SIMULATED` chip | In, not in the PNG; shown whenever the source is not Binance | CAP-17 |
| Terminal: last price + 24h % change | In | CAP-10, CAP-11 |
| Terminal: 24h high / 24h low | In | CAP-10 (ticker data) |
| Terminal: market cap | **Out** | Not in brief, not in Binance streams |
| Order book: bids (green) above asks (red), 10 levels each, columns PRICE / AMOUNT / TOTAL, depth-bar backgrounds | In, **layout as in Figma** | CAP-10, CAP-11 |
| Market depth visual + bids/asks totals | In, minimal | CAP-10 |
| Liquidity gap (spread %) + Pressure label (e.g. "Sell Heavy") | In; buy % and sell % numbers are also shown | CAP-10 |
| Markets tab (watchlist, search, favourites) | In, **not in the PNG**; same visual language | CAP-7, CAP-8, CAP-9 |
| Telemetry: Update Frequency slider 10–1000ms | In | CAP-15, CAP-2 |
| Telemetry: JS FPS tile, WS msgs/sec tile | In, real measured values | CAP-15, CAP-12 |
| Telemetry: memory footprint tracker | In only if Expo Go exposes a real Hermes heap reading; otherwise omitted (ADR-010) | CAP-15 |
| Telemetry: RESET / HEALTHY chips | In only if backed by real state | CAP-15 |
| Binary protocol compression toggle, adaptive polling toggle | **Out** | Non-goal |
| GPU acceleration, API latency (London-1), storage cache (IndexedDB) cards | **Out** | Fabricated or web-only |
| Side drawer: Pro Trader profile, Tier/ID, API Keys, Security, Trade History, Support, Sign Out | **Out** | Non-goal (no auth or trading) |
| Settings tab | Opens the combined Telemetry & Settings screen | Assumption in SPEC.md |

## Visual language

Dark trading-terminal theme, green for bids and upticks, red for asks and downticks, monospaced numerics, uppercase micro-labels. Do not go beyond the PNG.
