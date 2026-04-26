# Witness — 0030 KDF Parameter Bounds And Policy

## Playback

1. Do new PBKDF2 and scrypt derives use the stronger default parameters in the
   public API?
   Yes. `deriveKey()` now defaults to PBKDF2 `600000` iterations and scrypt
   `N=131072`, `r=8`, `p=1`.

2. Does passphrase-based store persist the stronger default KDF metadata for
   new encrypted assets?
   Yes. Passphrase-based `store()` and `storeFile()` now persist the stronger
   defaults in `manifest.encryption.kdf`.

3. Does restore reject manifest KDF metadata that is outside the accepted
   policy before crypto work begins?
   Yes. `KeyResolver` validates stored manifest KDF metadata first and throws
   `KDF_POLICY_VIOLATION` before calling `deriveKey()` on out-of-policy input.

4. Do vault init and vault passphrase rotation reject out-of-policy KDF inputs
   and stored vault KDF metadata clearly?
   Yes. `initVault()`, `readState()`, and `rotateVaultPassphrase()` now reject
   out-of-policy KDF values with `KDF_POLICY_VIOLATION`.

5. Do the public docs now describe both the stronger defaults and the bounded
   legacy-compatibility policy honestly?
   Yes. `SECURITY.md`, `docs/API.md`, `docs/WALKTHROUGH.md`, `STATUS.md`,
   `BEARING.md`, and `CHANGELOG.md` all reflect the new defaults and the
   bounded compatibility window.

## RED -> GREEN

- RED spec:
  - `test/unit/ports/CryptoPort.test.js`
  - `test/unit/domain/services/CasService.kdf.test.js`
  - `test/unit/domain/services/KeyResolver.test.js`
  - `test/unit/domain/services/rotateVaultPassphrase.test.js`
  - `test/unit/vault/VaultService.test.js`
- Green wiring:
  - `src/helpers/kdfPolicy.js`
  - `src/ports/CryptoPort.js`
  - `src/domain/services/KeyResolver.js`
  - `src/domain/services/VaultService.js`
  - `src/domain/services/rotateVaultPassphrase.js`
  - `src/infrastructure/adapters/{NodeCryptoAdapter,BunCryptoAdapter,WebCryptoAdapter}.js`
  - truth surfaces in `SECURITY.md`, `docs/API.md`, `docs/WALKTHROUGH.md`,
    `STATUS.md`, `BEARING.md`, and `CHANGELOG.md`

## Validation

- `npx vitest run test/unit/ports/CryptoPort.test.js test/unit/domain/services/CasService.kdf.test.js test/unit/domain/services/KeyResolver.test.js test/unit/domain/services/rotateVaultPassphrase.test.js test/unit/vault/VaultService.test.js test/unit/facade/ContentAddressableStore.rotation.test.js`
- `npm test`
- `npx eslint .`
- `git diff --check`

## Notes

- The bounded policy intentionally keeps a legacy compatibility window for old
  stored metadata instead of forcing a hard read-side migration cutoff.
- `deriveKey()` remains the raw primitive; policy is enforced on persisted-KDF
  flows rather than every direct derive call.
