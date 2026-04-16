# TR — Explicit AES-GCM Auth Tag Length

## Why This Exists

Node is now emitting `DEP0182` warnings during tamper-path tests because
`createDecipheriv()` / `setAuthTag()` are still relying on implicit tag-length
handling.

That is sloppy at the crypto boundary. The implementation already assumes a
128-bit GCM tag. It should say so explicitly.

## Target Outcome

Harden the crypto adapters so AES-GCM decryption sets and validates the
expected auth tag length explicitly, eliminating runtime deprecation noise and
making malformed tag handling less ambiguous.

## Human Value

Maintainers should be able to run tamper-path tests without normalizing a real
crypto warning into background noise.

## Agent Value

Agents should be able to reason about one explicit AES-GCM metadata contract
instead of inferring it from adapter behavior and runtime warnings.

## Notes

- keep the contract aligned across Node, Bun, and Web Crypto adapters
- coordinate with the existing encryption metadata hardening work
