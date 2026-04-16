# TR — Scrypt Maxmem Budget Dedup

## Why This Exists

The KDF policy hardening cycle had to add explicit `maxmem` budgeting to the
Node, Bun, and Web Crypto scrypt paths so the stronger `N=131072` default works
in practice.

That math is now duplicated in three adapters.

## Target Outcome

Move the scrypt memory-budget calculation behind one shared helper so:

- Node, Bun, and Web fallback stay consistent
- future KDF tuning does not drift by runtime
- the KDF policy and the runtime budgeting logic are easier to reason about

## Human Value

Operators should not see runtime-specific scrypt behavior drift because one
adapter forgot to update its budget calculation.

## Agent Value

Agents should not need to patch the same memory-budget formula in three places
when KDF policy evolves.
