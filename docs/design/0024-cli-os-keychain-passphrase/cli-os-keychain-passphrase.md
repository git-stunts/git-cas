# 0024-cli-os-keychain-passphrase

## Title

Human CLI OS-keychain passphrase lookup via `@git-stunts/vault`

## Why

The human CLI already supports vault passphrases from:

- `--vault-passphrase`
- `--vault-passphrase-file`
- `GIT_CAS_PASSPHRASE`
- interactive prompt

That works, but it keeps long-lived secrets in shells, env files, or ad hoc
files. The sibling `@git-stunts/vault` package already provides OS-native secret
storage. The clean next step is to let the human CLI fetch the vault passphrase
from the OS keychain without changing the core `git-cas` library API.

## Decision

Add a CLI-only passphrase source:

- `--os-keychain-target <target>`
- `--os-keychain-account <account>` with default account `git-cas`

This integrates only with the human CLI passphrase resolution path used by:

- `store`
- `restore`
- `vault init`

The library remains explicit. Callers still pass `encryptionKey` or
`passphrase` directly.

## Rules

Passphrase source precedence becomes:

1. `--vault-passphrase-file`
2. `--vault-passphrase`
3. `--os-keychain-target`
4. `GIT_CAS_PASSPHRASE`
5. interactive TTY prompt

Validation rules:

- `--vault-passphrase`, `--vault-passphrase-file`, and `--os-keychain-target`
  are mutually exclusive
- `--os-keychain-account` requires `--os-keychain-target`
- `--key-file` remains mutually exclusive with any explicit vault passphrase
  source
- explicit OS-keychain lookup must fail loudly when the secret is missing or
  empty; it must not silently fall through to env or prompt

## Playback Questions

1. Can the human CLI source a vault passphrase from the OS keychain without
   changing the library API?
2. Do explicit passphrase-source conflicts now include the OS-keychain target?
3. Does an explicit OS-keychain target fail clearly when the secret is missing
   or empty?
4. Do `store`, `restore`, and `vault init` still use the same downstream key
   derivation flow once a passphrase is resolved?

## Red Tests

The spec lives in:

- `test/unit/cli/passphrase-source.test.js`

Those tests must fail first for:

- OS-keychain target resolution
- explicit-source conflict validation
- missing/empty OS-keychain secret behavior
- account defaulting and account/target validation

## Green Shape

Implement a small CLI helper module for passphrase resolution and wire the human
CLI commands through it. Keep `@git-stunts/vault` out of the library layer and
load it only when the CLI path explicitly requests OS-keychain lookup.
