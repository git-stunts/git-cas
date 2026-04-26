# REL: Audit and fix all documentation for v6.0.0 accuracy

## What

Every doc must accurately reflect v6.0.0. No references to removed features,
no stale API signatures, no broken code examples.

## Files to Audit

### Signpost docs (rewrite)
- `README.md` — full feature overview, quick start, streaming matrix
- `BEARING.md` — current direction, tensions, next horizon
- `VISION.md` — tenets, mindmap
- `STATUS.md` — honest state snapshot for v6.0.0

### Developer docs (verify accuracy)
- `GUIDE.md` — every code example must work with v6 API
- `ADVANCED_GUIDE.md` — every deep-dive must match current implementation
- `SECURITY.md` — crypto docs must reflect 3-scheme model
- `docs/API.md` — every method signature must match actual code

### Reference docs (verify)
- `ARCHITECTURE.md` — system map must include new modules (ConvergentEncryption, PrefetchWindow, ManifestDiff, schemes.js, CompressionPort)
- `CHANGELOG.md` — v6.0.0 entry must be comprehensive
- `CONTRIBUTING.md` — build/test instructions current
- `ROADMAP.md` — aligned with BEARING

## Checks

For each doc:
- [ ] No references to `whole-v1`, `framed-v1`, `whole-v2`, `framed-v2`, `convergent-v1` outside migration context
- [ ] No references to removed APIs or old defaults
- [ ] All code examples compile/work with v6 API
- [ ] All cross-doc links resolve to existing files
- [ ] Version numbers updated where applicable

## Acceptance Criteria

- [ ] `grep -r 'whole-v1\|framed-v1' *.md docs/*.md` returns only migration-context hits
- [ ] Every code example in GUIDE.md tested against actual API
- [ ] CHANGELOG has complete v6.0.0 section
