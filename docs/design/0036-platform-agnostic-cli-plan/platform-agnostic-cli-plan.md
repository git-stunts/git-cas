# 0036-platform-agnostic-cli-plan

## Title

Produce a design-backed plan for a platform-agnostic CLI core

## Why

`git-cas` ships a multi-runtime-tested core, but the current CLI entrypoint is
still a Node launcher with Node-specific process, file, prompt, and subprocess
assumptions.

That leaves the repo in an in-between state: portable storage logic with a
human command surface that is still fundamentally Node-oriented.

## Current Reality

Today the CLI stack is split like this:

- `bin/git-cas.js` is a Node launcher with a `#!/usr/bin/env node` contract,
  Commander wiring, direct `process` access, and Node built-ins for path, URL,
  fs, and stdio.
- `bin/agent/cli.js` is also Node-oriented, even though its JSONL contract is
  runtime-neutral in spirit.
- `src/infrastructure/createGitPlumbing.js` already exposes one portability
  seam, but it still depends on `@git-stunts/plumbing` and a Node-backed runner
  model in practice.
- file-backed store and restore helpers under `bin/` and `src/` are still
  written around Node streams and path semantics.

## Decision

Treat “platform-agnostic CLI” as a code-structure goal first, and a packaging
goal second.

The target is:

- one runtime-neutral command core
- one explicit runtime adapter boundary
- separate launcher and packaging artifacts per platform as needed

The target is not:

- a single magical universal binary
- scattered `globalThis.Bun` / `globalThis.Deno` checks through command code
- pretending that portable CAS logic automatically means portable subprocess
  behavior

## Proposed Boundary

### 1. Command Core

Move command orchestration into a runtime-neutral core that deals in:

- validated input objects
- structured result objects
- explicit warnings and errors
- no direct `process`, `fs`, or TTY branching

This core should own:

- slug / manifest / tree target resolution rules
- store / restore / verify / rotate command semantics
- agent JSONL result shaping
- shared validation and error mapping logic

### 2. Runtime Adapter

Introduce a small adapter boundary for:

- argv and environment access
- stdin / stdout / stderr streams
- TTY prompt behavior
- path and file reads / writes
- exit-code handling
- clock and flush behavior where needed

This keeps runtime choices explicit instead of diffusing them through every
command.

### 3. Git Adapter

Keep `@git-stunts/plumbing` behind an explicit Git runner boundary.

Portable command code does not remove the need to answer:

- how `git` subprocesses are launched on Node, Bun, and Deno
- whether Bun or Deno should use native subprocess APIs or the Node-compatible
  runner path
- which runtime still depends on Node compatibility shims even after the CLI
  core is extracted

`src/infrastructure/createGitPlumbing.js` is the current foothold for this
boundary.

## Recommended Shape

### A. Launcher Layer

Keep tiny launchers such as:

- `bin/git-cas.js` for Node
- future Bun / Deno launcher entrypoints only when actually needed

Launcher responsibilities:

- parse raw argv
- attach the runtime adapter
- delegate into the shared command core
- set final exit behavior

### B. Shared CLI Core

Extract shared command logic into a runtime-neutral module tree, for example:

- `src/cli/core/`
- `src/cli/runtime/`

Suggested seams:

- `CliRuntimeAdapter`
- `CliFileAdapter`
- `CliPromptAdapter`
- `CliGitAdapter`

The exact names are less important than making the boundaries small and
obvious.

### C. Presentation Layer

Keep presentation-specific code separate from command semantics:

- human table / card / progress rendering
- agent JSONL framing
- TUI surfaces

That lets the repo share storage semantics while preserving different UX
contracts.

## Phased Plan

### Phase 1 — Extract Pure Command Handlers

Move shared validation and command orchestration out of `bin/git-cas.js` and
`bin/agent/cli.js` into pure handlers that accept dependencies instead of
touching `process` directly.

### Phase 2 — Runtime Adapter Introduction

Create a runtime adapter for:

- stdio
- prompt capability
- environment lookups
- exit handling
- path and file access

This is the point where Node-specific launchers can shrink sharply.

### Phase 3 — File I/O Boundary

Decide whether file-backed store / restore remain Node-only helpers or move
behind a portable file adapter.

Recommendation:

- keep byte-stream CAS operations portable
- move file-path convenience operations behind an adapter instead of forcing
  Node fs calls into the command core

### Phase 4 — Git Runner Boundary

Make the `git` subprocess contract explicit:

- what is guaranteed cross-runtime
- what still depends on Node-backed runner behavior
- what future `@git-stunts/plumbing` work would be required for stronger
  portability

### Phase 5 — Packaging Strategy

Only after the code boundary is clean should the repo decide which artifacts to
ship:

- Node npm bin
- Bun launcher
- Deno launcher
- packaged binaries, if later justified

## Consequences

### Good

- CLI portability work becomes incremental instead of invasive
- agent and human surfaces can share more logic without sharing presentation
- runtime-specific behavior becomes inspectable instead of implicit

### Costs

- short-term extraction work before any flashy binary story
- more explicit adapter plumbing in command code
- no dishonest claim that the current CLI is already runtime-neutral

## Next Moves

This plan points directly at the existing debt items:

- `TR — Platform Dependency Leaks`
- `TR — CasService Decomposition Plan`

If CLI portability becomes the next implementation lane, the first concrete
execution slice should be:

1. extract a runtime-neutral command core for store / restore / verify
2. introduce a runtime adapter for stdio, env, and prompt behavior
3. keep Node launchers thin until other runtimes earn their own wrappers

## Playback Questions

1. Does the repo now state plainly that the current CLI is Node-oriented even
   though the core CAS logic is multi-runtime-tested?
2. Is there a concrete adapter boundary for argv, stdio, prompt, file, exit,
   and Git runner behavior?
3. Does the plan separate runtime-neutral command logic from platform-specific
   launcher and packaging concerns?
4. Does the plan point follow-on execution toward existing portability and
   decomposition debt instead of inventing a vague new portability track?

## Red Tests

Planning truth for this cycle is covered by:

- `test/unit/docs/planning-surfaces.test.js`

## Green Shape

Replace the hand-wavy portability card with a concrete plan that maintainers
and agents can execute against without pretending the current CLI is already
runtime-neutral.
