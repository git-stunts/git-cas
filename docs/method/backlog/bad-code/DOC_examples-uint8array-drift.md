# DOC: Examples drifted from the v6 Uint8Array byte contract

- **Files**: `examples/encrypted-workflow.js`, `examples/progress-tracking.js`
- **Severity**: High
- **Category**: Runnable documentation failure
- **Status**: Resolved

## Description

The v6 public byte contract is `Uint8Array`, but two maintained examples still
treat `restore()` output as a Node `Buffer`:

- `examples/encrypted-workflow.js` calls `buffer.toString()` and
  `buffer.equals(...)`
- `examples/progress-tracking.js` calls `buffer.equals(...)`

Direct execution currently fails:

- `node examples/encrypted-workflow.js` -> `buffer.equals is not a function`
- `node examples/progress-tracking.js` -> `TypeError: buffer.equals is not a function`

## Why It Bothers Us

Examples are public contracts in practice. These failures teach the old Buffer
surface immediately after v6 made the portable `Uint8Array` contract explicit.

## Follow-Up

- [x] Replace Buffer-only checks with Uint8Array-safe byte comparison helpers.
- [x] Decode text with `TextDecoder` or use `Buffer.from(bytes)` only at Node display
  boundaries.
- [x] Add a test that runs maintained examples in isolated temporary repositories.
- [x] Update `examples/README.md` now that examples are release-gated.
