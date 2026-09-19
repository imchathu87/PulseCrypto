# Git Strategy

## Branching

```
main
 ├── feature/<story-id>-<short-description>
 ├── fix/<story-id>-<short-description>
 ├── test/<story-id>-<short-description>
 ├── docs/<short-description>
 └── refactor/<short-description>
```

Examples: `feature/STORY-MKT-001-binance-adapter`, `feature/STORY-MKT-003-bounded-broadcast`,
`feature/STORY-MOB-002-watchlist`, `fix/STORY-RES-001-reconnect-backoff`.

One story per branch. Branch from current `main`, never from another feature branch.

## Conventional commits

Types: `feat` `fix` `perf` `test` `docs` `refactor` `chore`.
Scopes: `api` `mobile` `contracts` `ci` `architecture`.

```
feat(api): add Binance market data adapter
fix(api): prevent slow websocket consumers from growing buffers
perf(mobile): reduce market row rerenders
test(api): add high-frequency market stress test
docs(architecture): document websocket backpressure strategy
```

Every commit body references the requirement IDs it implements (`CAP-n` from the spec).

## Flow

```
Story → branch → AI-assisted implementation → local tests → AI code review →
Graphify impact check (structural changes only) → human review → PR → CI → merge
```

The human opens the PR. The agent never opens one.

## PR description: template and the mechanism that fills it

`.github/pull_request_template.md` defines the sections: Story / requirement IDs · Summary ·
Architecture impact · Screenshots or video · Test commands and results · Performance
implications · Known limitations · AI assistance used.

A template does not fill itself, so the agent's **final commit** on a branch carries it:
conventional-commit subject, blank line, then every template section populated. The human
then creates the PR from that commit:

```sh
gh pr create --draft --title "$(git log -1 --format=%s)" --body "$(git log -1 --format=%b)"
```

The human edits the draft and marks it ready. Plain `gh pr create --fill` is equivalent **only
when the branch has exactly one commit**; with several, gh titles the PR from the branch name
and fills the body with a list of commit subjects instead.

**Agent rule.** When a story's implementation and review are complete, produce that final commit
with every section filled from work actually done: real test commands and their real output, real
files changed, real requirement IDs. A section with nothing to report says `none`; never invent
content. Any performance claim cites `docs/verification/stress-results.md`. Commit with
`git commit --cleanup=whitespace -F <file>`, never via the editor: editor cleanup deletes
every line starting with `#`, including the `## ` headings.

Worked example (format illustration):

```
feat(api): add 100ms websocket batching

## Story / requirement IDs
STORY-MKT-003 · CAP-2, CAP-3

## Summary
Upstream frames now update a per-pair latest-value buffer; a single 100ms timer
(BROADCAST_INTERVAL_MS) serializes one snapshot per pair and broadcasts it. Clients whose
socket bufferedAmount exceeds 1 MiB are skipped for that tick and counted.

## Architecture impact
None. Implements the existing broadcast ADR; no boundary changes.
Files: src/application/broadcast-scheduler.ts, src/application/latest-value-buffer.ts,
src/composition-root.ts, test/broadcast-scheduler.test.ts

## Screenshots or video
none

## Test commands and results
pnpm --filter @pulsecrypto/api lint       -> 0 problems
pnpm --filter @pulsecrypto/api typecheck  -> 0 errors
pnpm --filter @pulsecrypto/api test       -> 12 passed, 0 failed

## Performance implications
Emission rate is fixed at ~10/s per client regardless of upstream burst; memory stays flat
with a stalled client over 60s. See docs/verification/stress-results.md, run 2026-09-21.

## Known limitations
Slow clients are skipped, not disconnected; the disconnect threshold is STORY-MKT-004.

## AI assistance used
Claude Code implemented the scheduler and tests; AI code review found a timer leak on
shutdown (fixed, covered by test). Human reviewed the diff and the skip threshold.
```

## Hygiene

- No secrets, no `.env` files, no API keys committed. Binance public market streams need no
  key, so the project has no credentials at all — a genuine simplification.
- Rebase on `main` before opening a PR; no merge commits into feature branches.
- Squash on merge; the squashed message is the final commit above. Set the repo's squash
  default to "Pull request title and description" so GitHub uses it unchanged.
- Tag milestones: `v0-skeleton`, and a submission tag at the end.
