# Retro — 0043 Vault Retry Abstraction

## Drift Check

- The cycle stayed on vault mutation orchestration.
- It did not touch retry timing policy or vault rotation flows.

## What Shipped

- Replaced the older vault retry helper with a formal mutation orchestration
  helper.
- Routed `initVault()`, `addToVault()`, and `removeFromVault()` through that
  helper.
- Added RED/GREEN coverage proving `initVault()` now retries on
  `VAULT_CONFLICT`.

## What Did Not

- `rotateVaultPassphrase()` still owns its own retry behavior.
- No public vault API shapes changed.

## Debt

- None added. This card is closed.

## Cool Ideas

- If vault mutation observability becomes important later, the shared helper is
  now the right place to attach retry metrics without scattering them across
  individual methods.
