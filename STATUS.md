# STATUS

**Last tagged release:** `v5.3.2` (`2026-03-15`)
**Current package version on `main`:** `v5.3.3`
**Playback truth:** `main`
**Runtimes:** Node.js 22.x, Bun, Deno
**Current planning method:** [WORKFLOW.md](./WORKFLOW.md)
**Live backlog:** [docs/method/backlog/README.md](./docs/method/backlog/README.md)

---

`STATUS.md` is a compact snapshot, not the active planning surface.

## Honest State

- The human CLI and TUI are real and materially shipped.
- The machine-facing `git cas agent` surface exists, but parity and
  portability are still partial.
- `framed-v1` now provides an authenticated streaming encrypted restore path;
  `whole-v1` remains the compatibility whole-object mode with buffered
  restore semantics.
- Fresh work is now organized through METHOD backlog lanes and numbered cycle
  directories.

## Active Queue Snapshot

- [TR — Empty-State Phrasing Consistency](./docs/method/backlog/asap/TR_empty-state-phrasing-consistency.md)
- [TR — Streaming Encrypted Restore](./docs/method/backlog/up-next/TR_streaming-encrypted-restore.md)
- [TR — Platform-Agnostic CLI Plan](./docs/method/backlog/up-next/TR_platform-agnostic-cli-plan.md)
- [TR — CasService Decomposition Plan](./docs/method/backlog/bad-code/TR_casservice-decomposition-plan.md)

## Read Next

- [docs/method/process.md](./docs/method/process.md)
- [docs/design/README.md](./docs/design/README.md)
- [ROADMAP.md](./ROADMAP.md)
