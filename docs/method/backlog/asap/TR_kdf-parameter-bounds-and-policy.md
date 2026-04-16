# TR — KDF Parameter Bounds And Policy

## Why This Exists

Passphrase-based restore and vault rotation currently trust KDF parameters from
repository-controlled metadata too much.

That means a malicious manifest or vault metadata blob can push absurd PBKDF2
or scrypt values into `deriveKey()` and turn passphrase use into a resource
exhaustion path. The repo also defaults to weaker PBKDF2 settings than the
published security guidance implies.

## Target Outcome

Design and land a bounded KDF policy that:

- enforces hard minimum and maximum KDF parameters for untrusted metadata
- aligns defaults with the documented security guidance
- fails clearly when stored metadata requests parameters outside policy
- covers both manifest KDF metadata and vault metadata paths

## Human Value

Operators should be able to trust that entering a passphrase does not hand
repository-controlled metadata a CPU or memory bomb.

## Agent Value

Agents should be able to reason about KDF safety from explicit bounds and tests
instead of inferring intent from current defaults.

## Notes

- include both passphrase-based store/restore and vault-passphrase rotation
- keep caller-visible behavior explicit when metadata is rejected by policy
