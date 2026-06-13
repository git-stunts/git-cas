# Goalpost Template

Copy this skeleton when creating a `git-cas` release goalpost.

Goalposts sit between the release roadmap and METHOD design cycles. They name a
release-scale outcome, divide it into turn-sized slices, and point to the proof
that must exist before a pull request can land. One pull request should carry
one goalpost.

````markdown
# <Release> <Goalpost Title>

## Identity

| Field | Value |
| --- | --- |
| Goalpost id | `<vX.Y.Z-gp-slug>` |
| Release home | `vX.Y.Z` |
| Umbrella issue | `https://github.com/git-stunts/git-cas/issues/<number>` or `not opened yet` |
| Goalpost doc | `<this path>` |
| Design cycle | `<docs/design/NNNN-slug/path.md>` or `not active yet` |
| Slice budget | `<N>` |
| Status | `planned|scaffolded|active|review-ready|landed|superseded` |
| Sponsor human | `<name>` |
| Sponsor agent | `<name>` |

## Outcome

State the release-scale outcome this goalpost unlocks.

## Current Truth

Cite current repo-visible facts. Strong claims need source, test, command,
issue, pull request, generated artifact, witness, release note, or CI evidence.

## Scope

- `<in scope>`

## Out Of Scope

- `<out of scope>`

## Proof Stories

Use the proof-story form:

```text
A <actor> needs <capability or invariant>
so that <runtime, release, protocol, storage, or operator outcome>,
without relying on <current unsafe workaround>.
```

| Story issue | Actor | Need | Reason | Slice budget |
| --- | --- | --- | --- | ---: |
| `not opened yet` | `<actor>` | `<need>` | `<reason>` | `<N>` |

## Slice Budget

| Slice | Status | Description | Expected proof |
| ---: | --- | --- | --- |
| 1 | open | `<description>` | `<test|fixture|witness|schema|runtimeBehavior|docUpdate|issueUpdate>` |

## Acceptance Criteria

- [ ] `<criterion>`

## Deterministic Evidence

| Claim | Canonical fixture or input | Witness | Replay command | Expected deterministic result |
| --- | --- | --- | --- | --- |
| `<claim>` | `<fixture/input or not applicable>` | `<witness>` | `<command>` | `<stable result>` |

## Substrate / Residency Geometry

Name the Git substrate basis, aperture, materialization law, projection, support
obligations, budget posture, residual posture, and witness posture for any claim
about refs, commits, trees, blobs, manifests, vaults, or large-content reads.

| Reading claim | Basis | Aperture | Law/projection | Support obligations | Witness posture |
| --- | --- | --- | --- | --- | --- |
| `<claim>` | `<ref/tree/blob/manifest basis>` | `<bounded aperture>` | `<materialization law>` | `<support>` | `<witness>` |

## Validation Plan

```bash
npx eslint .
npm test
npm run release:verify -- --skip-jsr
```

Trim commands that do not apply. Add focused tests, fixtures, Docker runtime
commands, or witness replay commands when needed.

## Release Gate Impact

Describe how this goalpost affects the target release gate, release evidence
packet, changelog, docs, package surface, migration posture, or runtime matrix.

## Residual Risks

| Risk | Rationale | Owner | Follow-up issue |
| --- | --- | --- | --- |
| `None` | `No accepted residual risks.` | `n/a` | `n/a` |

## Closeout

- [ ] Slices complete or honestly dispositioned.
- [ ] Proof matrix replayed.
- [ ] Goalpost issue updated.
- [ ] Child proof-story issues closed, superseded, or carried forward.
- [ ] Pull request merged for this goalpost.
- [ ] Release evidence updated when release-relevant.
- [ ] Retrospective or closeout note written.
````
