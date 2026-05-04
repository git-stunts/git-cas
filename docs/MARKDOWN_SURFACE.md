# Markdown Surface Map

This document audits the tracked Markdown surface in `git-cas` and makes an
explicit recommendation for each file:

- `KEEP` — the file belongs where it is
- `CUT` — the file should stop existing in its current tracked form
- `MERGE` — the file's value should move into one or more other docs
- `MOVE` — the file should live elsewhere in the repo

More than one recommendation can apply at once.

## Root Policy

The repo root should contain only a small set of high-traffic, front-door, or
canonical project docs:

- package/front-door docs
- contributor and workflow docs
- security and architecture docs
- release history

Planning history, archive material, long-form tutorials, and tool-specific
instruction files should prefer `docs/`, `docs/method/`, `docs/archive/`, or
local-only surfaces.

## Root Markdown

- [README.md](../README.md): `KEEP` — package front door and adoption surface;
  belongs at the repo root.
- [CHANGELOG.md](../CHANGELOG.md): `KEEP` — canonical release history; belongs
  at the repo root.
- [CONTRIBUTING.md](../CONTRIBUTING.md): `KEEP` — contributor doctrine and
  onboarding surface; belongs at the repo root.
- [SECURITY.md](../SECURITY.md): `KEEP` — canonical security guidance and
  vulnerability-routing surface; belongs at the repo root.
- [WORKFLOW.md](../WORKFLOW.md): `KEEP` — planning and delivery model for fresh
  work, now as a root signpost into `docs/method/`; belongs at the repo root.
- [ARCHITECTURE.md](../ARCHITECTURE.md): `KEEP` — canonical high-level
  architecture map; still useful as a root-level reference.
- [ROADMAP.md](../ROADMAP.md): `KEEP`, `MERGE` — a slim sequence-context
  signpost is useful at the repo root, but it should stay derivative.
- [STATUS.md](../STATUS.md): `KEEP`, `MERGE` — compact snapshot value is real,
  but it should stay derivative and slim.
- [GRAVEYARD.md](../GRAVEYARD.md): `KEEP`, `MOVE` — still useful historical
  context, but it belongs under `docs/archive/` instead of the repo root.
- [CLAUDE.md](../CLAUDE.md): `CUT`, `MOVE` — tool-specific instruction files
  should not occupy tracked root doctrine alongside canonical project docs.

## Canonical Docs Under `docs/`

- [docs/API.md](./API.md): `KEEP` — canonical API reference; belongs under
  `docs/`.
- [docs/THREAT_MODEL.md](./THREAT_MODEL.md): `KEEP` — canonical threat model;
  belongs under `docs/`.
- [ADVANCED_GUIDE.md](../ADVANCED_GUIDE.md): `KEEP` — benchmark guidance and
  published baselines in the advanced guide.
- [docs/RELEASE.md](./RELEASE.md): `KEEP` — docs-level release signpost belongs
  under `docs/`.
- [docs/DOCS_CHECKLIST.md](./DOCS_CHECKLIST.md): `KEEP` — maintainer-facing docs
  review checklist belongs under `docs/`.
- [GUIDE.md](../GUIDE.md): `KEEP` — the long-form tutorial is still a
  maintained root guide until a dedicated guide move lands.
- [docs/ADR-001-vault-in-facade.md](./ADR-001-vault-in-facade.md): `KEEP` —
  accepted architecture decision record; current placement is fine until there
  is a broader ADR collection.
- [docs/MARKDOWN_SURFACE.md](./MARKDOWN_SURFACE.md): `KEEP` — this audit belongs
  under `docs/` as repo-maintainer guidance, not at the root.

## METHOD Planning Surface

- [docs/method/process.md](./method/process.md): `KEEP` — canonical planning
  and delivery process for fresh work.
- [docs/method/release.md](./method/release.md): `KEEP` — canonical release
  process for fresh work.
- [docs/method/backlog/README.md](./method/backlog/README.md): `KEEP` —
  canonical live backlog index.
- [docs/design/0044-casservice-decomposition-plan](./design/0044-casservice-decomposition-plan/casservice-decomposition-plan.md):
  `KEEP` — landed design record for the decomposition trajectory.
- [docs/method/backlog/bad-code/TR_platform-dependency-leaks.md](./method/backlog/bad-code/TR_platform-dependency-leaks.md):
  `KEEP` — active debt backlog work item.
- [docs/method/legends/README.md](./method/legends/README.md): `KEEP` —
  canonical legend index for fresh work.
- [docs/method/legends/RL_relay.md](./method/legends/RL_relay.md): `KEEP` —
  active METHOD legend doc.
- [docs/method/legends/TR_truth.md](./method/legends/TR_truth.md): `KEEP` —
  active METHOD legend doc.
- [docs/method/retro/README.md](./method/retro/README.md): `KEEP` — canonical
  retro location contract.
- [docs/method/graveyard/README.md](./method/graveyard/README.md): `KEEP` —
  canonical graveyard entrypoint.

## Legacy Planning Compatibility Surface

- [docs/BACKLOG/README.md](./BACKLOG/README.md): `KEEP` — legacy backlog
  signpost retained for older links, but no longer the active backlog.
- [docs/legends/README.md](./legends/README.md): `KEEP` — legacy legend
  signpost retained for older links.
- [docs/legends/RL-relay.md](./legends/RL-relay.md): `KEEP` — legacy legend
  compatibility doc.
- [docs/legends/TR-truth.md](./legends/TR-truth.md): `KEEP` — legacy legend
  compatibility doc.

## Landed Design Surface

- [docs/design/README.md](./design/README.md): `KEEP` — canonical landed design
  and active-cycle index.
- [docs/design/0020-method-adoption/adopt-method.md](./design/0020-method-adoption/adopt-method.md):
  `KEEP` — active METHOD cycle doc.
- [docs/design/0020-method-adoption/witness/verification.md](./design/0020-method-adoption/witness/verification.md):
  `KEEP` — active METHOD playback witness.
- [docs/design/0001-m18-relay-agent-cli.md](./design/0001-m18-relay-agent-cli.md):
  `KEEP` — legacy-named landed cycle history; retain until touched.
- [docs/design/0002-m18-relay-write-flows.md](./design/0002-m18-relay-write-flows.md):
  `KEEP` — legacy-named landed cycle history; retain until touched.
- [docs/design/0003-m18-relay-tree-creation.md](./design/0003-m18-relay-tree-creation.md):
  `KEEP` — legacy-named landed cycle history; retain until touched.
- [docs/design/RL-001-agent-recipient-list.md](./design/RL-001-agent-recipient-list.md):
  `KEEP` — landed cycle history.
- [docs/design/RL-002-agent-recipient-mutations.md](./design/RL-002-agent-recipient-mutations.md):
  `KEEP` — landed cycle history.
- [docs/design/RL-003-agent-rotate.md](./design/RL-003-agent-rotate.md):
  `KEEP` — landed cycle history.
- [docs/design/RL-004-agent-vault-rotate.md](./design/RL-004-agent-vault-rotate.md):
  `KEEP` — landed cycle history.
- [docs/design/RL-005-agent-vault-lifecycle.md](./design/RL-005-agent-vault-lifecycle.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-001-architecture-reality-gap.md](./design/TR-001-architecture-reality-gap.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-002-threat-model.md](./design/TR-002-threat-model.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-003-benchmark-baselines.md](./design/TR-003-benchmark-baselines.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-004-design-doc-lifecycle.md](./design/TR-004-design-doc-lifecycle.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-006-docs-maintainer-checklist.md](./design/TR-006-docs-maintainer-checklist.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-007-security-doc-discoverability-audit.md](./design/TR-007-security-doc-discoverability-audit.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-009-pre-pr-doc-cross-link-audit.md](./design/TR-009-pre-pr-doc-cross-link-audit.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-010-planning-index-consistency-review.md](./design/TR-010-planning-index-consistency-review.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-012-examples-surface-audit.md](./design/TR-012-examples-surface-audit.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-013-guide-accuracy-audit.md](./design/TR-013-guide-accuracy-audit.md):
  `KEEP` — landed cycle history.
- [docs/design/TR-014-markdown-surface-rationalization.md](./design/TR-014-markdown-surface-rationalization.md):
  `KEEP` — landed cycle history.

## Archive And Historical Intent

- [docs/archive/README.md](./archive/README.md): `KEEP` — archive entrypoint.
- [docs/archive/design/README.md](./archive/design/README.md): `KEEP` — reserved
  archive surface for retired design docs.
- [docs/archive/BACKLOG/README.md](./archive/BACKLOG/README.md): `KEEP` —
  canonical archive index for retired backlog cards.
- [docs/archive/BACKLOG/RL-001-agent-recipient-list.md](./archive/BACKLOG/RL-001-agent-recipient-list.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/RL-002-agent-recipient-mutations.md](./archive/BACKLOG/RL-002-agent-recipient-mutations.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/RL-003-agent-rotate.md](./archive/BACKLOG/RL-003-agent-rotate.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/RL-004-agent-vault-rotate.md](./archive/BACKLOG/RL-004-agent-vault-rotate.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/RL-005-agent-vault-lifecycle.md](./archive/BACKLOG/RL-005-agent-vault-lifecycle.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-001-architecture-reality-gap.md](./archive/BACKLOG/TR-001-architecture-reality-gap.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-002-threat-model.md](./archive/BACKLOG/TR-002-threat-model.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-003-benchmark-baselines.md](./archive/BACKLOG/TR-003-benchmark-baselines.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-004-design-doc-lifecycle.md](./archive/BACKLOG/TR-004-design-doc-lifecycle.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-006-docs-maintainer-checklist.md](./archive/BACKLOG/TR-006-docs-maintainer-checklist.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-007-security-doc-discoverability-audit.md](./archive/BACKLOG/TR-007-security-doc-discoverability-audit.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-009-pre-pr-doc-cross-link-audit.md](./archive/BACKLOG/TR-009-pre-pr-doc-cross-link-audit.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-010-planning-index-consistency-review.md](./archive/BACKLOG/TR-010-planning-index-consistency-review.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-012-examples-surface-audit.md](./archive/BACKLOG/TR-012-examples-surface-audit.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-013-guide-accuracy-audit.md](./archive/BACKLOG/TR-013-guide-accuracy-audit.md):
  `KEEP` — archived historical intent.
- [docs/archive/BACKLOG/TR-014-markdown-surface-rationalization.md](./archive/BACKLOG/TR-014-markdown-surface-rationalization.md):
  `KEEP` — archived historical intent.

## Invariants And Legends

- [docs/invariants/README.md](./invariants/README.md): `KEEP` — invariants index.
- [docs/invariants/I-001-determinism-trust-and-explicit-surfaces.md](./invariants/I-001-determinism-trust-and-explicit-surfaces.md):
  `KEEP` — active project invariant.
- [docs/method/legends/README.md](./method/legends/README.md): `KEEP` —
  current legend index.
- [docs/method/legends/RL_relay.md](./method/legends/RL_relay.md): `KEEP` —
  current legend doc.
- [docs/method/legends/TR_truth.md](./method/legends/TR_truth.md): `KEEP` —
  current legend doc.
- [docs/legends/README.md](./legends/README.md): `KEEP` — legacy compatibility
  legend index.
- [docs/legends/RL-relay.md](./legends/RL-relay.md): `KEEP` — legacy
  compatibility legend doc.
- [docs/legends/TR-truth.md](./legends/TR-truth.md): `KEEP` — legacy
  compatibility legend doc.

## Examples And Test Doctrine

- [examples/README.md](../examples/README.md): `KEEP` — examples index is useful,
  and now reflects the maintained examples surface audit.
- [test/CONVENTIONS.md](../test/CONVENTIONS.md): `KEEP` — test doctrine belongs
  near the test surface.
- [test/cycles/README.md](../test/cycles/README.md): `KEEP` — cycle-owned test
  directory contract belongs near the test surface.

## Local-Only And Non-Tracked Markdown

These files are not part of the tracked Markdown audit and should remain out of
the canonical tracked doctrine surface unless the repo makes an explicit policy
change:

- `AGENTS.md`
- `EDITORS-REPORT.md`
- `.claude/bad_code.md`
- `.claude/cool_ideas.md`

## Immediate Follow-On Priorities

If the repo wants to act on this audit, the highest-value next changes are:

1. move [GRAVEYARD.md](../GRAVEYARD.md) under `docs/archive/`
2. decide whether [CLAUDE.md](../CLAUDE.md) should leave tracked root entirely
3. collapse [STATUS.md](../STATUS.md) into other canonical surfaces and remove
   the duplicate snapshot doc
4. shrink and relocate [ROADMAP.md](../ROADMAP.md) once its remaining migration
   value is absorbed elsewhere
