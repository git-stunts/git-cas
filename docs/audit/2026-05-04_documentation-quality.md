---
report_id: "AUD-2026-05-04-DQ"
title: "Documentation Quality Audit: git-cas v6.0.0 Pre-Tag Candidate"
status: "Final"
audit:
  date_started: 2026-05-04
  date_completed: 2026-05-04
  type: "Full"
  scope: "README.md, GUIDE.md, ADVANCED_GUIDE.md, docs/API.md, docs/WALKTHROUGH.md, SECURITY.md, docs/THREAT_MODEL.md, examples"
  compliance_frameworks: ["Internal Documentation Standards", "Keep a Changelog", "Semantic Versioning"]
target:
  repository: "github.com/git-stunts/git-cas"
  branch: "main"
  commit_hash: "594309039b69bf28b982eb6a6fe3c0a5393f19a0"
  language_stack: ["Markdown", "JavaScript ESM", "Node.js >=22", "Git CLI"]
  environment: "Local pre-tag release workspace"
methodology:
  automated_tools: ["rg", "find", "node examples/encrypted-workflow.js", "node examples/progress-tracking.js", "node examples/store-and-restore.js"]
  manual_review_hours: 3
  false_positive_rate: "5%"
summary:
  total_findings: 7
  severity_count:
    critical: 0
    high: 3
    medium: 2
    low: 2
  remediation_status: "In-Progress"
related_reports:
  previous_audit: "AUD-2026-04-11-DOCUMENTATION-QUALITY"
  tracking_ticket: "docs/method/backlog/bad-code/DOC_examples-uint8array-drift.md"
---

# AUDIT 2: DOCUMENTATION QUALITY

## 1. ACCURACY & EFFECTIVENESS ASSESSMENT

### 1.1. Core Mismatch

- **Issue:** Stale examples and documentation drift regarding the v6 `Uint8Array` byte contract.
- **Details:** `examples/encrypted-workflow.js` and `examples/progress-tracking.js` still attempt to use Node.js `Buffer` methods (like `.equals()`) on the `Uint8Array` results returned by `restore()`. This results in runtime errors (`TypeError: buffer.equals is not a function`). Additionally, `docs/API.md` uses a stale `@git-stunts/plumbing` initialization pattern (`Plumbing.create`) which has been replaced by `GitPlumbing.createDefault`.
- **Impact:** High. New users will encounter immediate failures when following the "maintained" examples.

### 1.2. Audience & Goal Alignment

- **Primary Audience:** Library integrators and CLI operators.
- **Effectiveness:** The documentation effectively covers basic store/restore cycles for both audiences. However, it fails to address the "Advanced Integrator" who needs to implement custom ports (e.g., for non-Node runtimes) despite the architecture's focus on hexagonal ports.
- **Missing Coverage:**
    1. How to implement a custom `GitPersistencePort`.
    2. How to handle large-scale vault migrations safely.
    3. Formal specification of the `framed` and `convergent` AAD binding patterns.

### 1.3. Time-to-Value (TTV) Barrier

- **Bottleneck:** The library initialization ceremony is the biggest TTV barrier. Requiring the user to import and initialize `@git-stunts/plumbing` before they can even create a `ContentAddressableStore` adds unnecessary cognitive load.
- **Mitigation:** A simplified `ContentAddressableStore.open({ cwd })` helper would significantly reduce TTV.

## 2. REQUIRED UPDATES & COMPLETENESS CHECK

### 2.1. README.md Priority Fixes

1. **Fix Ingress Example:** Update the library ingress snippet to use `Uint8Array`-safe comparisons (e.g., using `new TextDecoder().decode()`) and the correct `GitPlumbing` factory.
2. **Clarify Byte Contract:** Add a prominent note that `git-cas` 6.0.0 uses `Uint8Array` as its primary byte exchange format, moving away from Node.js `Buffer`.
3. **Link to UPGRADING.md:** Ensure the v5 to v6 migration path is clearly highlighted in the header for existing users.

### 2.2. Missing Standard Documentation

1. **`docs/EXTENDING.md`:** A guide for implementing custom ports and adapters.
2. **`CODE_OF_CONDUCT.md`:** Essential for a public-facing open-source project.
3. **`SECURITY.md` (Update):** The current `SECURITY.md` mentions `convergent-v1` which is now a legacy scheme. It needs to be updated to reflect the current `convergent`, `framed`, and `whole` scheme names.

### 2.3. Supplementary Documentation (Docs)

- **`src/domain/services/CasService.js`:** This file is currently the "everything service". A dedicated architectural document explaining the store/restore pipeline state machine would be highly beneficial for maintainers.

## 3. FINAL ACTION PLAN

### 3.1. Recommendation Type

- **A. Recommend incremental updates to the existing README and documentation.**
- **Justification:** The documentation is high-quality and comprehensive; it just needs a surgical strike to remove stale v5 patterns and v6-alpha drift.

### 3.2. Deliverable (Prompt Generation)

`Refactor maintained examples (examples/encrypted-workflow.js, examples/progress-tracking.js) to replace Node.js Buffer-specific methods with Uint8Array-safe logic. Update docs/API.md to reflect the correct @git-stunts/plumbing v2.8+ initialization pattern. Sync docs/THREAT_MODEL.md and SECURITY.md with the current encryption scheme names (whole, framed, convergent). Add a 'Byte Contract' section to README.md clarifying the Uint8Array requirement. Create docs/EXTENDING.md with a 'Custom Persistence' example. Create CODE_OF_CONDUCT.md using the Contributor Covenant template.`

### 3.3. Mitigation Prompt

`Execute the documentation accuracy pass: fix v6-byte-contract drift in examples/ and docs/API.md, align scheme names in docs/THREAT_MODEL.md with src/domain/encryption/schemes.js, and create docs/EXTENDING.md plus CODE_OF_CONDUCT.md. Ensure all examples pass 'node examples/*.js' after modification.`

## Remediation Addendum - 2026-05-05

**Status:** In progress. The release-blocking documentation drift has been
corrected. Per operator decision on 2026-05-05, the remaining non-TUI audit
items are now v6.0.0 blockers instead of future polish.

### Resolved Since Audit Target

- **1.1 Core Mismatch:** Maintained examples now honor the v6 `Uint8Array`
  byte contract, and `docs/API.md` uses `GitPlumbing.createDefault({ cwd })`
  instead of stale plumbing initialization (`d238aa3`).
- **2.2 Missing Standard Documentation:** Added `docs/EXTENDING.md`,
  `CODE_OF_CONDUCT.md`, and `SUPPORT.md`; README/GUIDE/ADVANCED_GUIDE now link
  the extension and participation surfaces (`2398e95`).
- **2.2 Security Documentation Drift:** Threat model wording was aligned with
  current `whole`, `framed`, and `convergent` scheme names (`d238aa3`).
- **Package Documentation Closure:** README-linked documentation and newly
  required standard docs are covered by package-surface tests and npm pack
  dry-run verification (`0bb67c4`, `2398e95`).
- **Release-State Truth:** The changelog remains explicitly pre-tagged as
  `[6.0.0] — Unreleased` until the operator approves tagging (`f1ef0e5`).

### Still Open - v6.0.0 Blockers

- Add `ContentAddressableStore.open({ cwd })`.
- Add a dedicated long-form store/restore pipeline state-machine document for
  maintainer onboarding.
