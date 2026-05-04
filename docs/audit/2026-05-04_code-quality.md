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
  total_findings: 9
  severity_count:
    critical: 0
    high: 2
    medium: 5
    low: 2
  remediation_status: "Pending"
related_reports:
  previous_audit: "AUD-2026-04-11-CODE-QUALITY"
  tracking_ticket: "docs/method/backlog/bad-code/TR_casservice-decomposition-pressure.md"
---

# AUDIT 1: CODE QUALITY

## 0. 🏆 EXECUTIVE REPORT CARD (Strategic Lead View)

| **Metric** | **Score (1-10)** | **Recommendation** |
|---|---:|---|
| **Developer Experience (DX)** | 7.5 | **Best of:** The `ContentAddressableStore.createJson({ plumbing })` facade keeps the normal library path compact while hiding runtime crypto, chunker, compression, manifest version, and vault-service wiring. |
| **Internal Quality (IQ)** | 7.0 | **Watch Out For:** Core behavior is well-tested, but orchestration remains concentrated in very large modules (`CasService.js` at 2,535 lines and `bin/agent/cli.js` at 2,213 lines). |
| **Overall Recommendation** | **THUMBS UP** | **Justification:** The shipped architecture is coherent and verified, but the release candidate should pay down docs/example drift before tagging because it weakens the public contract. |

## 1. DX: ERGONOMICS & INTERFACE CLARITY (Advocate View)

### 1.1. Time-to-Value (TTV) Score (1-10)

- **Answer:** 7.5. The CLI TTV is strong: `git-cas vault init`, `git-cas store ... --tree`, and `git-cas restore ...` are discoverable from `README.md:32-37`. The library path is also concise, but it still requires a caller to know how to build `@git-stunts/plumbing` first (`README.md:51-60`, `GUIDE.md:65-88`). The single biggest setup step is the two-object initialization ceremony: `GitPlumbing.createDefault({ cwd })`, then `ContentAddressableStore.createJson({ plumbing })`. This is manageable for experienced integrators, but it is still the first point where docs/API drift appeared.
- **Action Prompt (TTV Improvement):** `Add a public ContentAddressableStore.open({ cwd = ".", codec = "json", ...options }) async factory. It should construct GitPlumbing.createDefault({ cwd }), select JSON or CBOR, pass through chunking/compression/concurrency options, and return a ready ContentAddressableStore. Update README.md, GUIDE.md, docs/API.md, and examples to prefer open({ cwd }) for first-contact snippets while preserving createJson/createCbor for advanced callers. Add a unit test proving open({ cwd }) initializes a store against a temporary Git repo.`

### 1.2. Principle of Least Astonishment (POLA)

- **Answer:** The most significant POLA risk is the CDC + encryption default. `CasService._resolveAutoEncryptionScheme()` defaults encrypted CDC stores to `convergent` unless the caller opts out (`src/domain/services/CasService.js:517-522`). That is technically aligned with deduplication goals, and `README.md:83-90` documents it, but many developers hear "AES-GCM encryption" and intuitively expect random-nonce semantic security by default. Convergent encryption intentionally leaks plaintext equality under the same master key; that tradeoff is documented in `SECURITY.md:220-223` but remains easy to miss at the point of use.
- **Action Prompt (Interface Refactoring):** `Improve the CDC + encryption default UX without breaking v6 behavior. Add an observability warning when store() auto-selects convergent encryption, including scheme: "convergent", reason: "cdc-dedup-preservation", and mitigation: "set encryption: { convergent: false } or encryption: { scheme: 'framed' } when content equality is sensitive". Add README/GUIDE callouts directly beside CDC encrypted examples. Add tests asserting the warning fires only for auto-selected convergent mode, not explicit scheme: "convergent".`

### 1.3. Error Usability

- **Answer:** `KeyResolver.resolveForDecryption()` throws `CasError('Encryption key required to restore encrypted content', 'MISSING_KEY')` when encrypted content is restored without a key (`src/domain/services/KeyResolver.js:106-109`). The code is stable, but the message does not explain which credential sources work for the facade, CLI, agent CLI, or envelope recipients. It also does not point to `GUIDE.md#restore-modes`, `GUIDE.md#passphrase-based-encryption`, or `docs/API.md#error-codes`.
- **Action Prompt (Error Handling Fix):** `Update KeyResolver.resolveForDecryption() so MISSING_KEY says: "Encrypted content requires a credential: provide encryptionKey, passphrase, a matching recipient key, --key-file, --vault-passphrase-file, --os-keychain-target, or GIT_CAS_PASSPHRASE. See GUIDE.md#passphrase-based-encryption and docs/API.md#error-codes." Preserve code: "MISSING_KEY" and meta shape. Add unit tests covering direct restore, passphrase-less encrypted manifest, and envelope manifest with no supplied key.`

## 2. DX: DOCUMENTATION & EXTENDABILITY (Advocate View)

### 2.1. Documentation Gap

- **Answer:** The weakest missing content is a runnable "Custom Ports Cookbook". `ADVANCED_GUIDE.md` now documents direct `CasService` requirements and the port method table, but there is no copy-pasteable example for a custom `GitPersistencePort`, `CompressionPort`, or browser/Deno-focused adapter. That matters because direct construction now requires `chunker` and `compressionAdapter` injections (`src/domain/services/CasService.js:119-125`, `src/domain/services/CasService.js:136-145`), and advanced users are the exact audience likely to need the port path.
- **Action Prompt (Documentation Creation):** `Create docs/EXTENDING.md as a runnable cookbook for custom adapters. Include one minimal in-memory GitPersistencePort for tests, one no-op CompressionPort for runtimes without gzip, and a direct CasService construction example using FixedChunker, JsonCodec, SilentObserver, and a crypto adapter. Link docs/EXTENDING.md from README.md, GUIDE.md, ADVANCED_GUIDE.md, and docs/API.md. Add a docs test that imports every cookbook snippet or validates the examples with a temporary repo.`

### 2.2. Customization Score (1-10)

- **Answer:** 8. The core is highly customizable through ports: persistence, refs, crypto, codec, compression, observability, chunking, and policy are all swappable. The strongest extension point is the facade constructor, which accepts `chunking`, `chunker`, `compressionAdapter`, `crypto`, and `policy` (`index.js:65-80`). The weakest extension point is the convenience factory layer: `createJson()` and `createCbor()` only accept `plumbing`, `chunkSize`, and `policy` (`index.js:167-188`), forcing callers into the full constructor as soon as they need CDC, compression, concurrency, observability, or custom crypto.
- **Action Prompt (Extension Improvement):** `Extend ContentAddressableStore.createJson() and createCbor() to accept the same non-codec options as the constructor: crypto, observability, merkleThreshold, concurrency, chunking, chunker, maxRestoreBufferSize, and compressionAdapter. Keep the existing signature backward-compatible. Update index.d.ts and declaration tests so factory options stay type-accurate. Update README/GUIDE snippets to show CDC via createJson({ plumbing, chunking: { strategy: 'cdc' } }).`

## 3. INTERNAL QUALITY: ARCHITECTURE & MAINTAINABILITY (Architect View)

### 3.1. Technical Debt Hotspot

- **Answer:** `src/domain/services/CasService.js` is the primary debt hotspot. It is 2,535 lines and owns store orchestration (`store()` at `src/domain/services/CasService.js:923-948`), encryption scheme selection (`src/domain/services/CasService.js:476-523`), restore strategy classification/execution (`src/domain/services/CasService.js:1474-1515`), manifest reads and legacy scheme mapping (`src/domain/services/CasService.js:1980-2048`), and integrity verification (`src/domain/services/CasService.js:2465-2534`). The service has improved through extracted `KeyResolver`, `ConvergentEncryption`, `PrefetchWindow`, and compression ports, but it remains the main coupling point for future changes.
- **Action Prompt (Debt Reduction):** `Incrementally extract CasService store orchestration into src/domain/services/StorePipeline.js without changing the public CasService API. Move _resolveStoreEncryptionConfig, _resolveAutoEncryptionScheme, _dispatchStore, _storeConvergentSource, _storeEncryptedSource, and _buildManifestData behind a StorePipeline class that receives crypto, chunker, compressionAdapter, keyResolver, observability, and persistence as injected dependencies. Keep CasService.store() as a thin coordinator. Add focused unit tests proving manifests are byte-for-byte identical before and after extraction for plaintext, framed, convergent, gzip, and envelope stores.`

### 3.2. Abstraction Violation

- **Answer:** The clearest Separation of Concerns violation is `bin/agent/cli.js`. It combines protocol output, input parsing, request JSON normalization, command dispatch, filesystem reads, credential resolution, vault reporting, and per-command use-case logic in one 2,213-line module (`bin/agent/cli.js:16-34`, `bin/agent/cli.js:447-460`, `bin/agent/cli.js:1452-1534`, `bin/agent/cli.js:1591-2213`). This makes the machine-facing surface harder to evolve independently from command behavior.
- **Action Prompt (SoC Refactoring):** `Split bin/agent/cli.js into command modules under bin/agent/commands/. Keep protocol/session handling in bin/agent/cli.js, parsing helpers in bin/agent/input.js, and command implementations in one file per command family: store.js, restore.js, recipient.js, vault.js, diagnostics.js. Export a COMMAND_HANDLERS map from bin/agent/commands/index.js. Preserve runAgentCli(argv, deps) behavior and existing tests. Add a module-boundary test that bin/agent/cli.js no longer imports ContentAddressableStore directly.`

### 3.3. Testability Barrier

- **Answer:** Fast unit tests are harder when behavior depends on real Git subprocesses. `GitPersistenceAdapter` shells out through `@git-stunts/plumbing` for `hash-object`, `mktree`, `cat-file`, and `ls-tree` (`src/infrastructure/adapters/GitPersistenceAdapter.js:41-63`, `src/infrastructure/adapters/GitPersistenceAdapter.js:84-103`). That is correct for the production adapter, but there is no maintained in-memory persistence/ref adapter pair for high-speed domain tests or examples of custom adapter conformance.
- **Action Prompt (Testability Improvement):** `Add test/support/MemoryGitPersistenceAdapter.js and test/support/MemoryGitRefAdapter.js implementing the persistence/ref port contracts with deterministic in-memory maps. Add a shared conformance suite that runs against both memory adapters and the real Git adapters. Migrate pure domain tests that do not need real Git object behavior to the memory pair, preserving at least one integration suite for real Git plumbing.`

## 4. INTERNAL QUALITY: RISK & EFFICIENCY (Auditor View)

### 4.1. The Critical Flaw

- **Answer:** The highest-impact hidden risk is the continued support and documentation of inline passphrase flags. The human CLI exposes `--vault-passphrase <pass>` on store and vault init (`bin/git-cas.js:244-246`, `bin/git-cas.js:506-508`) and exposes `--old-passphrase <pass>` / `--new-passphrase <pass>` on vault rotation (`bin/git-cas.js:724-728`). `GUIDE.md` also lists these flags in the normal flag tables (`GUIDE.md:660`, `GUIDE.md:683`, `GUIDE.md:708`, `GUIDE.md:717-718`). The implementation prefers env/file/keychain in wording, but the inline path still invites shell history and process-list exposure.
- **Action Prompt (Risk Mitigation):** `Deprecate inline passphrase flags in the human CLI. Keep them for one major line behind an explicit warning on stderr and observability warning event. Prefer --vault-passphrase-file, stdin, OS keychain, or GIT_CAS_PASSPHRASE in examples. Add a future-breaking option plan to require --allow-insecure-passphrase-arg for inline values. Update GUIDE.md, docs/API.md, docs/WALKTHROUGH.md, and SECURITY.md. Add CLI tests asserting warnings for inline flags and no warnings for file/env/keychain sources.`

### 4.2. Efficiency Sink

- **Answer:** Vault stats read manifests sequentially. The human CLI loops through filtered entries and awaits each `cas.readManifest()` before continuing (`bin/git-cas.js:585-589`); the agent CLI has the same pattern (`bin/agent/cli.js:2202-2205`). This is easy to reason about, but it underuses the existing concurrency/prefetch posture for large vaults.
- **Action Prompt (Optimization):** `Optimize vault stats by adding a bounded map helper that reads manifests with concurrency equal to the configured CAS concurrency, capped at 64. Use it in both human CLI vault stats and agent vault stats. Preserve output ordering by collecting results by original index. Add tests that inject delayed readManifest calls and assert concurrent scheduling while preserving deterministic result order.`

### 4.3. Dependency Health

- **Answer:** Production dependency audit is clean: `pnpm audit --prod --json` reported 0 critical/high/moderate/low vulnerabilities across 25 production dependencies. `pnpm outdated --format json` did identify routine lag: `cbor-x` `1.6.0 -> 1.6.4`, `@git-stunts/alfred` `0.10.0 -> 0.10.3`, `zod` `3.25.76 -> 4.4.3`, plus dev-tool majors for `eslint` and `vitest`. No dependency is currently known from this audit to be deprecated or security-flawed.
- **Action Prompt (Dependency Update):** `Create a maintenance branch that updates patch/minor production dependencies first: cbor-x to 1.6.4 and @git-stunts/alfred to 0.10.3. Run npm test, npx eslint ., npm run release:verify -- --skip-jsr, and package dry-run. Treat zod 4, eslint 10, and vitest 4 as separate upgrade tickets requiring breaking-change review and test-runner compatibility checks.`

## 5. STRATEGIC SYNTHESIS & ACTION PLAN (Strategist View)

### 5.1. Combined Health Score (1-10)

- **Answer:** 7.3. The core is substantially healthier than the module sizes suggest because it has strong ports, schema validation, multi-runtime tests, and security controls. The main risks are release-truth drift at the public edge and continued accumulation in orchestration modules.

### 5.2. Strategic Fix

- **Answer:** Fix the public example and documentation drift around the v6 `Uint8Array` byte contract. This improves DX immediately because examples become runnable again, and it improves internal quality because it forces test coverage over public examples instead of relying on manually maintained prose.

### 5.3. Mitigation Prompt

- **Action Prompt (Strategic Priority):** `Fix every example and example-bearing document for the v6 Uint8Array public byte contract. Replace Node Buffer-only assertions such as buffer.equals(...) with byte-equality helpers that accept Uint8Array, and replace buffer.toString() with TextDecoder or Buffer.from(buffer).toString() only at Node display boundaries. Add a test/unit/docs/examples-run.test.js suite that executes examples/store-and-restore.js, examples/encrypted-workflow.js, and examples/progress-tracking.js in isolated temporary repos. Update examples/README.md to state that examples are covered by tests. Run node examples/*.js, npm test, npx eslint ., and npm run release:verify -- --skip-jsr.`
