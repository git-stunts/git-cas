# ISSUE: CasService.js God Object (Architectural Debt)

**ID:** `BAD-CODE-001`
**Status:** `Backlog`
**Priority:** `Medium`
**Component:** `Domain / Services`

## Context

While `StorePipeline` and `RestorePipeline` orchestration was extracted during the v6.0.0 cycle, the actual byte-level strategy implementation for every encryption and restore mode (convergent, framed, whole, legacy) remains inside `CasService.js`. The file is currently ~2300 lines.

## Infraction

- **God Object:** `CasService` handles too many responsibilities (orchestration, strategy selection, and strategy implementation).
- **Maintenance Burden:** Difficult to navigate and test individual strategy handlers in isolation.
- **Portability:** Large files increase the risk of platform-specific leakage.

## Proposed Refactor

1.  **Extract Strategy Handlers:** Create a `strategies/` directory under `src/domain/services/`.
2.  **Modularize Restore:** Move `restoreConvergentStreaming`, `restoreFramedStreaming`, etc., into standalone strategy classes or function modules.
3.  **Modularize Store:** Move convergent chunk hashing and framed record construction into dedicated helpers.
4.  **Delegate:** Update `CasService` to delegate byte-level work to these specialized handlers.

## Definition of Done

- `CasService.js` is reduced to < 500 lines of orchestration logic.
- All store/restore strategies are unit-tested in isolation.
- No regressions in public API behavior.
