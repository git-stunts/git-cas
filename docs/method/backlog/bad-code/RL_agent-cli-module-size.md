# RL: Agent CLI is carrying parser, protocol, and command execution in one module

- **File**: `bin/agent/cli.js`
- **Severity**: Medium
- **Category**: Machine-surface maintainability
- **Status**: Resolved for v6.0.0

## Description

`bin/agent/cli.js` used to be over 2,200 lines and owned request parsing, input
normalization, protocol session writes, command dispatch, credential resolution,
filesystem input reads, and every agent command implementation.

## Why It Bothers Us

The agent surface is supposed to be a stable machine contract. Large mixed
modules make it harder to reason about protocol behavior versus command behavior
and increase the risk that a small command change alters JSONL framing or error
semantics.

## Follow-Up

- [x] Move command implementations under `bin/agent/commands/`.
- [x] Keep protocol/session handling in `bin/agent/cli.js`.
- [x] Move shared request parsing into `bin/agent/input.js`.
- [x] Add a module-boundary test that `bin/agent/cli.js` no longer imports the CAS
  facade directly.

## Resolution

The agent entrypoint now resolves command names, creates the JSONL protocol
session, maps exceptions to stable exit codes, and delegates implementation to
`executeAgentCommand()` in `bin/agent/commands/index.js`. Shared request parsing,
local input-file reads, credential-source validation, and start-payload
sanitization live in `bin/agent/input.js`, with
`test/unit/cli/agent-module-boundary.test.js` preserving the boundary.
