# v6.4.0 Browser/Edge Read Path

## Identity

| Field | Value |
| --- | --- |
| Goalpost id | `v6.4.0-gp-browser-edge-read-path` |
| Release home | `v6.4.0` |
| Umbrella issue | `not opened yet` |
| Goalpost doc | `docs/goalposts/v6.4.0/browser-edge-read-path.md` |
| Design cycle | `not active yet` |
| Slice budget | `6` |
| Status | `planned` |
| Sponsor human | `James` |
| Sponsor agent | `Codex` |

## Outcome

`git-cas` has a credible read-only browser or edge path for listing and
restoring existing content without shelling out to the Git CLI.

## Current Truth

- [BEARING.md](../../../../BEARING.md) names browser/edge persistence as an open
  tension.
- The current Git persistence path depends on the Git CLI through
  `@git-stunts/plumbing`.
- The domain architecture already uses ports for persistence, crypto, and
  compression boundaries.

## Scope

- Design a read-only persistence adapter boundary for browser or edge
  environments.
- Prove restore/list for a fixture repository if a practical adapter is chosen.
- Keep write-path ref updates out of the first browser/edge release.

## Out Of Scope

- Browser write support.
- Hosted synchronization service.
- Replacing the Git CLI path for Node/Bun/Deno.
- Storage format changes.

## Proof Stories

| Story issue | Actor | Need | Reason | Slice budget |
| --- | --- | --- | --- | ---: |
| `not opened yet` | browser user | read-only restore | inspect stored content without a local Git CLI | 2 |
| `not opened yet` | agent | adapter capability facts | detect browser-safe surfaces | 1 |
| `not opened yet` | maintainer | no write-path promise | avoid unsupported ref mutation claims | 1 |
| `not opened yet` | release owner | fixture evidence | prove the read path is real | 2 |

## Slice Budget

| Slice | Status | Description | Expected proof |
| ---: | --- | --- | --- |
| 1 | open | Adapter design and capability contract. | design cycle |
| 2 | open | Fixture repository read model. | fixture |
| 3 | open | Browser/edge compression posture. | runtime test |
| 4 | open | Restore/list proof. | integration test |
| 5 | open | Docs and examples. | docs test |
| 6 | open | Release evidence. | witness |

## Acceptance Criteria

- [ ] The first browser/edge contract is explicitly read-only.
- [ ] The adapter does not require the Git CLI.
- [ ] Capability detection is machine-readable.
- [ ] Docs do not imply write-path support.

## Deterministic Evidence

| Claim | Canonical fixture or input | Witness | Replay command | Expected deterministic result |
| --- | --- | --- | --- | --- |
| Read-only adapter can restore fixture content | fixture object graph | runtime witness | `not selected yet` | restored bytes match fixture |

## Substrate / Residency Geometry

| Reading claim | Basis | Aperture | Law/projection | Support obligations | Witness posture |
| --- | --- | --- | --- | --- | --- |
| Browser reads Git objects without CLI | fixture object ids | object fetch aperture | adapter maps OID to bytes | integrity check | fixture witness |

## Validation Plan

```bash
npx eslint .
npm test
```

## Release Gate Impact

This is a minor release only if a real read path lands. A design-only outcome
should remain unreleased or fold into another release.

## Residual Risks

| Risk | Rationale | Owner | Follow-up issue |
| --- | --- | --- | --- |
| Edge runtime APIs differ | The first adapter may support only one browser/edge shape. | maintainer | `not opened yet` |

## Closeout

- [ ] Slices complete or honestly dispositioned.
- [ ] Proof matrix replayed.
- [ ] Goalpost issue updated.
- [ ] Pull request merged for this goalpost.
- [ ] Release evidence updated when release-relevant.
- [ ] Retrospective or closeout note written.
