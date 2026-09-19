# Stack and Toolchain

Proven end-to-end by the walking-skeleton spike (branch `feature/walking-skeleton`).

## Versions in use

pnpm 12.4.2 · Node 22.23.0 · TypeScript 6.0.3 (Expo SDK 57 pins ~6.0.3) · Expo SDK 57.0.24 · React Native 0.86.3 · React 19.2.3 · Metro 0.84.6 · Fastify 5.12.5 · @fastify/websocket 11.3.1 · Zod 4.6.5 · tsx 4.23.13.

## Layout

- `apps/api` — Fastify service, run with `tsx`.
- `apps/mobile` — Expo app (Expo Go).
- `packages/contracts` — shared Zod schemas and inferred types; exports TS source directly (`"exports": { ".": "./src/index.ts" }`), no build step.

## Toolchain rules (each learned from a real failure)

- `nodeLinker: hoisted` must be set in `pnpm-workspace.yaml`; pnpm 12 ignores `.npmrc` for this. The isolated linker breaks Metro when hierarchical lookup is disabled.
- `zod` is pinned at the workspace root; otherwise Expo CLI's zod 3.25 is hoisted and Metro bundles v3 into `contracts`.
- Metro config: `watchFolders = [workspaceRoot]`, `resolver.nodeModulesPaths = [app/node_modules, root/node_modules]`, `resolver.disableHierarchicalLookup = true`.
- Import runtime values (schemas) from `contracts` in both apps, not only `import type`, so Metro resolution is actually exercised.
- `allowBuilds: esbuild: true` in `pnpm-workspace.yaml` (required by tsx).

## Networking

- Android emulator reaches the host at `10.0.2.2`; iOS simulator at `localhost`; physical devices need the LAN IP. The app's backend URL is configurable and platform-aware.
- The backend listens on `0.0.0.0:8080`.
- The upstream Binance URL comes from env config.
