# Codebase Audit: @git-stunts/cas

**Auditor:** Senior Principal Software Auditor
**Date:** January 7, 2026
**Target:** `@git-stunts/cas`

---

## 1. QUALITY & MAINTAINABILITY ASSESSMENT (EXHAUSTIVE)

### 1.1. Technical Debt Score (1/10)
**Justification:**
1.  **Hexagonal Architecture**: Excellent use of Ports (`GitPersistencePort`, `CodecPort`) and Adapters.
2.  **Plugin Architecture**: The `CasService` is highly extensible via the Codec strategy.
3.  **Value Objects**: `Manifest` and `Chunk` are immutable and validated.

### 1.2. Readability & Consistency

*   **Issue 1:** **Codec Injection Transparency**
    *   The `CasService` constructor takes a `codec`, but the `ContentAddressableStore` facade takes a `format` string ('json' | 'cbor') and instantiates the codec internally. This hides the ability to pass a custom `CodecPort` implementation from the facade user.
*   **Mitigation Prompt 1:**
    ```text
    In `index.js`, update the `ContentAddressableStore` constructor to accept either a `format` string OR a `codec` instance. If a `codec` instance is provided, use it directly; otherwise, switch on `format`.
    ```

*   **Issue 2:** **Manifest Schema vs. Implementation**
    *   The `ManifestSchema` in `src/domain/schemas/ManifestSchema.js` defines `encryption` as optional, but `CasService` logic implies it always encrypts if a key is provided. The relationship between providing a key and the resulting manifest structure should be explicit.
*   **Mitigation Prompt 2:**
    ```text
    In `src/domain/services/CasService.js`, add JSDoc to `storeFile` clarifying that providing `encryptionKey` will result in an encrypted manifest and chunks, and the `encryption` field in the manifest will be populated.
    ```

*   **Issue 3:** **Chunk Size Configuration**
    *   The chunk size is configured in the constructor, but it's not validated against a minimum/maximum reasonable size. A chunk size of `0` or `1` byte would be inefficient but technically valid by the current code.
*   **Mitigation Prompt 3:**
    ```text
    In `src/domain/services/CasService.js`, add validation in the constructor to ensure `chunkSize` is at least 1KB (1024) to prevent performance degradation from excessive micro-chunking.
    ```

### 1.3. Code Quality Violation

*   **Violation 1:** **Duplicated Chunking Logic**
    *   `CasService.storeFile` duplicates the chunking loop logic for both the encrypted and unencrypted paths.
*   **Mitigation Prompt 4:**
    ```text
    Refactor `src/domain/services/CasService.js`. Extract the chunking and persistence loop into a private method `_chunkAndStore(streamOrBuffer)`. Use a generator or stream transformer to handle both Buffer (encrypted) and Stream (unencrypted) inputs uniformly.
    ```

---

## 2. PRODUCTION READINESS & RISK ASSESSMENT (EXHAUSTIVE)

### 2.1. Top 3 Immediate Ship-Stopping Risks

*   **Risk 1:** **Memory Consumption on Encryption**
    *   **Severity:** **High**
    *   **Location:** `src/domain/services/CasService.js`
    *   **Description:** The encryption path uses `readFileSync`, loading the *entire file* into memory before encrypting. For a 1GB file, this will crash the process. It does not stream encryption.
*   **Mitigation Prompt 7:**
    ```text
    In `src/domain/services/CasService.js`, refactor `storeFile` to use `createReadStream` and a streaming cipher (`createCipheriv`) for the encryption path, rather than `readFileSync` + buffer concatenation. This is critical for large file support.
    ```

*   **Risk 2:** **Manifest Size Explosion**
    *   **Severity:** **Medium**
    *   **Location:** `src/domain/services/CasService.js`
    *   **Description:** For very large files, the `manifest.chunks` array grows linearly. A 10GB file with 256KB chunks results in ~40,000 chunk objects in memory. While manageable, it sets a hard limit on scalability.
*   **Mitigation Prompt 8:**
    ```text
    (Architectural Note) No immediate code change, but document the limitation: "Current implementation stores all chunk metadata in a single manifest. Files >100GB may require a tree-based manifest structure (Merkle Tree)." Add this to `ARCHITECTURE.md` under "Scalability Limits".
    ```

*   **Risk 3:** **Weak Randomness in Tests**
    *   **Severity:** **Low**
    *   **Location:** `test/unit/domain/services/CasService.test.js`
    *   **Description:** Using `a.repeat(64)` for digests is weak.
*   **Mitigation Prompt 9:**
    ```text
    In `test/unit/domain/services/CasService.test.js`, use `crypto.randomBytes(32).toString('hex')` to generate realistic SHA-256 hashes for the test chunks.
    ```

### 2.2. Security Posture

*   **Vulnerability 1:** **Nonce Reuse (Probability)**
    *   **Description:** `randomBytes(12)` is standard for GCM, but ensuring it is never reused for the same key is critical. The current implementation generates a new random nonce for every file, which is safe.
    *   *Status: Mitigated by design.*

*   **Vulnerability 2:** **No Integrity Check on Decrypt**
    *   **Description:** The `decrypt` method relies on `decipher.final()` throwing if the Auth Tag is invalid. This is correct behavior for GCM, but we should ensure we catch and wrap that error into a domain `IntegrityError`.
*   **Mitigation Prompt 11:**
    ```text
    In `src/domain/services/CasService.js`, wrap the `decipher.final()` call in a try-catch block. If it throws, re-throw a new `CasError('Decryption failed: Integrity check error', 'INTEGRITY_ERROR')`.
    ```

### 2.3. Operational Gaps

*   **Gap 1:** **Garbage Collection**: No mechanism to identify or prune orphaned chunks (chunks not referenced by any manifest).
*   **Gap 2:** **Verification**: No utility to verify the integrity of a stored file (re-hashing chunks and comparing to manifest).

---

## 3. FINAL RECOMMENDATIONS & NEXT STEP

### 3.1. Final Ship Recommendation: **NO**
**DO NOT SHIP** until **Risk 1 (Memory Consumption on Encryption)** is resolved. Loading entire files into memory for encryption is a fatal flaw for a CAS system intended for binary assets.

### 3.2. Prioritized Action Plan

1.  **Action 1 (Critical Urgency):** **Mitigation Prompt 7** (Streaming Encryption). This is non-negotiable.
2.  **Action 2 (High Urgency):** **Mitigation Prompt 11** (Integrity Error Wrapping).
3.  **Action 3 (Medium Urgency):** **Mitigation Prompt 1** (Codec Injection in Facade).

---

## PART II: Two-Phase Assessment

## 0. 🏆 EXECUTIVE REPORT CARD

| Metric                        | Score (1-10)    | Recommendation                                                                                                                                         |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Developer Experience (DX)** | 9               | **Best of:** The Codec Plugin architecture allows seamlessly switching between JSON and CBOR.                                                          |
| **Internal Quality (IQ)**     | 5               | **Watch Out For:** The use of `readFileSync` in the encryption path cripples the system's ability to handle large files, which is its primary purpose. |
| **Overall Recommendation**    | **THUMBS DOWN** | **Justification:** A Content Addressable Store that cannot handle files larger than available RAM is not production-ready.                             |

## 5. STRATEGIC SYNTHESIS & ACTION PLAN

- **5.1. Combined Health Score:** **6/10**
- **5.2. Strategic Fix:** **Implement Streaming Encryption**. This transforms the library from a "toy" to a production-grade tool.
- **5.3. Mitigation Prompt:**
    ```text
    Refactor `src/domain/services/CasService.js` to implement streaming encryption.
    1. Replace `readFileSync` with `createReadStream`.
    2. Use `crypto.createCipheriv` as a transform stream or pump the read stream through it.
    3. Chunk the *encrypted* output stream, not the input buffer.
    4. Ensure `storeFile` returns a Promise that resolves only when the entire stream is processed and persisted.
    ```
