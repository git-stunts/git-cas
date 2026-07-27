---
title: 'TUI-0056 - Bijou 7 Framed Cockpit'
cycle: '0056'
task_id: 'bijou-7-framed-cockpit'
legend: 'TUI'
release_home: 'v6.5.6'
issue: 'https://github.com/git-stunts/git-cas/issues/105'
goalpost_issue: 'https://github.com/git-stunts/git-cas/issues/105'
tracker_source: 'github'
status: 'active'
base_commit: '9ea91a738f2cbadf2a20b5ac7c2c6d54ba9f409e'
owners:
  - '@git-stunts'
sponsors:
  human: 'James'
  agent: 'Codex'
blocking_issues: []
supersedes: []
superseded_by: null
created: '2026-07-27'
updated: '2026-07-27'
---

# TUI-0056 - Bijou 7 Framed Cockpit

## Linked Issue

- Goalpost: https://github.com/git-stunts/git-cas/issues/105
- Hosted-shell slice: https://github.com/git-stunts/git-cas/issues/106

## Linked Tracker

- Milestone: `v6.5.6`
- Goalpost issue: https://github.com/git-stunts/git-cas/issues/105
- Slice issue: https://github.com/git-stunts/git-cas/issues/106

## Design Type

- [ ] Runtime/API
- [ ] Storage/substrate
- [x] Migration/release
- [x] CLI/operator
- [x] Docs/public guidance
- [x] TUI/visual surface
- [x] Test/tooling

## Decision Summary

Upgrade the complete Bijou dependency family to 7.2.0 and host the interactive
cockpit through `createFramedApp()`. The frame owns terminal lifecycle, outer
chrome, help, command and search palettes, settings, notifications, performance
telemetry, and quit confirmation. The git-cas page continues to own storage
domain state, Explorer/Atlas/Operations workspace navigation, authentication,
filtering, and the store wizard.

## Sponsored Human

An operator wants git-cas to use the current Bijou application model so the
cockpit receives current shell behavior and accessibility fixes without
maintaining an older parallel shell.

## Sponsored Agent

An agent needs one explicit hosted entrypoint and inspectable page contracts so
it can test shell ownership separately from git-cas domain behavior without
inferring state from raw ANSI output.

## Hill

By the end of this cycle, the interactive launcher runs a self-hosted
`FramedApp`, all duplicated outer-shell state is gone, the installed dependency
graph contains one coherent Bijou 7.2 family, and tests prove both the framed
human surface and the unchanged static lower mode.

## Current Truth

`package.json` declares four Bijou 5 caretaker ranges. `bin/ui/context.js`
manually assembles a Node context and stderr adapter.
`bin/ui/dashboard.js` calls `startApp()` directly and stores app-owned command
palette, help, settings, notification, performance-HUD, and quit-confirmation
state. `bin/ui/dashboard-view.js` renders matching outer chrome and overlays.
`bin/ui/progress.js` manually owns cursor hide/show sequences.

Bijou 7.2 provides `createNodeContext()` stream overrides, reference-counted
cursor ownership, theme safe-pair checks, and a self-running
`createFramedApp()` whose shell already owns those application concerns.

## Problem

Keeping a second shell inside the application forfeits current Bijou behavior,
creates two potential owners for the same keybindings and overlays, and makes
future upgrades more expensive. Merely changing package versions would leave
the architectural duplication intact.

## Scope

This cycle includes:

- coherent Bijou 7.2 dependency ranges and lockfile;
- Node-host context construction through current adapters;
- reference-counted cursor ownership for store/restore progress;
- a `FramePage` contract around the existing cockpit domain model;
- `FramedApp.run()` as the interactive hosted entrypoint;
- frame-owned help, command/search palettes, settings, notifications,
  performance HUD, quit confirmation, outer header, and footer;
- explicit application key bindings, commands, asset search items, and
  settings facts;
- Design Book selection and Bijou enforcement of high-contrast text/surface
  pairs;
- static output and structured-stdout preservation;
- release documentation and witness evidence.

## Non-Goals

This cycle does not include:

- storage, manifest, object, ref, or public package API changes;
- turning Explorer, Atlas, and Operations into independent frame pages with
  duplicated domain models;
- light-theme design without a separately selected and audited palette;
- rewriting the store wizard as a generic Bijou form;
- changing machine-readable CLI output.

## Runtime / API Contract

- `createDashboardPage(deps)` exposes the testable git-cas page contract.
- `createDashboardApp(deps)` returns a `FramedApp`.
- `launchDashboard()` retains the static fallback for noninteractive contexts.
- Interactive launch calls the framed app's hosted `run({ ctx })` entrypoint.
- Page commands emit frame-managed notifications through `notify()`.
- Frame search items select assets; command items expose application actions.
- Shell-reserved keys own help, search/palette, settings, performance HUD, and
  quit. Page-first conflict resolution preserves application navigation where
  keys overlap with frame scrolling.

## User Experience / Product Shape

The operator sees one Bijou frame around the cockpit:

- the frame header names the application and active page;
- the frame footer renders current shell and page key help;
- `?` opens frame help;
- `/` opens asset search;
- `Ctrl+P` or `:` opens application commands;
- `F2` or `Ctrl+,` opens frame-rendered settings;
- `Shift+N` opens notification history;
- backtick opens the frame performance HUD;
- `q` opens the frame quit confirmation.

Explorer, Atlas, Operations, vault unlock, filtering, and the store wizard
retain their existing application semantics.

## Data / State Model

| State                | Source of truth                  | Derived state                   | Invalid states             | Reset behavior          | Serialization    | Determinism assumptions              |
| -------------------- | -------------------------------- | ------------------------------- | -------------------------- | ----------------------- | ---------------- | ------------------------------------ |
| Cockpit domain model | active frame page model          | rendered workspace and commands | page model missing         | frame initializes page  | in-memory only   | reducer inputs determine state       |
| Shell state          | `FrameModel`                     | overlays and chrome             | duplicate app owner        | frame lifecycle         | in-memory only   | frame reducer inputs determine state |
| Notifications        | frame runtime notification state | toast stack/history             | app timer plus frame timer | frame expires/dismisses | in-memory only   | timestamps are runtime values        |
| Theme contrast       | theme tokens and safe pairs      | doctor report                   | ratio below 4.5            | select another pair     | source constants | ratios are deterministic             |

## Architecture / Anti-SLUDGE Posture

| Concern                         | Decision                                                           |
| ------------------------------- | ------------------------------------------------------------------ |
| Domain changes                  | Preserve the existing `DashModel` and storage commands             |
| Port changes                    | Use Bijou's Node host and frame page contracts                     |
| Adapter changes                 | Replace the app-owned stderr adapter with stream overrides         |
| Boundary validation             | Keep structured stdout separate from human stderr                  |
| Runtime-backed nouns introduced | `FramePage` and `FramedApp` only                                   |
| Expected failure representation | Existing app errors plus frame runtime notifications               |
| Banned shortcuts avoided        | No compatibility shell, raw cursor literals, or duplicate overlays |

## Cost / Residency Posture

| Surface            | Current cost                   | Target cost                | Limit/budget                        | Failure mode                     |
| ------------------ | ------------------------------ | -------------------------- | ----------------------------------- | -------------------------------- |
| Shell state        | duplicate app/frame candidates | one frame-owned state tree | one page plus bounded notifications | frame runtime error notification |
| Progress output    | one render per chunk           | same, shared cursor guard  | existing bar width                  | static fallback                  |
| Theme verification | manual review                  | deterministic doctor test  | WCAG ratio 4.5                      | test failure                     |

## Determinism / Replay / Causality

Pure page and frame reducers remain replayable from messages. Runtime clocks
still drive title animation and notification expiry. Tests use injected
contexts and commands; no Git state or object identity changes.

## Git Substrate Impact

| Substrate area          | Impact                                                      |
| ----------------------- | ----------------------------------------------------------- |
| refs                    | none                                                        |
| commits                 | none                                                        |
| trees/blobs             | none                                                        |
| object ids              | none                                                        |
| tag/release behavior    | patch release `v6.5.6`                                      |
| migration compatibility | downstream git-warp receives Bijou 7 without nested Bijou 5 |

## Compatibility / Migration Posture

| Concern                    | Decision                                           |
| -------------------------- | -------------------------------------------------- |
| Public API compatibility   | unchanged                                          |
| Package export changes     | none                                               |
| Storage/read compatibility | unchanged                                          |
| Legacy behavior retained   | static fallback and cockpit domain actions         |
| Deprecation behavior       | remove app-owned shell implementation, not aliases |
| Migration path             | dependency-only upgrade for consumers              |
| Release note impact        | dependency and interactive-shell patch             |

## Error Contract

| Failure                   | Error/result                       | Caller recovery           | Test            |
| ------------------------- | ---------------------------------- | ------------------------- | --------------- |
| noninteractive terminal   | static listing                     | consume text/redirect     | launcher test   |
| app command failure       | page state plus frame notification | inspect message and retry | dashboard tests |
| theme contrast regression | doctor report/test failure         | select compliant token    | theme test      |
| hosted runtime failure    | Bijou runtime notification/error   | inspect lower-mode error  | frame test      |

## Security / Trust / Redaction Posture

The frame receives only already-rendered operator facts. Passphrases and derived
vault keys remain in the page model and are not added to command items,
settings, notifications, help, or search text. Structured stdout remains
reserved for machine output.

## Lower Modes

Noninteractive launch continues to emit the tab-separated static listing.
Tests can inspect the page model, frame model, command/search items, safe-pair
doctor report, and captured output without a terminal screenshot.

## Accessibility Posture

Frame-owned help, settings, search, notifications, and quit confirmation inherit
Bijou's accessible/static/pipe lowering. Application text remains in a linear
reading order. High-contrast foreground/background pairs must meet at least
4.5:1 and are enforced by tests.

## User-Facing Text / Directionality

Shell text comes from Bijou. Application command, search, and settings labels
use logical action language and no left/right navigation assumptions. The
static fallback remains plain text.

## Agent Inspectability / Explainability Posture

An agent can inspect page key bindings, command items, search items, settings
sections, frame state flags, notification commands, and the theme doctor report.
No shell behavior needs to be inferred from private terminal escape sequences.

## Linked Invariants

- Human progress and diagnostics never contaminate structured stdout.
- The frame is the sole owner of outer-shell state and lifecycle.
- Cockpit domain operations remain in the page reducer.
- Foreground/background text pairs are selected with Design Book and remain at
  or above 4.5:1 contrast.
- Noninteractive use does not require a TTY.

## Design Alternatives Considered

### Update versions only

Rejected because it retains the duplicate shell and misses the principal Bijou
7 application benefit.

### Make every workspace a frame page

Rejected for this cycle because each frame page owns a separate model. The
cockpit's vault/auth/cache/service state is intentionally shared across its
workspaces; duplicating or mutably sharing it would weaken the reducer model.

### Host one cockpit page

Selected. The frame owns application shell concerns while the coherent cockpit
domain model continues to own its internal workspaces.

## Decision

Host one git-cas cockpit page in `createFramedApp()` and delete every duplicated
outer-shell concern from the page model and renderer.

## Proof Surface

- installed dependency graph from `npm ls`;
- context and progress unit tests;
- page reducer and renderer tests;
- framed-app routing/state tests;
- theme doctor and explicit contrast tests;
- noninteractive launcher test;
- full unit/integration/lint/release gates.

## Implementation Slices

- Upgrade dependency family and lockfile.
- Adopt Node host, cursor guard, and safe-pair theme contracts.
- Introduce the cockpit `FramePage` and hosted `FramedApp`.
- Move search, commands, settings, notifications, telemetry, and quit to frame.
- Remove duplicated renderer/model state.
- Validate and publish `v6.5.6`.

## Tests To Write First

- [x] Bijou caretaker-range regression.
- [x] cursor ownership and initial-count regression.
- [x] declared and manually styled contrast pairs.
- [x] framed app initializes the cockpit page.
- [x] frame owns settings, search, telemetry, notifications, and quit state.
- [x] page search selects an asset and loads its manifest.
- [x] noninteractive launch retains static output.

## Acceptance Criteria

- [x] one installed Bijou 7.2 family and no Bijou 5 packages;
- [x] production interactive launch calls `FramedApp.run()`;
- [x] no app-owned outer-shell model fields, timers, or renderers remain;
- [x] application actions appear in frame help/commands/search;
- [x] static mode and structured stdout boundaries are unchanged;
- [x] all declared text/surface pairs pass at 4.5:1 or higher;
- [ ] full validation and package/release checks pass.

## Validation Plan

Run targeted TUI tests during conversion, then `npm test`, `npx eslint .`,
dependency-tree inspection, package dry-run, release preparation, and the
repository's documented pre-release gates. Capture exact commands and counts in
the cycle witness.

## Playback / Witness

The witness must answer:

- Does the interactive launcher return a hosted `FramedApp`?
- Which state and render paths disappeared from the application?
- Can an operator search assets and run commands through the frame?
- Does the frame own notifications and quit confirmation?
- Is static output unchanged?
- Does the dependency tree contain any Bijou 5 package?
- Do all text/surface contracts meet the contrast threshold?

## Risks

- Frame/page key conflicts could change navigation.
- Removing custom overlays could hide app-specific facts if settings and command
  providers are incomplete.
- A generic test context may not carry app-only theme tokens.
- Notification commands must not expose secrets.

Mitigations are explicit page-first application bindings, provider tests,
fallback theme lookup, and payload review.

## Follow-On Debt

- A separately designed light theme may be added only after Design Book
  selection and contrast proof.
- Store wizard adoption of newer first-party form blocks remains a separate
  product change.

## Tracker Disposition

GitHub issues #105 and #106 remain open until the implementation, witness,
merge, and patch release are complete.

## Done Does Not Mean

- v19 git-warp migration UX is complete;
- the v18-to-v19 retained substrate has been migrated;
- the live Think mind is safe to mutate;
- every internal cockpit panel has been rewritten as a Bijou frame pane.

## Retrospective

Pending merge and release evidence.
