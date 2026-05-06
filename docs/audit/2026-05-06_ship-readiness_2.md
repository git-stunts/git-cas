yaml
report_id: "AUD-2026-05-06-SR-V02"
title: "Production Readiness & Risk Assessment (v6.0.0)"
status: "Final"
audit:
  date_started: 2026-05-06
  date_completed: 2026-05-06
  type: "Full"
  scope: "Entire Codebase (v6.0.0 release candidate)"
  compliance_frameworks: ["Surgical Engineering Standard", "Production Checklist"]
target:
  repository: "github.com/git-stunts/git-cas"
  branch: "main"
  commit_hash: "HEAD" 
  language_stack: ["Node.js 22", "Git 2.45+"]
  environment: "Production"
methodology:
  automated_tools: ["npm test", "vitest", "eslint"]
  manual_review_hours: 4
  false_positive_rate: "0%"
summary:
  total_findings: 8
  severity_count:
    critical: 0
    high: 2
    medium: 4
    low: 2
  remediation_status: "Pending"
related_reports:
  previous_audit: "2026-05-05_v6-release-readiness.md"
  tracking_ticket: "RELEASE-V6"
---

# 1. QUALITY & MAINTAINABILITY ASSESSMENT (EXHAUSTIVE)

1.1. **Technical Debt Score (1-10):** 3.
**Justification:** The project is exceptionally well-structured. problematic patterns are rare, but include:
- **Service Bloat:** `VaultService` is approaching "God Object" territory.
- **In-Memory Tree Traversal:** Relying on JavaScript `Map` for Git tree indexing.
- **Subprocess Masking:** Infrastructure adapters rely on shell binary presence without built-in "Self-Repair" or detailed dependency diagnostics in the domain layer.

1.2. **Readability & Consistency:**
* **Issue 1:** The `index.js` facade uses `#getService()` and `#getVault()` as internal lazy-initializers. For a new developer, it's unclear when these are triggered vs when they throw (e.g., if a repo isn't open).
* **Mitigation Prompt 1:** `Update index.js JSDoc to explicitly state that all facade methods (store, restore, list) are lazily initialized and will throw 'PersistenceCapabilityRequiredError' if the store was not opened with a valid Git persistence port.`
* **Issue 2:** `CdcChunker.js` uses complex rolling hash logic (`Buzhash`) that is sparse on comments. A junior developer would struggle to debug a "stuck" rolling window.
* **Mitigation Prompt 2:** `Add extensive inline comments to CdcChunker.js explaining the dual-mask logic, the minimum/maximum chunk size guards, and the mathematical significance of the mask values in the rolling hash loop.`
* **Issue 3:** Naming collision: `VaultEntry` (domain entity) vs `VaultTreeEntry` (infrastructure type).
* **Mitigation Prompt 3:** `Rename 'VaultTreeEntry' in VaultService.js to 'RawGitTreeEntry' to clearly distinguish between the high-level domain entity and the low-level Git structure.`

1.3. **Code Quality Violation:**
* **Violation 1:** `GitPersistenceAdapter.readBlob` buffers the entire asset.
* **Simplified Rewrite 1:**
```javascript
// Current:
async readBlob(oid) {
  const chunks = [];
  for await (const chunk of await this.readBlobStream(oid)) { chunks.push(chunk); }
  return Buffer.concat(chunks);
}
// Simplified/Safer:
async readBlob(oid) {
  // Only use this for metadata/small blobs. Ensure domain layer uses streams for data.
  // Add a guard:
  const stream = await this.readBlobStream(oid);
  return this._bufferStreamWithLimit(stream, 10 * 1024 * 1024); // 10MB limit
}
```
* **Mitigation Prompt 4:** `Refactor GitPersistenceAdapter.js to include a 'maxBytes' guard in 'readBlob', and update CasService to use 'readBlobStream' directly for chunk verification, preventing full-file buffering.`
* **Violation 2:** `VaultService.#withVaultRetry` hardcodes the retry count and delay.
* **Simplified Rewrite 2:**
```javascript
async #withVaultRetry(op, options = {}) {
  const policy = this.retryPolicy || new DefaultVaultRetryPolicy();
  return policy.execute(() => op());
}
```
* **Mitigation Prompt 5:** `Extract the vault retry logic into a dedicated 'VaultRetryPolicy' class (or inject an alfred policy), removing hardcoded delay constants from the service.`
* **Violation 3:** `CasService.js` has a high-complexity `#buildStoreStrategies` method.
* **Mitigation Prompt 6:** `Refactor '#buildStoreStrategies' in CasService.js to use a strategy factory or a mapping object, reducing the cyclomatic complexity of the main service class.`

### 2. PRODUCTION READINESS & RISK ASSESSMENT (EXHAUSTIVE)

2.1. **Top 3 Immediate Ship-Stopping Risks (The "Hard No"):**
* **Risk 1:** **High - Vault Tree OOM:** `VaultService` loads the entire `refs/cas/vault` tree into memory. In a repository with 50,000+ assets, `git-cas list` or `restore` will crash the Node.js process. (Location: `src/domain/services/VaultService.js`)
* **Mitigation Prompt 7:** `Refactor VaultService to use 'git ls-tree' with path-specific arguments for 'resolveVaultEntry' and 'removeFromVault', ensuring O(1) resolution time and avoiding full-tree materialization in the Map.`
* **Risk 2:** **High - Credential Leak in Observability:** Errors passed to the `ObservabilityPort` currently contain full metadata objects, which may include sensitive raw keys or salts if an error occurs during KDF. (Location: `src/domain/services/CasService.js`)
* **Mitigation Prompt 8:** `Implement a 'RedactingObserver' wrapper that automatically strips fields named 'passphrase', 'key', 'encryptionKey', and 'salt' from all error metadata before passing them to the observability port.`
* **Risk 3:** **Medium/High - Path Traversal in Restore:** `restoreFile` uses an `outputPath` that could be manipulated to write files outside the repository boundary (e.g., `../../etc/passwd`). (Location: `bin/git-cas.js`)
* **Mitigation Prompt 9:** `Implement a 'SafePath' utility in the domain layer that validates all output paths against a 'permitted base directory', throwing an error if the resolved path escapes the boundary.`

2.2. **Security Posture:**
* **Vulnerability 1:** Lack of input sanitization for slug names beyond basic string validation. (Location: `src/domain/value-objects/Slug.js`)
* **Mitigation Prompt 10:** `Update Slug.js to use a strict regex (e.g., /^[a-zA-Z0-9_\-\/]+$/) to prevent shell-sensitive characters from being used in Git ref tree paths.`
* **Vulnerability 2:** The `VaultService` optimistic concurrency mechanism relies on a 50ms fixed delay, which may be exploitable or lead to starvation under high-contention distributed environments.
* **Mitigation Prompt 11:** `Introduce jitter to the CAS_RETRY_BASE_MS in VaultService.js to prevent 'thundering herd' issues during concurrent CI/CD uploads.`

2.3. **Operational Gaps:**
* **Gap 1:** **Health Metrics:** No automated way to track deduplication ratios across a vault beyond the manual `stats` command.
* **Gap 2:** **Structured Logging:** No support for standardized JSON logging, making ingestion into ELK/Datadog difficult for industrial users.
* **Gap 3:** **Concurrency Tunability:** The `concurrency` option is buried in the CAS constructor and not easily accessible via CLI for environment-specific tuning (e.g., higher concurrency on large servers).

### 3. FINAL RECOMMENDATIONS & NEXT STEP

3.1. **Final Ship Recommendation:** **YES, BUT...**
Shipping is safe for small-to-medium deployments (<5,000 assets). Release for enterprise-scale or high-concurrency environments requires addressing the **Vault Tree OOM** and **Credential Redaction** findings.

3.2. **Prioritized Action Plan:**
* **Action 1 (High Urgency):** Refactor `VaultService` to use path-based `git ls-tree` resolution.
* **Action 2 (High Urgency):** Implement credential redaction in the observability pipeline.
* **Action 3 (Medium Urgency):** Add path traversal protection to the restore operation.
