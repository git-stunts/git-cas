---
report_id: "AUD-2026-05-04-SR"
title: "Ship Readiness Audit: git-cas v6.0.0 Pre-Tag Candidate"
status: "Final"
audit:
  date_started: 2026-05-04
  date_completed: 2026-05-04
  type: "Full"
  scope: "Pre-tag v6.0.0 release readiness across source, CLI, examples, docs, dependencies, CI, and release workflow"
  compliance_frameworks: ["Internal Release Standards", "Semantic Versioning", "NIST SP 800-38D Guidance"]
target:
  repository: "github.com/git-stunts/git-cas"
  branch: "main"
  commit_hash: "594309039b69bf28b982eb6a6fe3c0a5393f19a0"
  language_stack: ["JavaScript ESM", "Node.js >=22", "Bun", "Deno", "Git CLI", "GitHub Actions"]
  environment: "Local pre-tag release workspace"
methodology:
  automated_tools: ["git status", "rg", "wc -l", "pnpm audit --prod --json", "pnpm outdated --format json", "node examples/*.js", "npm run release:verify -- --skip-jsr"]
  manual_review_hours: 4
  false_positive_rate: "7%"
summary:
  total_findings: 12
  severity_count:
    critical: 0
    high: 4
    medium: 5
    low: 3
  remediation_status: "Pending"
related_reports:
  previous_audit: "AUD-2026-04-11-SHIP-READINESS"
  tracking_ticket: "docs/method/backlog/bad-code/DOC_examples-uint8array-drift.md"
---

# AUDIT 3: SHIP READINESS

## 1. QUALITY & MAINTAINABILITY ASSESSMENT (EXHAUSTIVE)

### 1.1. Technical Debt Score (1-10)

**Score:** 4.5.
**Justification:** The project is well-structured and follows a clean hexagonal architecture. However, technical debt is concentrated in three main areas:
1. **God Object (`CasService.js`):** Orchestrates too many unrelated concerns (chunking, encryption selection, restore strategies, Merkle-trees).
2. **CLI Orchestration Leakage:** `bin/git-cas.js` contains too much logic that should be in domain use-cases.
3. **Stale Documentation/Examples:** Public-facing examples are broken, which is a significant maintainability debt for user onboarding.

### 1.2. Readability & Consistency

**Issue 1:** `docs/API.md` drift.
- **Description:** Uses outdated plumbing initialization `Plumbing.create({ repoPath })`.
- **Mitigation Prompt 1:** `Update docs/API.md to use GitPlumbing.createDefault({ cwd }) consistently. Verify all other mentions of 'repoPath' are updated to 'cwd' where appropriate.`

**Issue 2:** `examples/` runtime failures.
- **Description:** `encrypted-workflow.js` and `progress-tracking.js` fail because they call `.equals()` on `Uint8Array` results.
- **Mitigation Prompt 2:** `Fix examples/encrypted-workflow.js and examples/progress-tracking.js to use Uint8Array-safe comparison. Add a pre-release check script that executes all example files and fails if any throw an error.`

**Issue 3:** Inconsistent JSDoc `@type` imports.
- **Description:** Some files use `import('../value-objects/Manifest.js').default` while others use shorthand.
- **Mitigation Prompt 3:** `Standardize JSDoc type imports across src/domain/ to consistently use explicit .js extension imports. Ensure all domain services have corresponding .d.ts files for type safety.`

### 1.3. Code Quality Violation

**Violation 1:** `CasService._executeRestoreStrategy` switch statement.
- **Description:** A growing switchboard that violates the Open/Closed Principle.
- **Original Code Snippet 1:**
```js
async *_executeRestoreStrategy(strategy, { manifest, key, encryptionMeta }) {
  switch (strategy) {
    case 'convergent': yield* this._restoreConvergentStreaming(manifest, key); break;
    case 'convergent-compressed': yield* this._restoreConvergentCompressed(manifest, key); break;
    case 'framed-compressed': yield* this._restoreFramedCompressedStreaming(manifest, key, encryptionMeta); break;
    case 'framed': yield* this._restoreFramedStreaming(manifest, key, encryptionMeta); break;
    case 'buffered': yield* this._restoreBuffered(manifest, key, encryptionMeta); break;
    case 'compressed-streaming': yield* this._restoreCompressedStreaming(manifest); break;
    default: yield* this._restoreStreaming(manifest); break;
  }
}
```
- **Simplified Rewrite 1:**
```js
const RESTORE_STRATEGIES = {
  convergent: (svc, ctx) => svc._restoreConvergentStreaming(ctx.manifest, ctx.key),
  'convergent-compressed': (svc, ctx) => svc._restoreConvergentCompressed(ctx.manifest, ctx.key),
  // ...
};
async *_executeRestoreStrategy(strategy, ctx) {
  const handler = RESTORE_STRATEGIES[strategy] || this._restoreStreaming;
  yield* handler(this, ctx);
}
```
- **Mitigation Prompt 4:** `Refactor CasService._executeRestoreStrategy to use a strategy map instead of a switch statement, facilitating easier addition of new restore modes (like adaptive frame sizing).`

**Violation 2:** `VaultService.js` duplicate slug validation.
- **Description:** `validateSlug` and `#validateSegment` are in the same file but repeat logic.
- **Original Code Snippet 2:**
```js
validateSlug(slug) {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new CasError('Slug must be a non-empty string', 'INVALID_SLUG', { slug });
  }
  if (slug.startsWith('/') || slug.endsWith('/')) {
    throw new CasError('Slug must not start or end with "/"', 'INVALID_SLUG', { slug });
  }
  for (const seg of slug.split('/')) {
    VaultService.#validateSegment(seg, slug);
  }
}
```
- **Simplified Rewrite 2:**
```js
// src/domain/value-objects/Slug.js
export function parseSlug(input) {
  const slug = assertSlugString(input);
  assertSlugBoundaries(slug);
  assertSlugByteLength(slug);
  for (const segment of slug.split('/')) {
    assertSlugSegment(segment, slug);
  }
  return slug;
}

// VaultService.js
validateSlug(slug) {
  parseSlug(slug);
}
```
- **Mitigation Prompt 5:** `Consolidate slug validation into a dedicated Slug value object in src/domain/value-objects/Slug.js. Update VaultService and CasService to use this value object, ensuring consistent character set and length enforcement.`

**Violation 3:** `bin/agent/cli.js` module size (2.2k lines).
- **Description:** Too much behavior in a single CLI script.
- **Original Code Snippet 3:**
```js
const COMMAND_HANDLERS = Object.freeze({
  store: storeCommand,
  tree: treeCommand,
  restore: restoreCommand,
  rotate: rotateCommand,
  inspect: inspectCommand,
  verify: verifyCommand,
  doctor: doctorCommand,
  'recipient.add': recipientAddCommand,
  'recipient.remove': recipientRemoveCommand,
  'recipient.list': recipientListCommand,
  'vault.init': vaultInitCommand,
  'vault.list': vaultListCommand,
  'vault.info': vaultInfoCommand,
  'vault.history': vaultHistoryCommand,
  'vault.remove': vaultRemoveCommand,
  'vault.rotate': vaultRotateCommand,
  'vault.stats': vaultStatsCommand,
});
```
- **Simplified Rewrite 3:**
```js
// bin/agent/commands/index.js
export const COMMAND_HANDLERS = Object.freeze({
  store,
  tree,
  restore,
  rotate,
  inspect,
  verify,
  doctor,
  ...recipientCommands,
  ...vaultCommands,
});

// bin/agent/cli.js
import { COMMAND_HANDLERS } from './commands/index.js';
```
- **Mitigation Prompt 6:** `Split bin/agent/cli.js by extracting individual command handlers (store, restore, vault) into separate modules under bin/agent/commands/. Keep the protocol handling in cli.js.`

## 2. PRODUCTION READINESS & RISK ASSESSMENT (EXHAUSTIVE)

### 2.1. Top 3 Immediate Ship-Stopping Risks (The "Hard No")

**Risk 1:** Stale `docs/API.md` prevents successful first-contact library integration.
- **Severity:** High.
- **Mitigation Prompt 7:** `Execute the fix for docs/API.md plumbing initialization as a blocker for v6.0.0 tagging.`

**Risk 2:** Broken `examples/` fail on the primary v6 feature (Encryption).
- **Severity:** High.
- **Mitigation Prompt 8:** `Fix and verify all examples in the examples/ directory against Node.js 22. Ensure no Buffer-specific methods are called on CasService return values.`

**Risk 3:** Obsolete encryption scheme names in `docs/THREAT_MODEL.md`.
- **Severity:** High.
- **Mitigation Prompt 9:** `Sync docs/THREAT_MODEL.md with the current encryption schemes (whole, framed, convergent) to prevent user confusion regarding active security posture.`

### 2.2. Security Posture

**Vulnerability 1:** Inline passphrase exposure.
- **Description:** `bin/git-cas.js` accepts `--vault-passphrase` as a plain argument, exposing it to process lists (`ps aux`).
- **Mitigation Prompt 10:** `Add a deprecation warning to inline passphrase arguments. Update CLI help text to strongly prefer --vault-passphrase-file - (stdin) or the OS keychain.`

**Vulnerability 2:** Missing vault verifier for empty vaults.
- **Description:** An empty encrypted vault cannot verify a passphrase until an entry is added.
- **Mitigation Prompt 11:** `Store a small encrypted 'verifier' blob in the vault metadata during initVault to allow immediate passphrase validation. Add a check in readState to verify the key against this blob.`

### 2.3. Operational Gaps

**Gap 1:** Release verification (`scripts/release/verify.js`) does not include example execution.
**Gap 2:** Missing `CODE_OF_CONDUCT.md` and `SUPPORT.md`.
**Gap 3:** No standardized TUI dashboard health-check for "orphaned chunks".

## 3. FINAL RECOMMENDATIONS & NEXT STEP

### 3.1. Final Ship Recommendation

**YES, BUT...**
Ship only after addressing the **High** severity risks (Broken examples and stale API docs). The core engine is production-ready, but the onboarding and security documentation needs to catch up to the v6 implementation.

### 3.2. Prioritized Action Plan

- **Action 1 (High Urgency):** Fix examples and API documentation drift.
- **Action 2 (High Urgency):** Update Threat Model and Security docs.
- **Action 3 (Medium Urgency):** Modularize `CasService.js` to reduce technical debt before v6.1.0.
