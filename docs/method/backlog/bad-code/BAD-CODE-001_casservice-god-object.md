# ISSUE: CasService.js God Object (Architectural Debt)

**ID:** `BAD-CODE-001`
**Status:** `Resolved`
**Priority:** `Medium`
**Component:** `Domain / Services`

## Context

While `StorePipeline` and `RestorePipeline` orchestration was extracted during the v6.0.0 cycle, the actual byte-level strategy implementation for every encryption and restore mode (convergent, framed, whole, legacy) remained inside `CasService.js`. The file was ~2300 lines before this cleanup.

## Infraction

- **God Object:** `CasService` handles too many responsibilities (orchestration, strategy selection, and strategy implementation).
- **Maintenance Burden:** Difficult to navigate and test individual strategy handlers in isolation.
- **Portability:** Large files increase the risk of platform-specific leakage.

## Proposed Refactor

1. **Extract Strategy Handlers:** Create `src/domain/strategies/`.
2. **Modularize Restore:** Move `restoreConvergentStreaming`, `restoreFramedStreaming`, etc., into standalone strategy classes or function modules.
3. **Modularize Store:** Move convergent chunk hashing and framed record construction into dedicated helpers.
4. **Delegate:** Update `CasService` to delegate byte-level work to these specialized handlers.

## Definition of Done

- [x] `CasService.js` is reduced to < 500 lines of orchestration logic.
- [x] All store/restore strategies are unit-tested in isolation.
- [x] No regressions in public API behavior.

## Resolution

Resolved on 2026-05-05 by extracting the byte-level store/restore and adjacent
domain responsibilities into dedicated runtime classes:

- `src/domain/services/ChunkRepository.js`
- `src/domain/services/CompressionStreams.js`
- `src/domain/services/ManifestRepository.js`
- `src/domain/services/RecipientService.js`
- `src/domain/services/IntegrityVerifier.js`
- `src/domain/strategies/StorePlain.js`
- `src/domain/strategies/StoreConvergent.js`
- `src/domain/strategies/StoreFramed.js`
- `src/domain/strategies/StoreWhole.js`
- `src/domain/strategies/RestorePlain.js`
- `src/domain/strategies/RestoreCompressed.js`
- `src/domain/strategies/RestoreConvergent.js`
- `src/domain/strategies/RestoreFramed.js`
- `src/domain/strategies/RestoreWhole.js`
- `src/domain/strategies/FramedRecordCodec.js`

`CasService.js` is now 420 lines and acts as the public facade/orchestrator.
Regression coverage includes `test/unit/docs/casservice-decomposition.test.js`
plus direct unit coverage for the extracted runtime classes.
