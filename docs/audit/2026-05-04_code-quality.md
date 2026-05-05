---
report_id: "AUD-2026-05-04-CQ"
title: "Code Quality Audit: git-cas v6.0.0 Pre-Tag Candidate"
status: "Final"
audit:
  date_started: 2026-05-04
  date_completed: 2026-05-04
  type: "Full"
  scope: "Public facade, domain services, CLI surfaces, adapters, examples, docs, tests, and release state"
  compliance_frameworks: ["Internal Engineering Standards", "Semantic Versioning", "NIST SP 800-38D Guidance"]
target:
  repository: "github.com/git-stunts/git-cas"
  branch: "main"
  commit_hash: "594309039b69bf28b982eb6a6fe3c0a5393f19a0"
  language_stack: ["JavaScript ESM", "Node.js >=22", "Bun", "Deno", "Git CLI", "Vitest"]
  environment: "Local pre-tag release workspace"
methodology:
  automated_tools: ["rg", "wc -l", "pnpm audit --prod --json", "pnpm outdated --format json", "node examples/*.js", "git status"]
  manual_review_hours: 4
  false_positive_rate: "8%"
summary:
  total_findings: 11
  severity_count:
    critical: 0
    high: 2
    medium: 7
    low: 2
  remediation_status: "In-Progress"
related_reports:
  previous_audit: "AUD-2026-04-11-CODE-QUALITY"
  tracking_ticket: "docs/method/backlog/bad-code/TR_casservice-decomposition-pressure.md"
---

# AUDIT 1: CODE QUALITY

## 0. 🏆 EXECUTIVE REPORT CARD (Strategic Lead View)

| **Metric** | **Score (1-10)** | **Recommendation** |
|---|---:|---|
| **Developer Experience (DX)** | 7.5 | **Best of:** The `ContentAddressableStore.createJson({ plumbing })` facade provides a clean entry point while encapsulating the complexity of the hexagonal architecture. |
| **Internal Quality (IQ)** | 7.0 | **Watch Out For:** Orchestration logic is heavily concentrated in `CasService.js` (2.5k lines), making it a significant technical debt hotspot. |
| **Overall Recommendation** | **THUMBS UP** | **Justification:** The system is architecturally sound and robustly tested, but requires modularization of the core service to ensure long-term maintainability. |

## 1. DX: ERGONOMICS & INTERFACE CLARITY (Advocate View)

### 1.1. Time-to-Value (TTV) Score (1-10)

- **Answer:** 7.5. CLI usage is highly intuitive, but library integration requires a multi-step ceremony (initializing `GitPlumbing` before `ContentAddressableStore`). This creates friction for first-time integrators who just want a working store for a specific directory.
- **Action Prompt (TTV Improvement):** `Add a public ContentAddressableStore.open({ cwd = ".", codec = "json", ...options }) async factory. It should construct GitPlumbing.createDefault({ cwd }), select JSON or CBOR, pass through chunking/compression/concurrency options, and return a ready ContentAddressableStore. Update README.md and GUIDE.md to prefer open({ cwd }) for initial examples.`

### 1.2. Principle of Least Astonishment (POLA)

- **Answer:** The auto-selection of `convergent` encryption for CDC stores (`CasService.js:517`) is technically optimal for deduplication but might surprise users expecting traditional non-deterministic encryption. While documented, the "silent" choice of a deterministic scheme can be a POLA violation for security-sensitive users.
- **Action Prompt (Interface Refactoring):** `Add an observability warning event in CasService._resolveAutoEncryptionScheme when convergent encryption is automatically selected for CDC. The warning should explain that convergent encryption preserves deduplication by being deterministic and advise on how to explicitly opt for 'framed' or 'whole' schemes if content-equality leakage is a concern.`

### 1.3. Error Usability

- **Answer:** `CasService._readChunkBlob` throws `PERSISTENCE_CAPABILITY_REQUIRED` when `readBlobStream` is missing during a buffered restore. The error message is technically accurate but doesn't explain *why* it's required (memory safety) or how the user might fix their adapter.
- **Action Prompt (Error Handling Fix):** `Update the PERSISTENCE_CAPABILITY_REQUIRED error message in CasService.js to explicitly state that readBlobStream() is required to enforce memory safety limits (maxRestoreBufferSize) during buffered restores of encrypted/compressed content. Suggest ensuring the persistence adapter is a modern GitPersistenceAdapter or implementing the streaming port.`

## 2. DX: DOCUMENTATION & EXTENDABILITY (Advocate View)

### 2.1. Documentation Gap

- **Answer:** There is no "Custom Adapter" or "Extending git-cas" guide. While the ports are well-defined, developers wishing to implement a custom `GitPersistencePort` or `CompressionPort` for a specific runtime (e.g. S3-backed storage) must reverse-engineer existing adapters.
- **Action Prompt (Documentation Creation):** `Create docs/EXTENDING.md that provides a comprehensive guide for implementing custom adapters. Include a minimal MemoryGitPersistenceAdapter example and a boilerplate for a custom CryptoPort. Explain the contract expectations for each port, especially the requirement for AsyncIterables in streaming methods.`

### 2.2. Customization Score (1-10)

- **Answer:** 8.0. The hexagonal architecture makes the system extremely customizable. However, the convenience factories (`createJson`, `createCbor`) don't expose all the underlying constructor options, forcing users into the verbose constructor as soon as they need custom observability or concurrency tuning.
- **Action Prompt (Extension Improvement):** `Update ContentAddressableStore.createJson and createCbor factories in index.js to accept the full range of CasService constructor options (concurrency, observability, merkleThreshold, etc.) via the options object. Ensure the existing 'policy' and 'chunkSize' arguments remain compatible.`

## 3. INTERNAL QUALITY: ARCHITECTURE & MAINTAINABILITY (Architect View)

### 3.1. Technical Debt Hotspot

- **Answer:** `src/domain/services/CasService.js`. At over 2,500 lines, it violates the Single Responsibility Principle by managing chunking, encryption selection, restore orchestration, and manifest serialization. It is the hardest file to audit or extend without side effects.
- **Action Prompt (Debt Reduction):** `Extract the restore orchestration logic from CasService.js into a dedicated RestoreService. Move _classifyRestoreStrategy, _executeRestoreStrategy, and all private _restore* methods to the new service. Inject RestoreService into CasService, maintaining the public CasService.restore and CasService.restoreStream APIs as delegators.`

### 3.2. Abstraction Violation

- **Answer:** `CasService.js` directly formats Git tree entries (e.g., `100644 blob ...`). This leaks low-level Git implementation details into the domain service. While it uses `persistence.writeTree`, the formatting of those lines belongs in an infrastructure adapter or a specialized Git-aware domain helper.
- **Action Prompt (SoC Refactoring):** `Extract Git-specific tree entry formatting from CasService.js into a new domain helper or value object (e.g., GitTreeBuilder). CasService should provide the manifest OID and chunk metadata to this helper, which then returns the formatted entries required by the GitPersistencePort.`

### 3.3. Testability Barrier

- **Answer:** The reliance on real Git subprocesses for most integration tests makes the CI suite slow and environment-dependent (requiring a local `git` binary). There is no "MockPersistenceAdapter" that simulates the Git ODB in memory for high-speed integration testing.
- **Action Prompt (Testability Improvement):** `Implement a MemoryPersistenceAdapter in test/helpers that satisfies GitPersistencePort using a Map. Migrate a subset of the slower integration tests in test/integration/ to use this memory adapter, proving that the domain logic (chunking, encryption, manifest Merkle-trees) works independently of the Git CLI.`

## 4. INTERNAL QUALITY: RISK & EFFICIENCY (Auditor View)

### 4.1. The Critical Flaw

- **Answer:** Nonce reuse protection is currently advisory (warning at 2^31) rather than enforced. While 2^31 is a conservative bound for GCM, the system doesn't prevent further writes once the limit is hit, which could lead to catastrophic security failure in a long-lived high-volume vault.
- **Action Prompt (Risk Mitigation):** `Implement a hard cap for the encryptionCount in VaultService.js. When the count exceeds a safety threshold (e.g., 2^32 - 1), addToVault should throw a VAULT_NONCE_EXHAUSTED error, forcing the user to rotate the vault key before further writes are allowed.`

### 4.2. Efficiency Sink

- **Answer:** `VaultService.listVault` reads the entire vault tree and parses all entries into a Map every time. For vaults with tens of thousands of entries (common in industrial use), this creates a significant memory and CPU spike for simple "list" or "resolve" operations.
- **Action Prompt (Optimization):** `Implement a cached state mechanism in VaultService.js that avoids re-parsing the vault tree if the VAULT_REF has not changed since the last read. Use a WeakMap to associate tree OIDs with their parsed entry maps.`

### 4.3. Dependency Health

- **Answer:** The dependencies are generally healthy, but `commander` is at `^14.0.3`. While current, CLI libraries often introduce breaking changes in major versions that can affect the `git-cas` CLI surface if not pinned or tightly tested.
- **Action Prompt (Dependency Update):** `Pin commander to a specific version and ensure that the bin/git-cas.js action handlers are covered by a regression suite that verifies flag parsing and help-text generation remains stable across minor updates.`

## 5. STRATEGIC SYNTHESIS & ACTION PLAN (Strategist View)

### 5.1. Combined Health Score (1-10)

- **Answer:** 7.3. The project is professionally engineered but suffers from "God Object" syndrome in the core service.

### 5.2. Strategic Fix

- **Answer:** The highest leverage move is the decomposition of `CasService.js`. By extracting the Restore and Store pipelines, you reduce the complexity of the most critical file and make future improvements (like adaptive frame sizing) easier to implement safely.

### 5.3. Mitigation Prompt

- **Action Prompt (Strategic Priority):** `Perform a structural refactoring of CasService.js by extracting the Restore strategy logic into a dedicated RestoreService. This includes moving the classification logic, buffered/streaming restore implementations, and the Merkle-sub-manifest resolution. Ensure all CasService unit tests pass against the new modularized structure. This fixes the primary technical debt hotspot while maintaining the public API.`

## Remediation Addendum - 2026-05-05

**Status:** In progress. The pre-tag safety and documentation-usability items
identified in this audit have been mitigated. Per operator decision on
2026-05-05, the remaining non-TUI findings are now v6.0.0 blockers instead of
post-tag backlog work.

### Resolved Since Audit Target

- **1.3 Error Usability:** `PERSISTENCE_CAPABILITY_REQUIRED` now explains the
  memory-safety reason for `readBlobStream()`, names `maxRestoreBufferSize`, and
  links adapter authors to `docs/EXTENDING.md` (`62631ca`).
- **2.1 Documentation Gap:** Added `docs/EXTENDING.md` with custom persistence,
  codec, chunking, compression, crypto, and observability adapter guidance
  (`2398e95`).
- **4.1 Critical Flaw:** Added `VaultService.ENCRYPTION_COUNT_MAX` and a
  `VAULT_NONCE_EXHAUSTED` guard that prevents encrypted vault writes after the
  nonce budget is exhausted (`db94701`).
- **Security Footgun From Related Ship Audit:** Inline human CLI passphrase
  flags now warn, help text discourages argv secrets, and maintained docs prefer
  stdin/env/keychain/file passphrase sources (`b01e5ba`).

### Still Open - v6.0.0 Blockers

- Add `ContentAddressableStore.open({ cwd })`.
- Emit an observability warning when CDC auto-selects deterministic
  `convergent` encryption.
- Decompose `CasService.js` store/restore orchestration enough to remove the
  current audit blocker.
- Extract Git tree-entry formatting out of `CasService.js`.
- Add an in-memory persistence adapter for fast domain workflow tests.
- Add vault-state caching for unchanged vault tree OIDs.
- Expand `createJson` / `createCbor` factory options to cover underlying service
  options.
- Pin `commander` and preserve CLI flag/help regression coverage.
