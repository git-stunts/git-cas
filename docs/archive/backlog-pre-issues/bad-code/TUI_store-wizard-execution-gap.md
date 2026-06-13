# TUI — Store Wizard Execution Gap

**Status:** Resolved in the `v6.0.1` patch.

## What

The V6 cockpit rendered and opened the Store Wizard from the Operations workspace, but the execution path only performed the plaintext `storeFile` -> `createTree` -> `addToVault` flow.

## Why It Bothers Us

The wizard UI exposes encryption and chunking choices. Leaving those controls wired only at the UI layer creates format drift: the operator can select a plan that the dashboard runner does not actually execute. The CLI already has the authoritative store behavior, so the TUI should either call into the same option-building path or share a dedicated store-plan adapter with it.

## Follow-Up

- [x] Thread passphrase and convergent encryption plans through `runStoreWizardCmd`.
- [x] Expose per-operation chunking strategy through the CAS facade so the wizard can execute fixed or CDC choices without mutating the facade default.
- [x] Add unit tests that confirm the wizard execution payload matches the selected encryption, compression, and chunking plan.
- [x] Add state-machine coverage so passphrase and convergent selections collect a passphrase before reaching compression.

## Resolution

The Store Wizard now builds the same `storeFile()` options it presents to the
operator. Passphrase mode supplies `passphrase`, convergent mode supplies both
`passphrase` and `encryption: { scheme: 'convergent' }`, gzip supplies
`compression: { algorithm: 'gzip' }`, and the chunking choice is passed as a
per-operation facade override.

The facade now maps per-operation `chunking` to a temporary `ChunkingPort`,
including default fixed chunking when the long-lived facade default is CDC.
`CasService` uses that operation chunker only for the current store, leaving the
service default unchanged.
