# Retro — 0061 Compound Workspace Assets And Exact Roots

## Drift Check

- The cycle stayed inside bounded compound asset admission, exact newly staged
  root selection, prior-root preservation, Git process reuse, failure
  containment, deterministic witnesses, and compatibility documentation.
- It did not change stored objects or handles, expose raw Git sessions, weaken
  checked refs, reinterpret a physical batch as a cross-ref transaction, or
  claim provisional consumer timings as published behavior.

## What Shipped To Main

- `scope.assets.putBatch()` joins page and ordered-bundle waves through one
  caller-owned compound persistence scope.
- Optional synchronous `retain(value)` selection accepts only a bounded,
  nonempty, canonical, stably deduplicated subset of handles staged by that
  exact admission while preserving every prior workspace root.
- Adversarial selector and lifecycle tests reject malformed, asynchronous,
  empty, oversized, lookalike, and unstaged selections before ref movement.
- SHA-1/SHA-256 immediate-prune integration tests prove selected terminal-root
  reachability, transitive asset/page readback, later reclamation, and
  no-generation failure behavior.
- Implementation PR #128 merged normally as
  `57cd300294a94660d2afb644c653a3be78c15d53`; exact reviewed head
  `6714750620aa2310ad0279f957414be65898a66a` contains implementation checkpoint
  `e663754bf221784f0e5856a41fe071bebfa5befb`, whose complete release method
  passed 14/14 stages with 7,186 observed tests.

## What Did Not Yet Ship

- v6.5.10 has not yet been tagged or published to npm and GitHub Releases.
- git-warp has not yet installed the registry artifact or repeated its exact
  reference, migrated-v18, process-census, CPU, and wall-time gates.
- Think remains unchanged until the ordered Plumbing -> git-cas -> git-warp
  publication chain is complete.

## Debt

- The consumer prototype still opens 50 cold and 60 incremental Git commands.
  The released-artifact benchmark must classify that residual topology before
  another lower-layer optimization is justified.
- Exact selected roots are scoped to one workspace admission. Cross-workspace
  or cross-ref atomicity remains deliberately outside this contract.

## Cool Ideas

- Reuse the same deterministic git-warp corpus as the public-artifact
  conformance witness and the later Think before/after acceptance gate.
- Compare any native Git implementation only against the residual capability
  and process ledger after this stock-Git path is measured end to end.
