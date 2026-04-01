# TR-015 — Platform-Agnostic CLI Plan

## Legend

- [TR — Truth](../legends/TR-truth.md)

## Why This Exists

`git-cas` already maintains a real Node, Bun, and Deno test matrix, but the
human CLI entrypoint is still a Node-specific launcher.

[bin/git-cas.js](../../bin/git-cas.js) depends directly on:

- the `#!/usr/bin/env node` launcher model
- `node:` built-ins for file, path, URL, and readline behavior
- direct `process` access for argv, env, stdin, stdout, and stderr
- Node-oriented file helpers and prompt flows under `bin/` and `src/`

That means the repo is closer to "runtime-tested core with a Node CLI" than to
"portable command surface with multiple distribution options."

## Target Outcome

Produce a design-backed plan for making the CLI runtime-neutral at the command
core while being honest about distribution realities, including:

- what must move out of the Node-specific launcher
- what runtime adapter boundary should exist for argv, stdio, prompts, file
  access, and exit behavior
- whether file-backed store/restore helpers should stay Node-only or move
  behind a portable interface
- what `@git-stunts/plumbing` assumptions still block true portability
- how per-platform packaged binaries should follow after the runtime boundary is
  clean

## Human Value

Maintainers should be able to reason clearly about what "platform agnostic"
means here, what work is required to get there, and whether the repo should aim
for multi-runtime source portability, compiled binaries, or both.

## Agent Value

Agents should be able to propose bounded follow-on work around CLI portability
without hand-waving past the current Node-specific launcher, TTY helpers, and
Git runner assumptions.

## Linked Invariants

- [I-001 — Determinism, Trust, And Explicit Surfaces](../invariants/I-001-determinism-trust-and-explicit-surfaces.md)

## Notes

- distinguish runtime-agnostic command logic from platform-specific binary
  packaging
- prefer a small runtime adapter boundary over scattering `globalThis.Bun` /
  `globalThis.Deno` checks throughout command code
- treat Git runner behavior and subprocess semantics as first-class constraints,
  not an afterthought
- do not promise a single universal binary; prefer a portable codebase with
  explicit per-platform artifacts if packaging is pursued
