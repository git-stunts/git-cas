# v6.2.0 Operator TUI

## Identity

| Field | Value |
| --- | --- |
| Goalpost id | `v6.2.0-gp-operator-tui` |
| Release home | `v6.2.0` |
| Umbrella issue | `not opened yet` |
| Goalpost doc | `docs/goalposts/v6.2.0/operator-tui.md` |
| Design cycle | `not active yet` |
| Slice budget | `6` |
| Status | `planned` |
| Sponsor human | `James` |
| Sponsor agent | `Codex` |

## Outcome

The TUI becomes a coherent operator cockpit: navigation, status, help,
diagnostics, store flow, and detail inspection lower cleanly to keyboard and
agent-readable evidence.

## Current Truth

- [BEARING.md](../../../BEARING.md) names TUI modernization as an open tension.
- [docs/method/backlog/v6.x-tui/](../../method/backlog/v6.x-tui/) contains the
  v6.x TUI lane.
- [docs/method/backlog/bad-code/TUI_store-wizard-execution-gap.md](../../method/backlog/bad-code/TUI_store-wizard-execution-gap.md)
  is marked resolved in the backlog index, so the v6.x TUI lane needs a truth
  pass before implementation begins.

## Scope

- Reconcile the v6.x TUI lane against shipped behavior.
- Prioritize operator workflows over decorative components.
- Add lower-mode evidence for TUI behavior where possible.
- Keep TUI work behind design cycles with playback questions.

## Out Of Scope

- New storage protocol behavior.
- Browser UI.
- Replacing the CLI with the TUI.

## Proof Stories

| Story issue | Actor | Need | Reason | Slice budget |
| --- | --- | --- | --- | ---: |
| `not opened yet` | operator | discoverable help and status | use the cockpit without leaving the workflow | 1 |
| `not opened yet` | operator | dependable store/restore diagnostics | trust long-lived operations | 2 |
| `not opened yet` | agent | lower-mode TUI witness | verify behavior without scraping pixels | 1 |
| `not opened yet` | maintainer | stale TUI lane cleanup | avoid rebuilding shipped work | 2 |

## Slice Budget

| Slice | Status | Description | Expected proof |
| ---: | --- | --- | --- |
| 1 | open | Audit and rewrite the v6.x TUI lane. | doc update |
| 2 | open | Prioritize help/status/toast/pager/detail behavior. | design cycle |
| 3 | open | Add lower-mode witnesses for key TUI flows. | witness |
| 4 | open | Implement the first operator workflow improvement. | TUI test |
| 5 | open | Implement diagnostic or health cockpit improvement. | TUI/CLI test |
| 6 | open | Release evidence and closeout. | release witness |

## Acceptance Criteria

- [ ] Stale TUI cards are corrected before work starts.
- [ ] New TUI work has keyboard, lower-mode, and accessibility posture.
- [ ] Operator-visible behavior is tested through actual TUI or command
      surfaces.

## Deterministic Evidence

| Claim | Canonical fixture or input | Witness | Replay command | Expected deterministic result |
| --- | --- | --- | --- | --- |
| TUI lane reflects shipped truth | v6.x TUI backlog | docs test or review witness | `npx vitest run test/unit/docs` | no stale active claims |

## Substrate / Residency Geometry

| Reading claim | Basis | Aperture | Law/projection | Support obligations | Witness posture |
| --- | --- | --- | --- | --- | --- |
| Not applicable | no storage read claim | n/a | n/a | n/a | n/a |

## Validation Plan

```bash
npx eslint .
npm test
```

## Release Gate Impact

This is a minor release because it changes operator-facing workflows. It should
not require storage migration.

## Residual Risks

| Risk | Rationale | Owner | Follow-up issue |
| --- | --- | --- | --- |
| TUI tests can drift toward snapshot theater | Rendered behavior needs lower-mode witnesses and state assertions. | maintainer | `not opened yet` |

## Closeout

- [ ] Slices complete or honestly dispositioned.
- [ ] Proof matrix replayed.
- [ ] Goalpost issue updated.
- [ ] Pull request merged for this goalpost.
- [ ] Release evidence updated when release-relevant.
- [ ] Retrospective or closeout note written.
