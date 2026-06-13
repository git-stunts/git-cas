# BAD CODE: VaultService Optimistic Contention

Status: Resolved in the VaultService decomposition cycle.

## Context

`VaultService.#withVaultRetry` uses a fixed 50ms delay between retries for optimistic concurrency.

## Symptoms
- In high-concurrency environments (e.g., parallel CI runners), multiple processes can synchronize their retries, leading to a "thundering herd" and persistent lock failures.
- Lack of jitter makes the retry mechanism less resilient to varying Git lock durations.

## Proposed Fix
Implement exponential backoff with random jitter for the vault retry mechanism.

## Resolution

`VaultMutationRetryPolicy` now owns the retry configuration, exponential backoff,
and jitter. `VaultService` receives it through dependency injection and keeps the
mutation loop focused on read-apply-write orchestration.
