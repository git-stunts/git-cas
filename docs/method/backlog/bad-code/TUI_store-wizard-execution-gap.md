# TUI — Store Wizard Execution Gap

## What

The V6 cockpit renders and opens the Store Wizard from the Operations workspace, but the current execution path only performs the plaintext `storeFile` -> `createTree` -> `addToVault` flow.

## Why It Bothers Us

The wizard UI exposes encryption and chunking choices. Leaving those controls wired only at the UI layer creates format drift: the operator can select a plan that the dashboard runner does not actually execute. The CLI already has the authoritative store behavior, so the TUI should either call into the same option-building path or share a dedicated store-plan adapter with it.

## Follow-Up

- Thread passphrase and convergent encryption plans through `runStoreWizardCmd`.
- Either expose per-store chunking strategy in the CAS facade or derive the wizard choices from the active CAS configuration so the UI cannot promise unsupported strategies.
- Add a unit test that confirms the wizard execution payload matches the selected encryption, compression, and chunking plan.
