# Retro — 0060 Compound Workspace Admission

## Drift Check

- The cycle stayed inside bounded dependency-ordered page and bundle staging,
  one exact final workspace generation, process reuse, failure settlement,
  deterministic witnesses, and compatibility documentation.
- It did not replace Git, expose raw sessions, change object formats or handles,
  weaken checked refs, reinterpret `AdmissionWindow` as domain atomicity, or
  buffer unbounded inputs.

## What Shipped To Main

- `workspace.batch()` admits a bounded callback through one private persistence
  scope and returns its value only with exact final retention evidence.
- Scope calls serialize by invocation order, preserve existing per-operation
  limits, stop queued work after failure, and close resources deterministically.
- SHA-1/SHA-256 witnesses reduce a 33-operation, 81-handle graph from 200 to 23
  Git children and from 33 retained generations to one with equal handle
  digests.
- Immediate-prune integration tests prove success reachability, release
  reclamation, and no-generation refusal behavior in both object formats.
- Implementation PR #124 merged normally as
  `eb8d617620fa8f401fb887f5b1bbc341d4746b0a`; exact reviewed head
  `29ba6e88c787a5e54c95a554e9166fd21aae31c0` passed 14/14 release-verifier
  stages with 7,141 observed tests.

## What Did Not Yet Ship

- v6.5.9 is not tagged or published until the release candidate, reviewed
  merge, signed-tag workflow, registry artifact, and clean consumer checks pass.
- git-warp has not yet consumed the registry artifact or rerun its exact
  reference, migrated-v18, process-census, and CPU gates.
- Think remains unchanged until the ordered Plumbing -> git-cas -> git-warp
  publication chain is complete.

## Debt

- The compound witness leaves 18 `mktree` children because dependent descriptor
  packs cross Git object-database visibility boundaries. This is measured debt,
  not a reason to bypass Git validation in v6.5.9.
- A typed tree-writing protocol should be proposed only if the released
  downstream git-warp benchmark shows material remaining impact.

## Cool Ideas

- Reuse one deterministic compound workload as a conformance vector across
  direct git-cas, git-warp, and Think consumer benchmarks.
- Compare native Git libraries only against the residual capability and cost
  ledger after this stock-Git path is measured end to end.
