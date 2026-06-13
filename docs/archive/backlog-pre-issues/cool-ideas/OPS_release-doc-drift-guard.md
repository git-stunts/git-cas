# OPS: Release-gate docs and examples drift guard

## The Idea

Add a release-gate test that executes maintained examples and scans active docs
for known stale release terms before a tag can be cut.

Initial guard targets:

- run `examples/store-and-restore.js`
- run `examples/encrypted-workflow.js`
- run `examples/progress-tracking.js`
- reject active docs that recommend legacy scheme names as current values
- reject example snippets that reference nonexistent public factories

## Why It's Interesting

Release verification already catches a lot of code regressions. This would make
the public onboarding surface part of the same truth system instead of relying
on manual review.

## Tradeoffs

- Example execution needs isolated temporary repositories and deterministic
  environment setup.
- Some design/archive docs intentionally mention old terms, so stale-term checks
  must be scoped to active docs.

## Status

- Captured during the 2026-05-04 ship readiness audit.
