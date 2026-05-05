# DOC: API reference uses stale plumbing constructor

- **File**: `docs/API.md`
- **Severity**: High
- **Category**: Documentation/runtime mismatch
- **Status**: Resolved

## Description

`docs/API.md` still shows `await Plumbing.create({ repoPath })` in the
ContentAddressableStore constructor example. The installed `@git-stunts/plumbing`
class exposes `createDefault` and `createRepository`, and current README/GUIDE
examples use `GitPlumbing.createDefault({ cwd })`.

## Why It Bothers Us

This is a first-contact API snippet. A developer who starts from the API
reference instead of README/GUIDE hits a nonexistent factory before reaching the
CAS behavior they came to evaluate.

## Follow-Up

- [x] Replace the stale snippet with `GitPlumbing.createDefault({ cwd })`.
- [x] Add a docs regression test that fails when `docs/API.md` references the
  nonexistent `Plumbing.create({ repoPath })` factory.
