# DOC: Threat model still names legacy schemes as active choices

- **File**: `docs/THREAT_MODEL.md`
- **Severity**: High
- **Category**: Security documentation drift

## Description

The threat model still says `convergent-v1` encryption is active and recommends
`framed-v2` or `whole-v2` when content equality is sensitive. In v6, active
scheme names are `convergent`, `framed`, and `whole`; v1/v2 identifiers are
legacy migration inputs rejected by normal reads.

## Why It Bothers Us

Security-sensitive readers use the threat model as the boundary document. Stale
scheme names make it look like the repository has not completed the v6 scheme
simplification and can send users toward values the runtime rejects.

## Follow-Up

- Rewrite the active scheme paragraph to use `convergent`, `framed`, and
  `whole`.
- Move v1/v2 names into a migration-only note.
- Add a docs guard that rejects active-use wording for legacy scheme identifiers
  outside migration/design/archive contexts.
