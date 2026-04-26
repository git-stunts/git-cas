# Retro — 0024 CLI OS-Keychain Passphrase

## Drift Check

- The slice stayed CLI-only.
- The library API did not gain implicit secret lookup.
- `@git-stunts/vault` is used only when the human CLI explicitly requests an
  OS-keychain target.

## What Shipped

- Added `bin/passphrase-source.js` as the human CLI passphrase-source helper.
- Added `--os-keychain-target` and `--os-keychain-account` to human CLI
  `store`, `restore`, and `vault init`.
- Added unit coverage for source precedence, conflict validation, and missing
  or empty OS-keychain secrets.
- Updated CLI-facing docs and error hints.

## What Did Not

- Agent CLI support did not ship.
- Vault-rotate old/new passphrase sourcing from the OS keychain did not ship.
- No library-level secret-provider abstraction was added.

## Debt

- Follow-on work from this slice later landed as
  `docs/design/0035-agent-cli-os-keychain-passphrase/agent-cli-os-keychain-passphrase.md`.

## Cool Ideas

- If operators want less flag churn later, add a repo-local config default for
  `--os-keychain-account` without making secret lookup implicit.
