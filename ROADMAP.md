# ROADMAP

This file is sequence context, not active planning truth.

Fresh planning now follows the METHOD:

- [WORKFLOW.md](./WORKFLOW.md)
- [docs/method/process.md](./docs/method/process.md)
- [docs/method/backlog/README.md](./docs/method/backlog/README.md)
- [docs/design/README.md](./docs/design/README.md)
- [docs/method/retro/README.md](./docs/method/retro/README.md)

## Current Reality

- **Last tagged release:** `v6.0.0` (`2026-05-09`)
- **Current release line:** `v6.x` maintenance on `main`
- **Supported runtimes:** Node.js 22.x, Bun, Deno
- **Human surface reality:** the human CLI and TUI are substantial and already
  ahead of some older planning docs.
- **Agent surface reality:** a first-class `git cas agent` contract now exists
  for shipped Relay flows, but breadth and portability are still incomplete.
- **Planning reality:** fresh work is now chosen from METHOD backlog lanes, not
  milestone fiction.
- **Release posture:** npm and GitHub Releases are the active v6.0.x
  publication surfaces. JSR publication is deferred until the upstream
  `jsr`/Deno dry-run blocker is fixed.

## Current Queue Snapshot

See the live backlog for exact lane placement:

- [TUI — v6.x TUI Modernization](./docs/method/backlog/v6.x-tui/TUI_store-wizard.md)
- [Vault Tree Memory Loading](./docs/method/backlog/bad-code/vault-tree-memory-loading.md)
- [TR — GitPersistenceAdapter Full Materialization](./docs/method/backlog/bad-code/TR_persistence-adapter-materialization.md)

## How To Read This File

Use this file for:

- broad sequencing context
- release-line context
- historical orientation

Do not use it as the active backlog.

For shipped history, use:

- [CHANGELOG.md](./CHANGELOG.md)
- [docs/design/README.md](./docs/design/README.md)
- [docs/archive/BACKLOG/README.md](./docs/archive/BACKLOG/README.md)
