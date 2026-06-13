# TUI: Orphaned-Chunk Health Check

## What

Add a dashboard-visible health check for orphaned chunks and related vault/CAS
reachability issues.

## Why

The ship-readiness audit called out a missing standardized TUI health check for
orphaned chunks. This is useful operator feedback, but it is TUI-specific and
therefore belongs in the v6.x release line rather than blocking the v6.0.0 tag.

## Scope

- Surface orphaned chunk counts in the TUI health dashboard.
- Link the visual status to the existing `doctor` / integrity-check model.
- Keep the non-TUI CLI/API health behavior unchanged unless a shared domain
  helper is needed.

## Status

- Deferred from the 2026-05-04 ship-readiness audit by operator decision.
