# TR — Encryption Metadata Schema Hardening

## Why This Exists

The service layer now rejects downgraded encrypted manifests and unexpected
encryption algorithms during restore and encrypted integrity verification, but
the manifest schema still accepts overly loose encryption metadata.

That leaves security-critical fields such as `encrypted`, `algorithm`, `nonce`,
and `tag` under-validated at the data-model boundary.

## Target Outcome

Design and land stricter encryption metadata validation that:

- narrows accepted algorithms to supported values
- treats `encryption` metadata as actually encrypted rather than
  `encrypted: false`
- validates nonce/tag shape tightly enough to reject malformed metadata early
- keeps manifest read behavior honest across JSON and CBOR codecs

## Human Value

Maintainers should be able to trust that obviously invalid encryption metadata
is rejected at manifest-validation time instead of only in downstream service
logic.

## Agent Value

Agents should be able to reason about encrypted-manifest validity from the
schema itself instead of memorizing scattered service-layer checks.

## Notes

- keep compatibility tradeoffs explicit if stricter schema validation would
  reject previously serialized malformed manifests
- coordinate with future multi-scheme encryption work instead of baking in
  accidental dead ends
