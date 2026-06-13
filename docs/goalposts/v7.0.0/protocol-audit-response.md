# v7.0.0 Protocol Audit Response

## Identity

| Field | Value |
| --- | --- |
| Goalpost id | `v7.0.0-gp-protocol-audit-response` |
| Release home | `v7.0.0` |
| Umbrella issue | `not opened yet` |
| Goalpost doc | `docs/goalposts/v7.0.0/protocol-audit-response.md` |
| Design cycle | `not active yet` |
| Slice budget | `unknown` |
| Status | `planned` |
| Sponsor human | `James` |
| Sponsor agent | `Codex` |

## Outcome

`v7.0.0` exists only if audit, protocol, storage, migration, or public API
evidence requires a breaking change. Otherwise the work remains in `v6.x`.

## Current Truth

- [BEARING.md](../../../BEARING.md) names formal crypto audit as an open
  tension.
- `v6.0.0` simplified encryption schemes and added migration tooling.
- No third-party audit result is currently recorded in the repo.

## Scope

- Record audit findings when they exist.
- Design migration paths for any required storage or protocol break.
- Make breaking changes only with explicit evidence and release notes.

## Out Of Scope

- Aesthetic refactors.
- Renaming public APIs without a protocol or safety reason.
- Breaking stored content compatibility for cleanup convenience.

## Proof Stories

| Story issue | Actor | Need | Reason | Slice budget |
| --- | --- | --- | --- | ---: |
| `not opened yet` | security reviewer | explicit protocol response | map audit findings to release behavior | unknown |
| `not opened yet` | operator | migration path | keep existing stores recoverable | unknown |
| `not opened yet` | maintainer | no gratuitous major release | preserve trust in semver | unknown |

## Slice Budget

| Slice | Status | Description | Expected proof |
| ---: | --- | --- | --- |
| 1 | blocked | Obtain or record audit findings. | audit artifact |
| 2 | blocked | Classify findings by semver impact. | design doc |
| 3 | blocked | Design migration and compatibility posture. | migration tests |

## Acceptance Criteria

- [ ] A breaking change is tied to concrete audit or protocol evidence.
- [ ] Migration behavior is tested before release.
- [ ] `UPGRADING.md`, `CHANGELOG.md`, and release evidence are updated.

## Deterministic Evidence

| Claim | Canonical fixture or input | Witness | Replay command | Expected deterministic result |
| --- | --- | --- | --- | --- |
| Breaking change is justified | audit finding | release design | `not applicable yet` | explicit finding-to-change trace |

## Substrate / Residency Geometry

| Reading claim | Basis | Aperture | Law/projection | Support obligations | Witness posture |
| --- | --- | --- | --- | --- | --- |
| Migration preserves recoverability | legacy fixtures | migration read aperture | old object graph to new manifest/protocol | fixture coverage | migration witness |

## Validation Plan

```bash
npx eslint .
npm test
npm run release:verify
```

## Release Gate Impact

This is a major release only if the release evidence proves a breaking change is
necessary. Otherwise this goalpost should be superseded by `v6.x` audit
hardening work.

## Residual Risks

| Risk | Rationale | Owner | Follow-up issue |
| --- | --- | --- | --- |
| Audit scope is unknown | No audit artifact exists yet. | maintainer | `not opened yet` |

## Closeout

- [ ] Slices complete or honestly dispositioned.
- [ ] Proof matrix replayed.
- [ ] Goalpost issue updated.
- [ ] Pull request merged for this goalpost.
- [ ] Release evidence updated when release-relevant.
- [ ] Retrospective or closeout note written.
