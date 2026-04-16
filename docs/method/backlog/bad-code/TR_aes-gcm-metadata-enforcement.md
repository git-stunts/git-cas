# TR — AES-GCM Metadata Enforcement

## Why This Exists

The recent encrypted-manifest hardening landed the first real security boundary
in `CasService`, but some lower-level crypto behavior is still too loose.

Two symptoms showed up during the review:

- decrypt adapters still accept malformed nonce/tag metadata too far down the
  stack
- Node emits a deprecation warning when short AES-GCM auth tags are exercised
  in tests because `authTagLength` is not specified explicitly

That means part of the security contract still depends on service-layer checks
instead of being enforced where the crypto operation actually happens.

## Target Outcome

Design and land stricter AES-GCM metadata handling that:

- validates nonce and tag shape before decryption
- enforces the declared algorithm at the adapter boundary instead of ignoring it
- specifies `authTagLength` explicitly where Node expects it
- removes the current deprecation warning path from normal test runs

## Human Value

Maintainers should not have to infer whether malformed encryption metadata is
blocked by schema validation, service validation, or adapter luck.

## Agent Value

Agents should be able to reason about AES-GCM correctness from the crypto
surface itself instead of relying on cross-layer assumptions.

## Notes

- keep this focused on adapter/runtime enforcement
- coordinate with schema hardening so validation is not duplicated
