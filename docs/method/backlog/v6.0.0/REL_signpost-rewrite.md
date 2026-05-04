# REL: Rewrite signpost docs for v6.0.0

## What

README, BEARING, VISION, and STATUS are the first docs users and contributors
see. They must reflect v6.0.0 as a shipped, stable release — not an in-progress
branch.

## README.md
- Lead with v6.0.0 identity
- Feature list reflects final shipped state
- Quick start examples work with v6 API
- Streaming surface matrix is final
- Migration guidance for v5 users prominently linked
- Version badges will auto-update after publish

## BEARING.md
- Phase timeline includes v6.0.0 release
- Resolved tensions updated (encryption-vs-dedup is DONE)
- Open tensions reflect post-v6 reality
- Next horizon is forward-looking (CasService decomposition, browser support)

## VISION.md
- Mindmap reflects v6 shipped architecture
- Tenets unchanged (they're stable)

## STATUS.md
- Version: 6.0.0
- Honest state: what works, what's known-limited
- Active queue: release gates until tag, then empty post-release
- Link to UPGRADING.md for migration

## Acceptance Criteria

- [x] All four docs rewritten
- [x] No in-progress language ("this branch", "security/audit-fixes")
- [x] Version references say 6.0.0
- [x] UPGRADING.md linked from README

## Evidence

- README leads with the v6.0.0 product identity and links UPGRADING.
- BEARING and VISION describe the simplified scheme architecture, convergent
  encryption, and the platform-agnostic `Uint8Array` core.
- STATUS is explicit that `v6.0.0` is the current release candidate and keeps
  the remaining release gates visible until tag/publish.
