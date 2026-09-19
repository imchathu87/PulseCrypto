# ADR-012: pnpm workspace monorepo and toolchain

## Context

API and mobile share one wire contract. Written **from the walking-skeleton outcome** (commit
`b21a370`, PR #1; strict flags and boundaries in `fa8c7a1`), not predicted. Package versions are those resolved in `pnpm-lock.yaml`. Node is the
runtime the skeleton ran on (`node -v`); Story 1.1 pinned it (see Decision).

## Decision

| Tool | Version | Tool | Version |
|---|---|---|---|
| pnpm | 12.4.2 (`packageManager`, `devEngines`) | Expo SDK | 57.0.24 |
| Node | 22.23.0 | React Native / React | 0.86.3 / 19.2.3 |
| TypeScript | 6.0.3 (Expo pins ~6.0.3) | Fastify / @fastify/websocket | 5.12.5 / 11.3.1 (ws 8.21.3) |
| Zod | 4.6.5, pinned at root | tsx / ESLint | 4.23.13 / 10.10.0 |

Layout: `apps/api`, `apps/mobile`, `packages/contracts` (exports TS source, no build step).
The rules below each come from a real failure in the skeleton:

```yaml
# pnpm-workspace.yaml
nodeLinker: hoisted        # pnpm 12 ignores .npmrc for this; isolated linker broke Metro
allowBuilds: { esbuild: true }   # required by tsx
```

- `zod` pinned in the root `package.json`, otherwise Expo CLI's zod 3.25 hoists and Metro bundles v3.
- Metro: `watchFolders=[workspaceRoot]`, `nodeModulesPaths=[app, root]`, `disableHierarchicalLookup=true`.
- Both apps import runtime schemas from contracts, so Metro resolution is exercised, not just types.
- API runs TS directly with `tsx`; `tsc` is typecheck-only.
- `ws` 8.21.3 is declared directly in `apps/api` (ADR-008); the hoisted root `ws` is 7.5.13, so
  nothing relies on the transitive copy.
- Node is pinned by root `engines.node` `>=22.13 <23` and `.nvmrc` (`22`), from Story 1.1. The floor is
  22.13, not 22.4, because the locked ESLint 10.10.0 requires `^22.13.0` (human decision, 2026-09-19).
  Node 22 reaches end of life on 2027-04-30.

## Alternatives considered

| Option | Rejected because |
|---|---|
| npm / yarn workspaces | pnpm was proven end to end; no reason to re-spike |
| pnpm isolated linker | Broke Metro with hierarchical lookup disabled (observed) |
| Nx / Turborepo | Three packages; task orchestration adds nothing |
| Build step for contracts | Unnecessary; both runtimes consume TS source |
| Two repos + published contract package | Version skew is the failure a shared package prevents |

## Consequences

- **Trade-offs:** hoisting loosens dependency isolation (phantom deps possible), accepted for Metro.
- **Failure modes:** an Expo SDK upgrade can move its zod or TS pins; re-run the skeleton checks.
- **Migration:** revisit the isolated linker when Metro supports it with hierarchical lookup disabled.

## Status

Accepted (adopted from skeleton outcome). Requirements: CAP-4, CAP-16, NFR-1, NFR-2.

Amended 2026-09-19 (Story 1.1, human decision): Node floor raised to 22.13; see `docs/ai/ai-development-log.md`.
