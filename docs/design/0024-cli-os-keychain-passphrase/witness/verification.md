# Witness — 0024 CLI OS-Keychain Passphrase

## Playback

1. Can the human CLI source a vault passphrase from the OS keychain without
   changing the library API?
   Yes. The new CLI-only helper in `bin/passphrase-source.js` resolves
   `--os-keychain-target` through `@git-stunts/vault`, while the library still
   accepts explicit `encryptionKey` and `passphrase` inputs.

2. Do explicit passphrase-source conflicts now include the OS-keychain target?
   Yes. `validatePassphraseSources()` treats `--vault-passphrase`,
   `--vault-passphrase-file`, and `--os-keychain-target` as mutually exclusive.

3. Does an explicit OS-keychain target fail clearly when the secret is missing
   or empty?
   Yes. `resolveOsKeychainPassphrase()` throws explicit errors for missing and
   empty secrets instead of falling through to env or prompt.

4. Do `store`, `restore`, and `vault init` still use the same downstream key
   derivation flow once a passphrase is resolved?
   Yes. The CLI still feeds the resolved passphrase into the existing vault-KDF
   derivation path and then into the unchanged `git-cas` library APIs.

## RED -> GREEN

- RED spec: `test/unit/cli/passphrase-source.test.js`
- Green wiring: `bin/passphrase-source.js` and `bin/git-cas.js`

## Validation

- `npx vitest run test/unit/cli/passphrase-source.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- Human CLI only in this slice.
- Follow-on machine-facing parity later landed in
  `docs/design/0035-agent-cli-os-keychain-passphrase/agent-cli-os-keychain-passphrase.md`.
