# Witness — 0035 Agent CLI OS-Keychain Passphrase

## Playback

1. Can agent store, restore, and vault init accept explicit OS-keychain
   passphrase sources?
   Yes. The agent CLI now parses and resolves `osKeychainTarget` /
   `osKeychainAccount` for store, restore, and vault init.

2. Can agent vault rotate source old and new passphrases independently from the
   OS keychain?
   Yes. Vault rotation now accepts separate
   `oldOsKeychainTarget` / `oldOsKeychainAccount` and
   `newOsKeychainTarget` / `newOsKeychainAccount` inputs.

3. Do mutual-exclusion and stdin-conflict checks stay explicit instead of
   making the protocol ambiguous?
   Yes. The shared agent passphrase-source module keeps source validation
   mutually exclusive and preserves stdin conflict failures.

4. Does the agent CLI start payload redact the new keychain source fields
   instead of echoing them back?
   Yes. The new keychain source fields are treated as redacted start-input
   fields in the same way as other credential sources.

## RED -> GREEN

- RED spec:
  - `test/unit/cli/agent-passphrase-source.test.js`
- Green wiring:
  - `bin/agent/passphrase-source.js`
  - `bin/agent/cli.js`

## Validation

- `npx vitest run test/unit/cli/agent-passphrase-source.test.js`
- `npx vitest run test/unit/cli/agent-passphrase-source.test.js test/unit/cli/passphrase-source.test.js`
- `npx eslint bin/agent/cli.js bin/agent/passphrase-source.js test/unit/cli/agent-passphrase-source.test.js`
- full repo validation recorded after the paired 0036 planning cycle

## Notes

- OS-keychain lookup stays explicit and non-interactive.
- The core library API is unchanged.
