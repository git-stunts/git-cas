# BAD CODE: VaultService Optimistic Contention

## Context
`VaultService.#withVaultRetry` uses a fixed 50ms delay between retries for optimistic concurrency.

## Symptoms
- In high-concurrency environments (e.g., parallel CI runners), multiple processes can synchronize their retries, leading to a "thundering herd" and persistent lock failures.
- Lack of jitter makes the retry mechanism less resilient to varying Git lock durations.

## Proposed Fix
Implement exponential backoff with random jitter for the vault retry mechanism.
