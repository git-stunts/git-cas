# RL: Credential Resolution Duplication

- **File**: `bin/git-cas.js`, `bin/agent/commands/index.js`, `bin/agent/input.js`
- **Severity**: Medium
- **Category**: release-line maintainability

## Description

The human CLI and machine-facing agent carried separate implementations for
raw key-file reads, vault passphrase-source validation, passphrase-derived vault
key derivation, and encrypted-restore input classification. The duplicated
logic increased the risk that v6 credential behavior would drift between
operator-facing commands and Relay/agent protocol commands.

## Fix

Extracted shared credential helpers into `bin/credentials.js`. The human CLI
now delegates key-file reads, ambiguous credential-source validation, and vault
passphrase-derived key resolution through that module. The agent delegates the
same core validation and store/restore encryption-key resolution while retaining
agent-specific protocol errors and `NEEDS_INPUT` metadata.

## Status

- [x] Resolved — v6.0.0 final polishing
