# Review: verification / reality-check lens

- **Target:** `docs/architecture/architecture.md` and `docs/architecture/adr/ADR-001` to `ADR-012`
- **Lens:** Was every committed decision checked against the web or the existing project, rather than asserted from training data? This covers library versions, whether each technology exists and fits, and runtime-behaviour claims.
- **Date:** 2026-09-19
- **Reviewer:** verification agent (read-only; target documents not edited)

## Method

1. **Repo reality sources.** Checked `pnpm-lock.yaml`, all `package.json` files, `pnpm-workspace.yaml`, `apps/mobile/metro.config.js`, `_bmad-output/specs/spec-pulsecrypto/stack.md` and `binance-feed.md`, and the installed `node_modules` source (ws 8.21.3, react-native 0.86.3, `expo/bundledNativeModules.json`, typescript-eslint).
2. **Local runtime experiments.** Ran these on the actual toolchain (Node v22.23.0, bundled undici 6.27.0, and ws 8.21.3 from `node_modules/@fastify/websocket/node_modules/ws`):
   - T1: a ws server pings a Node global `WebSocket` client. Does the client pong?
   - T2: a ws server sends 20 KB frames to a raw TCP client that stops reading after the handshake. When does `bufferedAmount` rise?
   - T3: the server closes with code 4008. What does the client see?
   - T4: a Node global `WebSocket` connects to a server that answers the handshake with HTTP 451. Which events fire?
3. **Web sources.** Binance spot docs (GitHub mirror of the official docs), Expo SDK 57 changelog, React Native docs and source, undici source and issue tracker, ws docs, fastify-websocket README, Node release schedule, and the npm registry.

## Summary

The Binance facts, the pinned versions, `ws` backpressure internals, close code 4008 and the undici auto-pong all hold up against the web and the repo. Four committed claims do not:

- **Stale:** the Reanimated memory rationale. The regression was fixed in RN 0.86.2/0.86.3, and the repo already pins 0.86.3.
- **Factually wrong:** "RN WebSocket has no ping API".
- **Unhandled runtime behaviour:** a Node `WebSocket` whose handshake fails never emits `close`.
- **Overstated scope:** `bufferedAmount` cannot see a slow JS thread on the device.

Several performance and isolation claims are also asserted without measurement.

| # | Severity | Location | One-line |
|---|---|---|---|
| F1 | high | architecture.md:157-159, ADR-008:10-12 | Node/undici `WebSocket`: a failed handshake fires `error` but never `close`; `readyState` stays CONNECTING; the 451 status is not exposed |
| F2 | high | ADR-005:5-7, 24, 32; architecture.md:95-99, 162 | `bufferedAmount` only sees network-slow readers. RN reads eagerly, so a slow JS thread never registers. About 820 KB of kernel buffering hides the first stall |
| F3 | medium | architecture.md:144-146; ADR-009:23-24 | The Reanimated/Android-memory rationale is stale: fixed by expo@57.0.9 (RN 0.86.2), and the repo pins RN 0.86.3 |
| F4 | medium | ADR-008:32 | "RN WebSocket exposes no ping API" is false. `ping()` exists but is platform-inconsistent (Android sends an empty *binary* message) |
| F5 | medium | ADR-006:28; ADR-004:34; ADR-005:37-38; ADR-010:28 | Performance and isolation claims asserted without measurement |
| F6 | medium | architecture.md:97-99; ADR-005:17, 24 | Hard limit unreachable through the gated path; the "memory bounded by hard limit + one frame" claim covers user space only |
| F7 | low | architecture.md:222-223 | "JS `number` loses nothing" is false for large volumes and for server-side spread arithmetic |
| F8 | low | ADR-012:6-7, 14; architecture.md:33 | Node 22.23.0 is claimed as "resolved in pnpm-lock.yaml" but is not pinned anywhere; Node 22 is already in Maintenance LTS |
| F9 | low | architecture.md:35; ADR-012:15 | The root `node_modules/ws` is 7.5.13 (hoisted), not 8.21.3, so a direct `ws` import would be a phantom dependency |
| F10 | low | ADR-009:19, 38-39 | AsyncStorage: Expo SDK 57 bundles 2.2.0, but npm `latest` is 3.1.1. The ADR must require `expo install` |
| F11 | low | architecture.md:144-145 | A depth bar animated with `scaleX` scales from its centre unless `transformOrigin` is set |
| F12 | low | ADR-008:38-39 | The auto-pong "assumption to verify" is now verified; update the wording |

---

## Findings

### F1: high. A failed upstream handshake never emits `close`, and HTTP 451 is not observable

- **Location:** `architecture.md:157-159` (failure-mode rows "Socket closed", "HTTP 451 (geo-block) | Handshake failure, counted | Keep retrying at cap"), `architecture.md:107` (state machine), `ADR-008:10-12`. The upstream client is Node's global `WebSocket` (`apps/api/src/server.ts:16` in the skeleton).
- **Claim:**
  - The upstream reconnect loop is driven by `close`/`error`, and the state machine moves `connecting → disconnected → reconnecting`.
  - A 451 geo-block is detected as a handshake failure and counted.
- **Evidence:**
  - **Local repro, Node v22.23.0 / undici 6.27.0.** A server that answers the upgrade with `HTTP/1.1 451` produces this, in two variants (raw upgrade response, and a plain HTTP server):
    ```
    error: Received network error or non-101 status code.
    no close after 15s; readyState 0
    ```
    `close` never fired, and `readyState` stayed `CONNECTING`. The error carries no status code and no `cause`.
  - **Known upstream bugs:**
    - [undici#3546 "WebSockets do not fire 'close' event if the connection failed to be established"](https://github.com/nodejs/undici/issues/3546)
    - [undici#3697 "close is not emitted on error"](https://github.com/nodejs/undici/issues/3697)
    - [undici#3506 "error but keeps CONNECTING state indefinitely"](https://github.com/nodejs/undici/issues/3506)
    - [undici#4273, the generic "non-101" message for every failure type](https://github.com/nodejs/undici/issues/4273)
    - [undici#4628, `close`/`error` fire twice if the socket is closed before open](https://github.com/nodejs/undici/issues/4628)
  - **Consequence.** A reconnect scheduled on `close`, or a transition that waits for `CLOSED`, wedges the upstream forever after the first DNS failure, connection refusal, TLS error or 451. That breaks CAP-6 and NFR-5. Separately, "HTTP 451" cannot be distinguished or counted with this client. The architecture never says whether the silence watchdog is armed during `connecting`.
- **Suggested fix:**
  - State in ADR-008 that an `error` while `CONNECTING` is terminal for that attempt: schedule the backoff from `error` as well as `close`.
  - Add an explicit connect timeout, and make the transitions idempotent, because events may double-fire.
  - Replace "HTTP 451 … counted" with a generic `upstream.connect.failed` counter. The alternative is to use a client that exposes the status, such as `ws`, whose `unexpected-response` event carries `statusCode`. That would be a declared dependency and needs a one-line justification (see F9).
  - Add a test that simulates a non-101 handshake.

### F2: high. `bufferedAmount` cannot detect a slow mobile JS thread, and kernel buffers delay detection

- **Location:** `ADR-005:5-7` ("`ws` queues outgoing bytes in memory when a peer reads slowly"), `ADR-005:24`, `ADR-005:32` ("Punishes a transient emulator GC pause"), `architecture.md:95-99, 162`.
- **Claim:** The server-side `bufferedAmount` gate protects against "slow clients", including emulator GC pauses.
- **Evidence:**
  - **ws 8.21.3 source.** `node_modules/@fastify/websocket/node_modules/ws/lib/websocket.js:120-124` computes `bufferedAmount` as `this._socket._writableState.length + this._sender._bufferedBytes`, so it counts user-space bytes only. The [ws docs](https://github.com/websockets/ws/blob/master/doc/ws.md) say the same: "queued using calls to `send()` but not yet transmitted to the network". This confirms that it is a sound signal for user-space growth. @fastify/websocket 11 passes the `ws` `WebSocket` itself to the handler ([README](https://github.com/fastify/fastify-websocket/blob/main/README.md)), so `socket.bufferedAmount` is available.
  - **Local measurement T2** (macOS loopback, 20 KB frames, client stopped reading): `bufferedAmount` stayed 0 until about 820,000 bytes had been sent, because the kernel send and receive buffers absorb them first. It then grew linearly, to 39.2 MB after 40 MB sent. At a few KB per batch at 10 Hz, a fully stalled client goes undetected for many seconds. This is one environment only; the Android emulator's NAT adds more buffering.
  - **The RN receive path has no flow control.**
    - [`WebSocketModule.kt`](https://raw.githubusercontent.com/facebook/react-native/main/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/websocket/WebSocketModule.kt) `onMessage` calls `sendEvent("websocketMessage", …)` straight from the OkHttp reader thread.
    - `readTimeout(0)` is set, and nothing pauses reading when JS lags.
    - As a result, a slow JS thread (GC, a heavy render) keeps draining TCP. The backlog builds in the device's JS event queue, not in the server's `bufferedAmount`. The server gate never fires for that case, and the "emulator GC pause" rationale describes a condition the mechanism cannot observe.
- **Suggested fix:**
  - Narrow ADR-005's context to "clients whose *network* reads slowly".
  - Record the device-side gap as a known limitation, or as a client-side mitigation to decide separately. For example, `onmessage` could coalesce to the latest batch before committing. That is a design change, so raise it rather than adopting it silently.
  - The ADR-005 test and the stress test must use a raw TCP client that stops reading, not a slow RN app. Soft-limit defaults must account for hundreds of KB of kernel buffering before `bufferedAmount` moves.

### F3: medium. The Reanimated rationale is out of date for the pinned versions

- **Location:** `architecture.md:144-146` ("in Expo SDK 57 / RN ≥ 0.85, importing it inflates Android memory"), `ADR-009:23-24` ("Android memory cost on RN ≥ 0.85").
- **Claim:** Importing Reanimated inflates Android memory on the project's stack.
- **Evidence:**
  - The regression was real: [react-native#57059](https://github.com/react/react-native/issues/57059) (opened 2026-06-03) reports 25-30% more RAM on 0.85.x, and Hermes V1 attached debug metadata to each evaluated worklet.
  - The [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57) says:
    - "the initial SDK 57 release inherited a Hermes V1 regression from SDK 56 that could drastically increase memory usage in apps importing `react-native-worklets` or `react-native-reanimated`"
    - "`expo@57.0.9` updates React Native to 0.86.2, which resolves this regression"
    - Update of Aug 27: "`expo@57.0.17` updates React Native to 0.86.3, resolving the Hermes V1 memory regression"
  - The repo pins `expo@57.0.24` and `react-native@0.86.3` (`pnpm-lock.yaml:1702, 2508`).
  - The local `expo/bundledNativeModules.json` lists `react-native-reanimated 4.5.1` and `react-native-worklets 0.10.1`.
  - On the pinned versions, then, the stated reason is false.
- **Suggested fix:** Keep the decision if it is wanted, but restate the reason. Core `Animated` with the native driver already covers opacity and `scaleX` (F11), and it adds no dependency or worklets/Babel setup. Mention the regression only as history ("fixed in RN 0.86.2; not a factor at 0.86.3"). Otherwise, reopen the choice.

### F4: medium. "React Native's `WebSocket` exposes no ping API" is false

- **Location:** `ADR-008:32`.
- **Claim:** RN `WebSocket` has no ping API, so an app-level heartbeat is used.
- **Evidence:**
  - Installed `react-native@0.86.3`:
    - `Libraries/WebSocket/WebSocket.js:209-215` defines a non-standard `ping()` that calls `NativeWebSocketModule.ping`.
    - On iOS, `React/CoreModules/RCTWebSocketModule.mm:156-158` calls `[socket sendPing:nil]`, which is a real ping frame.
    - On Android, `ReactAndroid/.../websocket/WebSocketModule.kt:306-330` calls `client.send(ByteString.EMPTY)`. That is an empty binary data message, not a ping control frame.
    - No pong event is surfaced to JS on either platform.
  - [RN Networking docs](https://reactnative.dev/docs/network) document only `send()`, `onopen`, `onmessage`, `onerror` and `onclose`.
- **Suggested fix:**
  - Reword the rejection: "RN's non-standard `ping()` sends a ping frame on iOS but an empty binary message on Android, and exposes no pong to JS, so it cannot drive liveness; an app-level heartbeat works identically on both."
  - Have the gateway treat an unexpected binary frame as `error BAD_REQUEST`, not a crash.
  - The decision itself stands.

### F5: medium. Performance and isolation claims asserted without measurement

The rule under test: no performance number and no performance claim unless it was measured. Each of the following is presented as fact:

| Location | Claim | Problem | Fix |
|---|---|---|---|
| ADR-006:28 | "The bottleneck at ~10 msgs/s is render cost, not parse cost" | Unmeasured comparative performance claim. ADR-006:35-36 itself says JSON parse cost is "to be measured" | Reword to "expected to be…; to be measured in the stress test", or cite a measurement |
| ADR-004:34 | "A 10 ms client multiplies its own sends, not others'" | All sessions share one event loop and serialization CPU. A 10 ms client's sends and timers delay other sessions' timers (ADR-004:35-36 admits `setInterval` drift under loop lag). Isolation is asserted, not measured | Say "its own send count; shared event-loop cost is measured via event-loop-delay in the stress test" |
| ADR-005:37-38 | "A healthy client is unaffected, because sessions are independent" | Same shared-event-loop objection; unmeasured | Qualify, and add a stress-test assertion: a healthy client's rate while one client is stalled |
| ADR-010:28 | Hot-path logging "dominates CPU at stress rates" | Plausible, but a measured-sounding claim with no measurement | Soften to "can dominate", or cite engineering-standards evidence |
| architecture.md:58-59, binance-feed.md:25 | 10 depth/s + 1 ticker/s per pair, "about 55 msgs/s" | Correctly labelled *nominal* in architecture.md, and Binance docs confirm 100 ms / 1000 ms update speeds. No finding for architecture.md. binance-feed.md's "about 55 msgs/s" is derived, not observed | none (architecture.md); optional wording fix in the spec |

### F6: medium. Hard limit unreachable through the gated path; the memory bound covers user space only

- **Location:** `architecture.md:95-99`, `ADR-005:13-17, 24`.
- **Claim:**
  - Close when `bufferedAmount > WS_HARD_LIMIT_BYTES`.
  - "Per-client memory is bounded by the hard limit plus one frame."
- **Evidence:**
  - Sends happen only while `bufferedAmount ≤ soft`, so the gated path can never push `bufferedAmount` above `soft + one batch`. The hard-limit branch fires only if some message bypasses the gate. The architecture does not say whether `market.snapshot`, `market.status` (sent "on every change and every `STATUS_INTERVAL_MS`", architecture.md:119) and `error` go through the gate.
  - The bound also excludes kernel socket buffers. T2 above measured about 820 KB absorbed on macOS loopback before user space grew. That memory is not on the Node heap, but it is real, per-connection memory.
- **Suggested fix:**
  - State which message types are gated. `market.status` likely must bypass the gate, so it is what can reach the hard limit.
  - Either derive the bound as `max(soft + largest batch, hard) + largest ungated message`, or drop the hard limit and rely on the skip budget.
  - Say "user-space memory".

### F7: low. The "JS `number` loses nothing" claim is overstated

- **Location:** `architecture.md:222-223`.
- **Evidence:** Local Node run:
  - `Number('1234567890.12345678').toFixed(8)` gives `1234567890.12345672`. Base or quote 24h volume for DOGE/XRP at 8 decimals exceeds the 15-17 significant digits of an IEEE-754 double.
  - `81199.72 - 81199.71` gives `0.00999999999476131`. The server computes `spread` by subtraction (ADR-007:14), so the wire value carries float noise.
  - Prices at these magnitudes do round-trip: `81199.71000000` gives `81199.71`.
- **Suggested fix:** Say "prices round-trip; volumes and derived values may lose trailing digits; the client rounds per pair for display". Unit tests for `spread` should use a tolerance or per-pair rounding.

### F8: low. Node version claimed as "resolved in the lockfile" but not pinned; Node 22 is in maintenance

- **Location:** `ADR-012:6-7` ("Versions below are the resolved versions in `pnpm-lock.yaml`"), `ADR-012:14`, `architecture.md:33`.
- **Evidence:**
  - Node does not appear in `pnpm-lock.yaml`. There is no `engines`, no `.nvmrc` or `.node-version`, and no `devEngines.runtime` (root `package.json` pins only pnpm). `node --version` on the author's machine returns v22.23.0, so the figure is real locally but not enforced.
  - The design depends on Node ≥ 22 for the unflagged global `WebSocket`, which was marked stable in 22.4.0 ([Node v22.4.0 release](https://github.com/nodejs/node/releases/tag/v22.4.0)).
  - [Node release schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json): v22 entered Maintenance on 2025-10-21 and reaches EOL on 2027-04-30. v24 is Active LTS until 2026-10-20.
- **Suggested fix:** Pin the runtime (`devEngines.runtime` or `engines.node: ">=22.4 <23"`, plus `.nvmrc`), and correct ADR-012's provenance sentence for Node. Optionally note the 2027-04-30 EOL.

### F9: low. `ws` 8.21.3 is nested; the root `ws` is 7.5.13

- **Location:** `architecture.md:35` ("on `ws` 8.21.3"), `ADR-012:15`.
- **Evidence:**
  - With `nodeLinker: hoisted`, `node_modules/ws/package.json` is 7.5.13, hoisted from Expo tooling.
  - 8.21.3 lives at `node_modules/@fastify/websocket/node_modules/ws` (and under `@expo/cli`).
  - `apps/api/package.json` does not declare `ws`.
  - Any `import … from 'ws'` in `apps/api` (for `WebSocket.OPEN`, types, or an upstream client per F1) would silently resolve to 7.5.13. This is the phantom-dependency risk that ADR-012:44 accepts in general.
- **Suggested fix:** Add a rule: the API never imports `ws` directly, or declares `ws@8.21.3` (plus `@types/ws`) with a one-line justification. The `bufferedAmount` getter is the same in 7.5.13 (`node_modules/ws/lib/websocket.js:105-109`), so ADR-005 is unaffected today.

### F10: low. AsyncStorage version must come from Expo, not npm `latest`

- **Location:** `ADR-009:19, 38-39`; `architecture.md:132`.
- **Evidence:**
  - The local `expo/bundledNativeModules.json` lists `"@react-native-async-storage/async-storage": "2.2.0"` for SDK 57, which is what Expo Go ships.
  - `npm view` shows `latest` = 3.1.1 (modified 2026-05-29). A plain `pnpm add` would pull the v3 major, whose native side does not match Expo Go.
  - Zustand 5.0.15 (peer `react >=18`) and @tanstack/react-query 5.103.1 (peer `react ^18 || ^19`) from `npm view` are compatible with React 19.2.3. Neither is installed yet (`apps/mobile/package.json`).
- **Suggested fix:** In ADR-009, say AsyncStorage **must** be installed with `npx expo install` (2.2.0 on SDK 57). Record the Zustand 5.x and TanStack Query 5.x majors when they are added, and note the new dependencies with justification per AGENTS.md.

### F11: low. `scaleX` depth bars need a transform origin

- **Location:** `architecture.md:144-145`, `ADR-009:23`.
- **Evidence:**
  - Native-driver support is confirmed. [RN Animations docs](https://reactnative.dev/docs/animations): "you can only animate non-layout properties: things like `transform` and `opacity` will work, but Flexbox and position properties will not". `width` cannot use the native driver, so choosing `scaleX` is correct.
  - However, `scaleX` scales about the view's centre by default. Anchoring a bar to one edge needs the `transformOrigin` style (available since RN 0.73) or a compensating `translateX`.
- **Suggested fix:** Add "anchor with `transformOrigin` (left for bids, right for asks)" to §6, so the implementer does not rediscover it.

### F12: low. The auto-pong assumption is now verified; update the wording

- **Location:** `ADR-008:19, 38-39` ("That the runtime answers pings automatically is an assumption to verify in a long soak run"), `architecture.md:108`.
- **Evidence:**
  - [undici `lib/web/websocket/receiver.js`](https://raw.githubusercontent.com/nodejs/undici/main/lib/web/websocket/receiver.js) says: "Upon receipt of a Ping frame, an endpoint MUST send a Pong frame in response…" and writes `opcodes.PONG` with the same payload.
  - The same code is present in the Node v22.23.0 binary (`strings $(which node)` shows the `opcode === opcodes.PING` branch writing a PONG frame).
  - Local T1: a ws server `ping('hello')` to a Node global `WebSocket` produced a `pong` with payload `hello`.
  - This matches Binance's requirement: "When you receive a ping, you must send a pong with a copy of ping's payload as soon as possible" ([Binance WebSocket Streams](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md)).
- **Suggested fix:** Change it to "verified (undici source + local test, 2026-09-19); a soak run confirms the 24 h behaviour". This is not a defect; it closes the open assumption.

---

## Verified: no finding

| Claim | Location | Verification |
|---|---|---|
| Binance server pings every 20 s and disconnects without a pong within 1 min; 24 h connection limit | binance-feed.md:26, ADR-008:21 | [binance-spot-api-docs web-socket-streams.md](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/web-socket-streams.md): "ping frame every 20 seconds", disconnect if no pong "within a minute", "only valid for 24 hours" |
| Combined-stream wrapper `{"stream","data"}`, lowercase names, 1024 streams per connection | ADR-001:12-14, 33 | Same source |
| `depth20@100ms` payload is `lastUpdateId`, `bids`, `asks` (no symbol, no event time); ticker at 1000 ms | ADR-001:5-8, ADR-002, architecture.md:58 | Same source (partial book depth: "1000ms or 100ms"; ticker "1000ms"), plus the spike sample in binance-feed.md:18 |
| `data-stream.binance.vision` is a market-data-only host | binance-feed.md:8, architecture.md:191 | Same source |
| Fast retries risk limits | ADR-008:18 | Binance: "300 connections per attempt every 5 minutes per IP"; 5 incoming messages/s. The 1 s / 30 s backoff stays well within this |
| HTTP 451 for US IPs | architecture.md:159, ADR-011:6 | Community reports since Nov 2022 ([QuantConnect](https://www.quantconnect.com/forum/discussion/14508/binance-support-just-said-that-they-are-no-longer-working-with-us-based-ips/), [binance-to-google-sheets#142](https://github.com/diegomanuel/binance-to-google-sheets/issues/142)). Not in official docs; see F1 on detectability |
| Close code 4008 is valid for application use | architecture.md:98, ADR-005:17 | RFC 6455 §7.4.2 reserves 4000-4999 for private use. `ws` `isValidStatusCode` accepts 3000-4999 (`lib/validation.js:37-45`). Local T3: the client received `4008 "slow consumer"` |
| `ws` `bufferedAmount` semantics on the server | ADR-005:11 | ws 8.21.3 source plus docs (see F2 for scope limits) |
| @fastify/websocket 11 handler receives a `ws` `WebSocket` | architecture.md:35 | [fastify-websocket README](https://github.com/fastify/fastify-websocket/blob/main/README.md) `(socket /* WebSocket */, req)` |
| Pinned versions: pnpm 12.4.2, Expo 57.0.24, RN 0.86.3, React 19.2.3, TS 6.0.3, Fastify 5.12.5, @fastify/websocket 11.3.1, ws 8.21.3, Zod 4.6.5 (and 3.25.76 from Expo), tsx 4.23.13, ESLint 10.10.0, Metro 0.84.6 | ADR-012:11-16, architecture.md:33-35 | Match `pnpm-lock.yaml` (lines 961, 1602, 1702, 1755, 2257, 2508, 2526, 2801, 2825, 2928, 2983) and `package.json` files |
| typescript-eslint 8.70.0 supports TS 6.0.3 and ESLint 10 | ADR-012 (implicit) | Peer range `typescript >=4.8.4 <6.1.0`, `eslint ^10.0.0` (installed package.json) |
| Workspace and Metro rules | ADR-012:21-29 | Match `pnpm-workspace.yaml` (`nodeLinker: hoisted`, `allowBuilds: esbuild`), root `zod` pin, and `apps/mobile/metro.config.js` |
| Expo SDK 57 ships RN 0.86 with React 19.2 | architecture.md, stack.md | [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57) |
| MMKV is not in Expo Go | ADR-009:34 | Not listed in `expo/bundledNativeModules.json` (SDK 57) |
| Core `Animated` native driver supports opacity and transform, not width | architecture.md:144-145 | [RN Animations docs](https://reactnative.dev/docs/animations); see F11 |
| `perf_hooks.monitorEventLoopDelay` | architecture.md:174 | Node core API, present in Node 22 |

## Not verifiable in this pass

- **Expo Go exposing a Hermes heap reading** (architecture.md:181, ADR-010:18). The docs already make this conditional ("shown only if"), which is correct under the measured-metrics rule.
- **"pnpm 12 ignores `.npmrc` for `nodeLinker`"** (ADR-012:23). Recorded as observed in the skeleton; not re-checked against pnpm 12 docs.
