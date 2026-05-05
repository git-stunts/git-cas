# v6.0.0 Release Readiness Audit: The Code Lawyer's Verdict

**Report ID:** `AUD-2026-05-05-RR`  
**Status:** `Conditional Pass`  
**Date:** 2026-05-05

## Summary

The v6.0.0 candidate represents a significant technical leap for `git-cas`. The introduction of `StorePipeline` and `RestorePipeline` signals a positive trend towards decoupling orchestration from byte-level execution.

However, a pedantic review reveals several "slop" points and maintenance hotspots that should be addressed before the v6.0.0 tag to prevent them from becoming technical debt "anchors."

## Issue Count Breakdown

- **Critical:** 0
- **High:** 0
- **Medium:** 2
- **Low:** 3

## Findings

### ISSUE-001: CasService.js Logic Leak (Medium)
- **File:** `src/domain/services/CasService.js`
- **Classification:** Code Smell (God Object / Half-Refactor)
- **Infraction:** While `StorePipeline` and `RestorePipeline` orchestration was extracted, the actual byte-level logic for every encryption and restore strategy remains in `CasService.js`. The class is still 2300+ lines.
- **Evidence:** Lines 1500–2300 contain implementation details for `restoreConvergentStreaming`, `restoreFramedStreaming`, etc.
- **Mitigation:** Extract byte-level strategy handlers into standalone classes or functions.

### ISSUE-002: Credential Resolution Duplication (Medium)
- **File:** `bin/git-cas.js` / `bin/agent/commands/index.js`
- **Classification:** Logic Duplication (DRY Violation)
- **Infraction:** Logic for resolving encryption keys from files, passphrases, and OS keychains is duplicated across the CLI entry point and the Agent command handler.
- **Mitigation:** Move shared CLI/Agent logic into a `bin/helpers/credentials.js` helper module.

### ISSUE-003: Slug Validation Placement (Low)
- **File:** `src/domain/services/VaultService.js`
- **Classification:** Architectural Misalignment
- **Infraction:** Slug validation logic (`#validateSegment`, `validateSlug`) remains in the service instead of being moved to a `Slug` value object.
- **Mitigation:** Create `src/domain/value-objects/Slug.js` and delegate validation there.

### ISSUE-004: Dependency Inconsistency (Low)
- **File:** `package.json`
- **Classification:** Consistency
- **Infraction:** Inconsistent version pinning for `@flyingrobots/bijou` family.
- **Evidence:** `@flyingrobots/bijou-tui-app` is pinned to `5.0.0` while `@flyingrobots/bijou` is `^5.0.0`.
- **Mitigation:** Align all related dependencies to caret ranges.

### ISSUE-005: Redundant Validation (Low)
- **File:** `src/domain/services/CasService.js`
- **Classification:** Maintenance
- **Infraction:** Constructor logic performs redundant manual checks for `chunker` and `compressionAdapter` that bypass the private `#validateConstructorArgs` helper.
- **Mitigation:** Move all parameter validation into `#validateConstructorArgs`.

## Proactive Issue Resolution

The user is prompted to resolve these issues before the v6.0.0 tag is finalized.
