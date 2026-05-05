# REL: Audit Blocker Burn-Down

## What

The 2026-05-04 audit leftovers are release blockers for v6.0.0 unless they are
TUI-specific. The TUI orphaned-chunk health-check is deferred to the v6.x TUI
lane; everything else in the audit addenda must be resolved before the
annotated `v6.0.0` tag.

## Blockers

- [x] Add `ContentAddressableStore.open({ cwd })` and update first-contact docs.
- [x] Emit an observability warning when CDC auto-selects deterministic
  `convergent` encryption.
- [ ] Extract `CasService.js` store/restore orchestration enough to remove the
  current audit blocker.
- [x] Extract Git tree-entry formatting out of `CasService.js`.
- [x] Add a `MemoryPersistenceAdapter` test helper and prove a domain workflow
  without Git subprocesses.
- [ ] Add vault-state caching for unchanged vault tree OIDs.
- [x] Expand `createJson` / `createCbor` factory options to cover the underlying
  service options.
- [x] Pin `commander` and preserve CLI flag/help regression coverage.
- [x] Add a long-form store/restore pipeline state-machine document.
- [ ] Add an empty-vault passphrase verifier and migration behavior.
- [x] Make `scripts/release/verify.js` directly execute maintained examples.
- [ ] Split `bin/agent/cli.js` command implementations out of the protocol
  shell.

## Deferred To v6.x

- [TUI — Orphaned-Chunk Health Check](../v6.x-tui/TUI_orphaned-chunk-health-check.md)

## Done When

- All non-TUI checkboxes above are checked.
- The May 4 audit addenda list no non-TUI unresolved work.
- `npm run release:verify -- --skip-jsr` passes on synced `main`.
- The operator explicitly approves creating the annotated `v6.0.0` tag.
