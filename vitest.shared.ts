/**
 * Shared Vitest base config for `apps/api` and `packages/contracts` (testing-strategy.md).
 *
 * Fake-timer rule:
 * - Use fake timers for every test involving broadcast cadence, reconnect backoff or the
 *   status heartbeat. Never test a 100 ms interval against real time.
 * - In tests with real sockets, fake only `setTimeout`, `setInterval` and `Date`:
 *   `vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] })`.
 *   Faking `setImmediate` or `nextTick` stalls socket I/O.
 *
 * No coverage threshold, deliberately (testing-strategy.md).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    restoreMocks: true,
  },
});
