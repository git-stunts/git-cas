# v6.3.0 Agent Automation Parity

## Identity

| Field | Value |
| --- | --- |
| Goalpost id | `v6.3.0-gp-agent-automation-parity` |
| Release home | `v6.3.0` |
| Umbrella issue | `not opened yet` |
| Goalpost doc | `docs/goalposts/v6.3.0/agent-automation-parity.md` |
| Design cycle | `not active yet` |
| Slice budget | `5` |
| Status | `planned` |
| Sponsor human | `James` |
| Sponsor agent | `Codex` |

## Outcome

The `git cas agent` surface is stable enough for automated operators to use
without mirroring human CLI parsing, TUI state, or private implementation
details.

## Current Truth

- [STATUS.md](../../../../STATUS.md) says the machine-facing `git cas agent`
  surface exists, but parity and portability are still partial.
- [docs/design/](../../../design/README.md) contains landed Relay and agent CLI
  design history.

## Scope

- Inventory the agent command contract against the human CLI.
- Stabilize JSON result shapes and error contracts where drift exists.
- Add examples and lower-mode witnesses for automation flows.
- Keep credential behavior aligned with human command behavior.

## Out Of Scope

- New storage formats.
- TUI-only workflows.
- Remote daemon protocol work unless a design proves it is required.

## Proof Stories

| Story issue | Actor | Need | Reason | Slice budget |
| --- | --- | --- | --- | ---: |
| `not opened yet` | agent | stable JSON command results | automate without scraping prose | 2 |
| `not opened yet` | operator | matching credential behavior | avoid human/agent surprise | 1 |
| `not opened yet` | maintainer | conformance examples | prevent docs/API drift | 1 |
| `not opened yet` | release owner | release witness | prove parity before tag | 1 |

## Slice Budget

| Slice | Status | Description | Expected proof |
| ---: | --- | --- | --- |
| 1 | open | Agent/human command inventory. | witness |
| 2 | open | JSON and error contract hardening. | CLI tests |
| 3 | open | Credential parity tests. | integration tests |
| 4 | open | Automation examples. | docs tests |
| 5 | open | Release evidence. | witness |

## Acceptance Criteria

- [ ] Agent command outputs have documented JSON contracts.
- [ ] Error behavior is machine-readable.
- [ ] Credential resolution is aligned with human CLI behavior.
- [ ] Public examples are covered by tests or witnesses.

## Deterministic Evidence

| Claim | Canonical fixture or input | Witness | Replay command | Expected deterministic result |
| --- | --- | --- | --- | --- |
| Agent JSON is stable | fixture repo and command inputs | command transcript | `git cas agent ... --json` | schema-compatible JSON |

## Substrate / Residency Geometry

| Reading claim | Basis | Aperture | Law/projection | Support obligations | Witness posture |
| --- | --- | --- | --- | --- | --- |
| Agent reads match public commands | fixture repo refs | command-level aperture | documented command output | JSON schema or fixture | command witness |

## Validation Plan

```bash
npx eslint .
npm test
npm run release:verify -- --skip-jsr
```

## Release Gate Impact

This is a minor release because it strengthens public machine-facing behavior.

## Residual Risks

| Risk | Rationale | Owner | Follow-up issue |
| --- | --- | --- | --- |
| Agent parity can expand without bound | The design cycle must choose a bounded command set. | maintainer | `not opened yet` |

## Closeout

- [ ] Slices complete or honestly dispositioned.
- [ ] Proof matrix replayed.
- [ ] Goalpost issue updated.
- [ ] Pull request merged for this goalpost.
- [ ] Release evidence updated when release-relevant.
- [ ] Retrospective or closeout note written.
