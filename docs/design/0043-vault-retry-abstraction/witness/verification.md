# Witness — 0043 Vault Retry Abstraction

## Playback

1. Does `initVault()` now retry on `VAULT_CONFLICT` the same way add/remove do?
   Yes. `initVault()` now runs through the same retry orchestration helper as
   the other vault mutations.

2. Do add/remove still behave the same while using the shared helper?
   Yes. The vault suite stays green, including existing add/remove retry and
   result-shape coverage.

3. Did the cycle stay focused on vault mutation orchestration?
   Yes. Retry timing policy and `rotateVaultPassphrase()` were unchanged.

## RED -> GREEN

- RED spec:
  - `test/unit/vault/VaultService.test.js`
- Green wiring:
  - `src/domain/services/VaultService.js`

## Validation

- `npx vitest run test/unit/vault/VaultService.test.js`
- `npx eslint src/domain/services/VaultService.js test/unit/vault/VaultService.test.js`
- full repo validation recorded at cycle close

## Notes

- Vault mutations now operate on isolated per-attempt drafts while the service
  owns the read-apply-write-retry loop.
