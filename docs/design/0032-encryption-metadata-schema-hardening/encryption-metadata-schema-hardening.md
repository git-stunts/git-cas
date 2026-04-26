# 0032-encryption-metadata-schema-hardening

## Title

Make the manifest schema tell the truth about supported encryption metadata

## Why

Encrypted-manifest handling has been tightened in `CasService`, but the schema
layer still accepts malformed or misleading metadata:

- `encrypted: false` under an `encryption` object
- unsupported algorithm strings
- malformed or wrong-sized AES-GCM nonce/tag values
- framed manifests without `frameBytes`
- framed manifests carrying whole-object nonce/tag fields

That is the wrong boundary. Manifest parsing should reject obviously invalid
encryption metadata before restore and integrity code has to defend itself
again downstream.

## Decision

Harden the manifest schema so encrypted metadata has only two accepted shapes:

- legacy or explicit `whole-v1`
- explicit `framed-v1`

Compatibility stays explicit:

- missing `scheme` remains valid only for legacy `whole-v1`
- `algorithm` is locked to `aes-256-gcm`
- `encrypted` means encrypted and must be `true`
- whole-object nonce/tag values must be canonical base64 with the expected
  AES-GCM byte lengths
- recipient envelope metadata gets the same base64/length treatment
- framed manifests require `frameBytes` and do not carry manifest-level
  nonce/tag fields

## Scope

This cycle covers:

- manifest schema hardening for encryption metadata
- recipient envelope field validation at the schema layer
- manifest constructor coverage for the tightened shapes
- read-manifest behavior across JSON and CBOR codecs

This cycle does not cover:

- KDF salt schema hardening
- new encryption formats beyond `whole-v1` and `framed-v1`
- restore-path logic changes beyond what schema validation now rejects

## Playback Questions

1. Does manifest parsing reject `encrypted: false` and unsupported encryption
   algorithms at the schema boundary?
2. Do `whole-v1` manifests require canonical AES-GCM nonce/tag values with the
   expected lengths?
3. Do `framed-v1` manifests require `frameBytes` and reject whole-object
   nonce/tag fields?
4. Do recipient envelope entries reject malformed base64 metadata early?
5. Does `readManifest()` fail the same way for invalid encrypted metadata in
   both JSON and CBOR manifests?

## Red Tests

The executable spec will live in:

- `test/unit/domain/schemas/RecipientSchema.test.js`
- `test/unit/domain/schemas/ManifestSchema.keyVersion.test.js`
- `test/unit/domain/value-objects/Manifest.test.js`
- `test/unit/domain/services/CasService.readManifest.test.js`

## Green Shape

Make the schema strict enough that `Manifest` and `readManifest()` can trust
the shape they receive. Keep legacy `whole-v1` compatibility where it is
intentional, not accidental.
