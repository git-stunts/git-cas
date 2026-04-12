# TR — Vault Retry Abstraction

Legend: [TR — Truth](../../legends/TR-truth.md)

## Idea

The manual retry loop for optimistic concurrency conflicts in `VaultService.js` is currently implemented inside `#retryMutation`. This logic is effective but could be improved by extracting it into a formal `withVaultRetry` orchestration pattern.

Refactor `VaultService` to use a declarative mutation pattern where the method provides a "Delta function" and the service handles the read-apply-write-retry loop with configurable exponential backoff.

## Why

1. **Maintainability**: Centralizes the conflict-resolution logic.
2. **Reliability**: Ensures that all vault-modifying methods (add, remove, rotate) benefit from the same robust retry strategy.
3. **Complexity Reduction**: Simplifies the internal methods of `VaultService`.

## Effort

Small — refactor `#retryMutation` and the methods that consume it.
