# 0026-dual-encryption-mode-foundation

## Title

Lay the explicit encryption-scheme foundation for dual encryption modes

## Why

`git-cas` currently has one real encrypted payload format: the existing
whole-object AES-256-GCM envelope. That is a valid format, but the system does
not name it explicitly.

If we want both:

- a compatibility-oriented whole-object mode
- a future framed authenticated mode for bounded streaming restore

then the format choice needs to become explicit in manifest metadata and the
public store surface. Otherwise the second mode will end up squeezed into
assumptions that were written for the first one.

## Decision

This cycle only lands the foundation slice:

- encrypted manifests gain an explicit optional `scheme`
- new encrypted stores emit `scheme: 'whole-v1'`
- legacy encrypted manifests with no `scheme` remain readable as implicit
  `whole-v1`
- store rejects unsupported requested schemes
- restore and verify reject unknown encrypted schemes instead of guessing

## Scope

This cycle covers:

- manifest encryption metadata shape
- `store()` encryption option routing
- restore / verify scheme validation
- public docs and typings for explicit `whole-v1`

This cycle does not cover:

- implementing `framed-v1`
- changing encrypted restore buffering behavior
- changing low-level `encrypt()` / `decrypt()` into multi-mode APIs

## Behavior

### Store

Encrypted `store()` calls may provide:

```js
encryption: { scheme: 'whole-v1' }
```

If omitted, encrypted store defaults to `whole-v1`.

If an unknown scheme is requested, `store()` fails with `INVALID_OPTIONS`.

### Manifest

New encrypted manifests are serialized with:

```json
{
  "encryption": {
    "scheme": "whole-v1",
    "algorithm": "aes-256-gcm",
    "nonce": "...",
    "tag": "...",
    "encrypted": true
  }
}
```

Legacy encrypted manifests without `scheme` remain valid and are treated as
implicit `whole-v1`.

### Restore / Verify

Restore and encrypted `verifyIntegrity()` must route by scheme:

- `undefined` -> legacy `whole-v1`
- `whole-v1` -> current whole-object AES-GCM path
- anything else -> reject instead of guessing

## Playback Questions

1. Do new encrypted stores persist `scheme: 'whole-v1'` in the manifest?
2. Does encrypted store reject unsupported requested schemes?
3. Do restore and verify still accept legacy encrypted manifests with no
   `scheme`?
4. Do restore and verify reject unsupported encrypted schemes instead of trying
   to interpret them as the current format?

## Red Tests

The executable spec will live in:

- `test/unit/domain/services/CasService.test.js`
- `test/unit/domain/services/CasService.restore.test.js`
- `test/unit/domain/services/CasService.errors.test.js`
- `test/unit/domain/value-objects/Manifest.test.js`

## Green Shape

Keep the implementation local to manifest validation and `CasService` routing.
This is a foundation slice, not the framed-encryption implementation itself.
