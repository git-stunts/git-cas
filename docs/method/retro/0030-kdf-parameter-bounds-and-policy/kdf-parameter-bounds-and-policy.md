# Retro — 0030 KDF Parameter Bounds And Policy

## Drift Check

- The cycle stayed on KDF defaults and parameter-policy hardening.
- It did not reopen encryption framing, manifest schema shape, or CLI argument
  surfaces beyond documenting the stronger defaults.
- The read-side solution stayed compatibility-aware instead of cutting off all
  older passphrase-encrypted metadata.

## What Shipped

- New passphrase-derived metadata now defaults to PBKDF2 `600000` or scrypt
  `N=131072`, `r=8`, `p=1`.
- Stored manifest and vault KDF metadata is validated before derive work
  starts, and violations now fail with `KDF_POLICY_VIOLATION`.
- `VaultService.readState()` now rejects out-of-policy vault KDF metadata
  instead of treating it as ordinary trusted config.
- The Node/Bun/Web scrypt paths now set explicit `maxmem` so the stronger
  default cost works in practice instead of tripping Node’s memory guard.
- Public docs now explain the stronger defaults and the bounded compatibility
  window instead of leaving the old `100000` / `16384` defaults in place.

## What Did Not

- `deriveKey()` itself is still a raw derivation primitive; callers can still
  request custom parameters directly outside the persisted-metadata policy path.
- Encryption metadata schema hardening is still separate work.
- Web Crypto runtime parity for streaming encryption/decryption remains separate
  work.

## Debt

- Logged duplicated scrypt `maxmem` math as
  `docs/method/backlog/bad-code/TR_scrypt-maxmem-budget-dedup.md`.

## Cool Ideas

- If the repo ever grows a formal crypto policy object, KDF bounds, scrypt
  memory budgeting, and AES-GCM metadata validation should probably live behind
  one policy/config seam instead of several adjacent helpers.
