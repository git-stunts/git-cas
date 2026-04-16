# TR — KDF Salt Schema Hardening

## Why This Exists

The manifest and vault KDF metadata now has bounded parameter policy, but the
stored `salt` field is still only validated as a non-empty string at the schema
layer.

That leaves a small but real mismatch: security-critical KDF metadata is mostly
validated for policy while the encoded salt shape still relies on downstream
decode behavior.

## Target Outcome

Harden the KDF salt field so stored metadata rejects malformed base64 early and
the schema tells the same truth the crypto path expects.

## Human Value

Maintainers should be able to trust persisted KDF metadata to be structurally
valid before any derive work begins.

## Agent Value

Agents should not need to remember that `salt` is the last major KDF field that
still accepts arbitrary strings at parse time.

## Notes

- keep vault-state and manifest behavior aligned
- do not widen the scope back into KDF cost policy, which is already handled
