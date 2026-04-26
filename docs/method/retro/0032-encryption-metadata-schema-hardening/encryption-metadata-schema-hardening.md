# Retro — 0032 Encryption Metadata Schema Hardening

## Drift Check

- The cycle stayed on manifest-boundary encryption metadata validation.
- It did not change restore semantics, encryption formats, or KDF parameter
  policy beyond making the accepted manifest shapes stricter.
- Compatibility remained limited to the intentional legacy case: missing
  `scheme` on older `whole-v1` manifests.

## What Shipped

- `EncryptionSchema` now only accepts two honest encrypted manifest shapes:
  legacy/explicit `whole-v1` and explicit `framed-v1`.
- `whole-v1` manifest nonce/tag values now require canonical base64 and the
  expected AES-GCM byte lengths.
- `framed-v1` now requires `frameBytes` and rejects whole-object nonce/tag
  fields.
- Recipient envelope metadata is now validated for canonical base64 and
  expected lengths instead of only non-empty strings.
- `Manifest` now constructs from parsed schema output rather than raw input, so
  validated defaults become the actual value-object state.
- `readManifest()` now rejects invalid encrypted metadata identically across
  JSON and CBOR manifests.

## What Did Not

- KDF salt shape was still loose at the time of this cycle, but that gap is
  now closed.
- This cycle did not change the runtime crypto adapters or introduce new
  encryption schemes.
- Unknown encrypted schemes now fail at manifest construction time rather than
  being deferred to service routing.

## Debt

- KDF salt schema hardening is now closed in
  [0040-kdf-salt-schema-hardening](../../../design/0040-kdf-salt-schema-hardening/kdf-salt-schema-hardening.md).

## Cool Ideas

- If encryption policy keeps growing, the manifest crypto shape may deserve a
  dedicated policy module instead of spreading the accepted contract across
  schema, service, and docs seams.
