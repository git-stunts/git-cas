# RL: Agent CLI is carrying parser, protocol, and command execution in one module

- **File**: `bin/agent/cli.js`
- **Severity**: Medium
- **Category**: Machine-surface maintainability

## Description

`bin/agent/cli.js` is over 2,200 lines and currently owns request parsing,
input normalization, protocol session writes, command dispatch, credential
resolution, filesystem input reads, and every agent command implementation.

## Why It Bothers Us

The agent surface is supposed to be a stable machine contract. Large mixed
modules make it harder to reason about protocol behavior versus command behavior
and increase the risk that a small command change alters JSONL framing or error
semantics.

## Follow-Up

- Move command implementations under `bin/agent/commands/`.
- Keep protocol/session handling in `bin/agent/cli.js`.
- Move shared request parsing into `bin/agent/input.js`.
- Add a module-boundary test that `bin/agent/cli.js` no longer imports the CAS
  facade directly.
