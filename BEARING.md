# BEARING

Current direction and active tensions. Historical ship data is in `CHANGELOG.md`.

```mermaid
timeline
    Phase 1 : Core CAS Engine : Git Substrate : SHA-256 Manifests
    Phase 2 : Vault Infrastructure : CDC Deduplication : Encryption
    Phase 3 : Multi-Runtime (Node/Bun/Deno) : Agent CLI : TUI Cockpit
    Phase 4 : Streaming Encrypted Restore : Service Decomposition : Platform-Agnostic CLI
```

## Active Gravity

### 1. Performance & Scale
- Implementation of streaming encrypted and compressed restores.
- Optimization of Merkle-style manifest resolution for giant assets.
- Hardening the memory-guarded buffered paths for large-asset decryption.

### 2. Operational Truth
- Refinement of the "Doctor" diagnostic engine to surface integrity issues.
- Alignment of empty-state phrasing across all CLI and TUI surfaces.
- Maturation of the machine-facing agent CLI for full parity with human commands.

### 3. Architectural Decomposition
- Moving toward a more modular `CasService` to reduce orchestration bloat.
- Finalizing the platform-agnostic CLI structure to simplify cross-runtime binaries.

## Tensions

- **Encryption vs. Dedupe**: AES-256-GCM removes the benefits of CDC; we need clearer documentation on this tradeoff for operators.
- **Buffer Limits**: `whole-v1 restoreStream()` is still limited by `maxRestoreBufferSize`; `restoreFile()` now has a bounded temp-file path, so the remaining question is how far to push hard limits and stream-native safeguards below the file surface.
- **Vault Contention**: Concurrent vault updates in high-frequency CI environments require robust CAS retry logic.

## Next Target

The immediate focus is **Whole-v1 restore bounds and crypto hardening** now that `framed-v1` covers the authenticated streaming restore path.
