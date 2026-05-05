# v6.0.0 Release Readiness Audit: The Code Lawyer's Verdict

**Report ID:** `AUD-2026-05-05-RR`
**Status:** `Pass With Deferred v6.1.0 Follow-Up`
**Date:** 2026-05-05

## Summary

The v6.0.0 candidate represents a significant technical leap for `git-cas`. The introduction of `StorePipeline` and `RestorePipeline` signals a positive trend towards decoupling orchestration from byte-level execution.

The pre-tag polish findings from this audit have now been addressed, with one
explicit exception: the deeper byte-level handler extraction from `CasService.js`
is deferred to the v6.1.0 milestone by operator directive.

## Issue Count Breakdown

- **Critical:** 0
- **High:** 0
- **Medium:** 2
- **Low:** 3

## Findings

### ISSUE-001: CasService.js Logic Leak (Medium)
- **Resolution Status:** DEFERRED TO v6.1.0
- **File:** `src/domain/services/CasService.js`
- **Classification:** Code Smell (God Object / Half-Refactor)
- **Infraction:** While `StorePipeline` and `RestorePipeline` orchestration was extracted, the actual byte-level logic for every encryption and restore strategy remains in `CasService.js`. The class is still 2300+ lines.
- **Evidence:** Lines 1500–2300 contain implementation details for `restoreConvergentStreaming`, `restoreFramedStreaming`, etc.
- **Mitigation:** Extract byte-level strategy handlers into standalone classes or functions in the v6.1.0 line. This is not a v6.0.0 tag blocker.

### ISSUE-002: Credential Resolution Duplication (Medium)
- **Resolution Status:** RESOLVED
- **File:** `bin/git-cas.js` / `bin/agent/commands/index.js`
- **Classification:** Logic Duplication (DRY Violation)
- **Infraction:** Logic for resolving encryption keys from files, passphrases, and OS keychains is duplicated across the CLI entry point and the Agent command handler.
- **Mitigation:** Shared key-file validation, vault KDF derivation, CLI encryption-key resolution, and agent store/restore encryption-key resolution now live in `bin/credentials.js`. `bin/git-cas.js` and `bin/agent/commands/index.js` call the shared helpers instead of carrying local copies.

### ISSUE-003: Slug Validation Placement (Low)
- **Resolution Status:** RESOLVED
- **File:** `src/domain/services/VaultService.js`
- **Classification:** Architectural Misalignment
- **Infraction:** Slug validation logic (`#validateSegment`, `validateSlug`) remains in the service instead of being moved to a `Slug` value object.
- **Mitigation:** Added `src/domain/value-objects/Slug.js`. Validation, tree-entry encoding, tree-entry decoding, and the `.toTreePath()` helper now live on the value object. `VaultService` delegates slug validation and tree-path encoding to `Slug`.

### ISSUE-004: Dependency Inconsistency (Low)
- **Resolution Status:** RESOLVED
- **File:** `package.json`
- **Classification:** Consistency
- **Infraction:** Inconsistent version pinning for `@flyingrobots/bijou` family.
- **Evidence:** `@flyingrobots/bijou-tui-app` is pinned to `5.0.0` while `@flyingrobots/bijou` is `^5.0.0`.
- **Mitigation:** All `@flyingrobots/bijou*` runtime dependencies now use the caretaker range `^5.0.0`; `pnpm-lock.yaml` records the aligned specifier.

### ISSUE-005: Redundant Validation (Low)
- **Resolution Status:** RESOLVED
- **File:** `src/domain/services/CasService.js`
- **Classification:** Maintenance
- **Infraction:** Constructor logic performs redundant manual checks for `chunker` and `compressionAdapter` that bypass the private `#validateConstructorArgs` helper.
- **Mitigation:** `CasService.#validateConstructorArgs` now validates numeric constructor options and required injected ports (`chunker`, `compressionAdapter`) through one constructor validation entry point.

## Proactive Issue Resolution

The v6.0.0 polish blockers from this report are resolved. ISSUE-001 remains a
tracked v6.1.0 architecture follow-up and should not block the v6.0.0 tag.
