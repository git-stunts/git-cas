# @git-stunts/git-cas — Project Status

**Last tagged release:** `v5.3.2` (`2026-03-15`)
**Current package version on `main`:** `v5.3.3`
**Playback truth:** `main`
**Runtimes:** Node.js 22.x, Bun, Deno
**Current strategic focus:** agent-first for the next few cycles

---

## Honest State

- The human CLI/TUI is already real and ahead of the old planning docs.
- M17 closeout work is materially on `main`, even though the release/docs
  bookkeeping drifted.
- Early repo-explorer and TUI refresh work also landed on `main` ahead of the
  old sequence.
- The biggest product gap is now the missing first-class agent CLI.

---

## Two Surfaces

- **Human CLI/TUI:** stable operator surface, boring by default, `--json` kept
  as convenience structured output for humans and simple scripts.
- **Agent CLI:** next priority surface, JSONL-first, non-interactive, and
  separate from the human `--json` path.

---

## Current Hills

### Human Hill

A human operator can store, inspect, verify, restore, and manage artifacts with
confidence and without memorizing Git plumbing.

### Agent Hill

A coding agent, CI job, or release bot can execute core `git-cas` workflows
through a stable machine contract without scraping prose or depending on TTY
behavior.

---

## Next Up

### M18 — Relay (`v5.4.0` target)

**Sponsor user**

- Maintainer or release engineer building automation around `git-cas`

**Sponsor agent**

- Coding agent, CI job, release bot, or backup workflow

**Hill**

- Read-heavy `git-cas` operations become available through a first-class
  JSONL-first machine protocol with explicit exit-code semantics.

**Immediate work order**

1. protocol design doc
2. contract tests
3. dedicated machine runner
4. read-heavy command parity

### Relay Follow-through (`v5.5.0` target)

- Stay agent-first until state-changing flows are also credible for automation.

### M19 — Nouveau (after Relay is credible)

- Resume major human-surface work only after the agent surface has forced
  cleaner app-layer boundaries.

---

## Sequence Snapshot

| Order | Focus                                                       |
| ----- | ----------------------------------------------------------- |
| Now   | Relay foundation                                            |
| Next  | Relay follow-through                                        |
| Then  | Nouveau                                                     |
| Later | Sentinel, Atelier, Cartographer, Courier, Spectrum, Bastion |

---

_Future detail: [ROADMAP.md](./ROADMAP.md) | Shipped detail: [COMPLETED_TASKS.md](./COMPLETED_TASKS.md) | Release history: [CHANGELOG.md](./CHANGELOG.md)_
