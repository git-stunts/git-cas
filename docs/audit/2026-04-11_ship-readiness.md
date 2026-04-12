# AUDIT: READY-TO-SHIP ASSESSMENT (2026-04-11)

### 1. QUALITY & MAINTAINABILITY ASSESSMENT (EXHAUSTIVE)

1.1. **Technical Debt Score (1-10):** 3
    - **Justification:**
        1. **Orchestration Bloat**: `CasService.js` is responsible for too many concerns, making it a high-risk area for future feature expansion.
        2. **Platform Leaks**: Direct imports of `node:zlib` and `node:stream` in the domain service violate the hexagonal purity of the core.
        3. **Vault Mutation Complexity**: The manual retry loop for vault conflicts in `VaultService.js` is brittle and duplicated across mutation methods.

1.2. **Readability & Consistency:**
    - **Issue 1:** The `App` facade in `index.js` uses JSDoc `@template` but lacks consistent implementation across all exported methods.
    - **Mitigation Prompt 1:** `Standardize JSDoc @template and type definitions in index.js to ensure full TypeScript parity for the facade layer.`
    - **Issue 2:** Error codes in `CasError.js` are stable, but some operational failures (e.g., streaming errors) lack detailed metadata for agentic recovery.
    - **Mitigation Prompt 2:** `Enhance 'STREAM_ERROR' in CasService.js to include the 'lastSuccessfulChunkIndex' and 'totalBytesRead' in the error metadata.`
    - **Issue 3:** The `Vault` term is used both for the ref `refs/cas/vault` and the logical index; this can lead to confusion in cross-platform discussions.
    - **Mitigation Prompt 3:** `Refine the terminology in ARCHITECTURE.md to distinguish between the 'Vault Ref' (the physical Git object) and the 'Vault Index' (the logical slug map).`

1.3. **Code Quality Violation:**
    - **Violation 1: God Function (`store`)**: `CasService.store` manages key resolution, compression, chunking, and manifest creation in a single async block.
    - **Violation 2: SRP Violation (`_restoreBuffered`)**: This method handles reading, verifying, decrypting, and decompressing chunks in a single pass.
    - **Violation 3: SoC Violation (`createCas`)**: The CLI factory in `bin/git-cas.js` manages both adapter construction and manual CBOR codec injection.

### 2. PRODUCTION READINESS & RISK ASSESSMENT (EXHAUSTIVE)

2.1. **Top 3 Immediate Ship-Stopping Risks (The "Hard No"):**
    - **Risk 1: Memory Exhaustion (High)**: Large encrypted restores (e.g., > 1 GiB) will crash the process if they exceed `maxRestoreBufferSize`.
    - **Mitigation Prompt 7:** `Refactor 'CasService._restoreBuffered' to implement a 'chunk-at-a-time' decryption strategy, reducing the memory requirement from O(AssetSize) to O(ChunkSize).`
    - **Risk 2: Unsigned Manifests (Medium)**: While chunks are hashed, the manifest itself is not signed, meaning a repository administrator could theoretically modify chunk OIDs without triggering an integrity failure.
    - **Mitigation Prompt 8:** `Implement 'Manifest Signing': Allow manifests to be sealed with an optional cryptographic signature, ensuring the integrity of the chunk list itself.`
    - **Risk 3: Git Lock Contention (Low)**: High-frequency vault updates in CI environments can lead to `.git/index.lock` collisions.
    - **Mitigation Prompt 9:** `Implement a 'Vault Lock' or a more aggressive backoff strategy in 'VaultService.#retryMutation' to neutralize lock contention in parallel CI runners.`

2.2. **Security Posture:**
    - **Vulnerability 1: Metadata Leakage**: Slug names and chunk counts are visible in the plain-text vault ref, even if the underlying blobs are encrypted.
    - **Mitigation Prompt 10:** `Add a 'Privacy Mode' to VaultService that HMAC-hashes slugs before storing them in the vault tree, preventing repository-wide discovery of asset names.`
    - **Vulnerability 2: Weak KDF Defaults**: PBKDF2 with low iterations might be vulnerable to offline brute-force attacks on the vault passphrase.
    - **Mitigation Prompt 11:** `Increase the default PBKDF2 iteration count to 600,000 and recommend 'scrypt' as the default KDF for new vaults.`

2.3. **Operational Gaps:**
    - **Gap 1: Garbage Collection Integrity**: No built-in tool to verify that all blobs in the Git ODB that are *not* reachable via the vault are indeed orphaned.
    - **Gap 2: Remote Telemetry**: ObservabilityPort lacks a standard adapter for OpenTelemetry or Datadog.
    - **Gap 3: Performance Budgets**: No CI check for "Store Throughput" or "Deduplication Efficiency" baselines.

### 3. FINAL RECOMMENDATIONS & NEXT STEP

3.1. **Final Ship Recommendation:** **YES, BUT...** (Implement Streaming Decryption and increase KDF defaults immediately).

3.2. **Prioritized Action Plan:**
    - **Action 1 (High Urgency):** Implement true streaming decryption to remove OOM risk.
    - **Action 2 (Medium Urgency):** Increase default KDF iteration counts.
    - **Action 3 (Low Urgency):** Standardize terminology across the monorepo manifests.
