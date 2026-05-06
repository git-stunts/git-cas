# COOL IDEA™: Atomic Multi-Store

## Context
Storing multiple files currently requires multiple `git-cas store` calls, each creating a separate commit on `refs/cas/vault`, which leads to high ref contention in parallel CI environments.

## Description
Implement a `git-cas store-batch` command (and library method) that accepts a manifest of multiple files and updates the vault ref with a single atomic commit.

## Value
- Drastically reduces vault ref contention during batch uploads.
- Improves performance by batching Git tree updates.
- Ensures all-or-nothing atomicity for related assets (e.g., a binary and its debug symbols).
