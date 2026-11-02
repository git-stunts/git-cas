import CasError from '../errors/CasError.js';
import { ErrorCodes } from '../errors/index.js';

const REASONS = new Set([
  'not-prepared',
  'already-armed',
  'already-settled',
  'cancelled',
  'irreversible',
  'preparation-mismatch',
  'settlement-mismatch',
]);

/** Expected refusal of a local reservation transition; never an I/O outcome. */
export default class ReservationRefusal {
  constructor(reason) {
    if (!REASONS.has(reason)) {
      throw new CasError('Unknown reservation refusal reason', ErrorCodes.INVALID_OPTIONS);
    }
    this.reason = reason;
    Object.freeze(this);
  }
}
