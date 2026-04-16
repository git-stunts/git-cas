# Retro — 0026 Dual Encryption Mode Foundation

## Drift Check

- The slice stayed bounded to explicit scheme metadata and routing.
- No framed encryption implementation was attempted.
- Restore buffering behavior did not change in this cycle.

## What Shipped

- New encrypted stores now persist `encryption.scheme = 'whole-v1'`.
- `store()` and `storeFile()` now accept an explicit encryption-mode request.
- Unsupported requested schemes fail fast during store.
- Restore and encrypted `verifyIntegrity()` now route by scheme and fail closed
  on unknown on-disk schemes.
- Legacy encrypted manifests without a `scheme` field still restore and verify
  as implicit `whole-v1`.

## What Did Not

- `framed-v1` encryption was not implemented.
- Low-level `encrypt()` / `decrypt()` did not become multi-mode APIs beyond the
  explicit `whole-v1` metadata foundation.
- Streaming encrypted restore behavior did not change.

## Debt

- Logged the next concrete slice in
  `docs/method/backlog/up-next/TR_framed-v1-authenticated-encryption.md`.

## Cool Ideas

- Once `framed-v1` exists, consider whether direct `encrypt()` / `decrypt()`
  should stay whole-object primitives or grow an explicit format-routing API of
  their own.
