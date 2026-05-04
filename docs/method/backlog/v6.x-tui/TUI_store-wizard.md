# TUI-009: Interactive store wizard

## What

Press `n` (new) in the dashboard to launch a guided store flow using Bijou v5's `wizard` or `modal` components. The wizard walks the user through: file path selection (text input) -> slug name -> encryption (passphrase input) -> compression toggle -> chunking strategy -> confirm -> store. The entire flow happens within the TUI without shelling out.

## Why

Currently, storing a new asset requires leaving the TUI, running a CLI command (`git-cas store <file> --slug <name> [flags]`), and re-entering the dashboard. This context switch breaks flow. An in-TUI store wizard makes the dashboard a complete operational interface — users can browse, inspect, and store without leaving the app. It also makes the store operation more discoverable; new users can explore available options (encryption, compression, chunking) through the wizard steps rather than reading `--help` output.

## Current State

- No in-TUI store flow exists. The dashboard is read-only (browse, inspect, doctor, stats, treemap, refs).
- `ContentAddressableStore.store(readable, options)` is the programmatic API for storing assets.
- `bin/git-cas-store.js` is the CLI entry point that parses flags and calls the store API.
- `bin/ui/passphrase-prompt.js` (100 lines) already implements a TUI passphrase input for decryption — this can be reused or extended for the encryption step.
- `bin/ui/progress.js` (148 lines) implements a TUI progress indicator — reusable for the store progress step.

## Design

### Bijou v5 Components Used

- `wizard(steps, options)` or `modal(content, options)` — multi-step guided flow
- `textInput(options)` — text input for file path and slug name
- `secretInput(options)` — masked input for passphrase (replaces or wraps `passphrase-prompt.js`)
- `select(options)` — single-select for chunking strategy (whole, framed, CDC)
- `toggle(options)` — boolean toggle for compression
- `confirm(options)` — confirmation step before executing the store

### Implementation Plan

1. Add `n` keybinding mapped to `{ type: 'open-store-wizard' }` action.
2. Define wizard steps as a state machine:
   - **Step 1 — File path**: `textInput` with file path autocomplete (if available) or raw text entry. Validate file exists.
   - **Step 2 — Slug**: `textInput` pre-filled with filename stem. Validate slug is unique in vault.
   - **Step 3 — Encryption**: `select` with options: `none`, `passphrase`, `convergent`. If passphrase selected, show `secretInput`.
   - **Step 4 — Compression**: `toggle` for zstd compression on/off.
   - **Step 5 — Chunking**: `select` with options: `whole` (single blob), `framed` (fixed-size frames), `CDC` (content-defined chunking).
   - **Step 6 — Confirm**: Summary of all selections, `confirm` to proceed or back to edit.
3. On confirm, execute `cas.store(createReadStream(filePath), { slug, encryption, compression, chunking })`.
4. Show progress via `progress.js` or v5 progress component during store.
5. On completion, dispatch `loadEntriesCmd` to refresh the entry list and show a success toast.
6. On error, show an error toast and return to the wizard at the failed step.
7. Add `storeWizard` state to `DashModel` (step index, field values, validation errors).

### Files Modified

- `bin/ui/dashboard.js` — add `open-store-wizard` action, wizard state management, store execution logic
- `bin/ui/store-wizard.js` — new file, wizard step definitions and rendering
- `bin/ui/dashboard-view.js` — render wizard overlay in `renderOverlays()`
- `bin/ui/passphrase-prompt.js` — potentially refactor for reuse as a wizard step

### Dependencies

- TUI-001 (framed app shell for modal/wizard integration)
- TUI-004 (toast notifications for success/error feedback)

## Acceptance Criteria

- [ ] `n` key opens the store wizard from the dashboard
- [ ] Wizard has 6 steps: file path, slug, encryption, compression, chunking, confirm
- [ ] Each step validates input before allowing navigation to the next step
- [ ] Back navigation works at every step
- [ ] Passphrase input is masked
- [ ] Confirm step shows a summary of all selections
- [ ] Store operation executes and shows progress
- [ ] Entry list refreshes after successful store
- [ ] Success toast appears on completion
- [ ] Error toast appears on failure with actionable message
- [ ] `escape` cancels the wizard at any step
- [ ] `npx eslint .` reports 0 errors
- [ ] All existing unit tests pass

## Effort

Large
