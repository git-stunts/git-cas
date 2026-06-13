# SEC: Inline passphrase flags remain a normal documented path

- **Status**: Resolved for v6 warning/documentation risk; major-version removal
  remains optional future hardening
- **Files**: `bin/git-cas.js`, `GUIDE.md`, `docs/API.md`, `docs/WALKTHROUGH.md`
- **Severity**: High
- **Category**: Secret exposure footgun

## Description

The human CLI still accepts and documents inline passphrase flags such as
`--vault-passphrase <pass>`, `--old-passphrase <pass>`, and
`--new-passphrase <pass>`.

The docs often recommend safer alternatives, but the inline flags still appear
as ordinary usage paths.

## Why It Bothers Us

Command-line arguments can leak through shell history, process listings, CI
logs, terminal transcripts, and copy-pasted runbooks. The safer paths already
exist: passphrase files/stdin, `GIT_CAS_PASSPHRASE`, and OS keychain lookup.

## Follow-Up

- Done: emit a warning whenever a human CLI inline passphrase flag is used.
- Done: make maintained docs examples prefer file/stdin/keychain/env sources.
- Done: add CLI-unit tests for warning behavior and non-warning safe sources.
- Optional next-major hardening: require an explicit
  `--allow-insecure-passphrase-arg` escape hatch or remove inline secret flags.
