# INFRA-0055 verification

Date: 2026-07-26

Issue: https://github.com/git-stunts/git-cas/issues/102

## Playback answers

### Do internal commits require an ambient Git identity?

No. `GitRefAdapter.createCommit()` supplies a git-cas-owned author and
committer identity to `git commit-tree` through the command environment:

```text
git-cas <git-cas@example.invalid>
```

The adapter unit test observes all four environment variables. The
Git-backed root-set integration reads the resulting commit with native Git
and confirms both author and committer headers.

### Does the fix mutate repository or global configuration?

No. The implementation passes identity only to the individual plumbing
operation. It does not invoke `git config`, persist user settings, or require
callers to supply personal identity.

### What failed before the fix?

A clean Linux migration rehearsal opened an authoritative bare repository
without `user.name` or `user.email`. Post-promotion root-set retention reached
`git commit-tree`, which rejected the write with `Author identity unknown`.
The first adapter test was RED because the plumbing request contained no
environment map.

## Commands

```text
pnpm vitest run test/unit/infrastructure/adapters/GitRefAdapter.test.js
  RED: expected identity environment, received none
  GREEN: 16 passed

GIT_STUNTS_DOCKER=1 pnpm vitest run \
  test/integration/root-set.test.js --no-file-parallelism
  3 passed

pnpm test
  2,087 passed, 2 skipped

pnpm exec eslint .
  passed

pnpm test:integration:node
  199 passed
```

The final `release:verify -- --skip-jsr` run passed all 13 executed gates:
6,847 tests across Node, Bun, and Deno unit/integration suites, public type
compatibility, examples, lint, build stamping, and the npm pack dry-run.
The dry-run package was 785,225 bytes compressed and 2,210,241 bytes unpacked.

## Remaining witness

After this patch is published, git-warp must consume it and rerun the exact
clean-Linux retained-substrate migration proof. Issue #102 remains open until
that downstream gate passes.
