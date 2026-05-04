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

- [x] No references to `whole-v1`, `framed-v1`, `whole-v2`, `framed-v2`, `convergent-v1` outside migration context
- [x] No references to removed APIs or old defaults
- [x] All code examples compile/work with v6 API
- [x] All cross-doc links resolve to existing files
- [x] Version numbers updated where applicable

## Acceptance Criteria

- [x] `grep -r 'whole-v1\|framed-v1' *.md docs/*.md` returns only migration-context hits
- [x] Every code example in GUIDE.md tested against actual API
- [x] CHANGELOG has complete v6.0.0 section

## Evidence

- Public byte docs now describe `Uint8Array` as the core contract and keep
  Node `Buffer` references at adapter/boundary or historical-changelog context.
- The v6 changelog no longer advertises intermediate `whole-v2`/`framed-v2`
  states as shipped behavior.
- Package metadata, JSR metadata, and `src/package-version.js` now agree on
  `6.0.0`.
- `test/unit/docs/markdown-links.test.js` scans every tracked Markdown file and
  proves relative Markdown links point at existing files.
- `test/unit/docs/guide-examples.test.js` proves every `GUIDE.md` JavaScript
  fence parses, every JSON fence parses, the quick-start facade methods are on
  the public API, and the documented quick-start store/tree/vault/read/restore
  flow works against a real Git repository.
- The pre-tag type/doc cleanup adds an explicit GUIDE/ADVANCED feature
  coverage map, documents direct `CasService` port requirements, aligns README
  and example docs with actual CLI commands, and locks declaration accuracy
  with `test/unit/types/declaration-accuracy.test.js`.

## Status

- [x] Resolved — `main` pre-tag
