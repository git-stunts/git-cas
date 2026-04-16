# Retro — 0035 Agent CLI OS-Keychain Passphrase

## Drift Check

- The cycle stayed on machine-facing passphrase-source parity.
- It did not reopen library API design or human CLI ergonomics.
- It reused the human CLI keychain resolver instead of adding a second secret
  lookup stack.

## What Shipped

- Agent store, restore, and vault init now accept explicit OS-keychain
  passphrase sources.
- Agent vault rotate now supports distinct old and new OS-keychain passphrase
  sources.
- Agent passphrase-source validation and resolution now live in a small
  dedicated module instead of expanding `bin/agent/cli.js` inline.

## What Did Not

- The agent CLI still does not have broad documentation parity with the human
  CLI.
- This cycle did not restructure the overall agent command core.

## Debt

- None added beyond the existing CLI portability and decomposition backlog.

## Cool Ideas

- If the repo later publishes a stronger agent protocol guide, the passphrase
  source shapes could be documented as a shared credential-source schema rather
  than command-by-command prose.
