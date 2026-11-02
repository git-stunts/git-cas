import type { ReservationCursorData, ReservationPhase } from '../services/ReservationNamespace.js';

/** A validated, serializable ledger position; not a retention pin or capability. */
export default class ReservationCursor {
  constructor(options: ReservationCursorData);
  readonly namespace: string;
  readonly revision: string;
  readonly after: string;
  readonly phase: ReservationPhase | null;
  static assertPhase(phase: ReservationPhase | null): void;
}
