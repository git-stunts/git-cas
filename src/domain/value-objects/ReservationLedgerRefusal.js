import ReservationRecord from '../services/ReservationRecord.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

const REASONS = new Set(['capacity-full', 'binding-conflict', 'cancelled', 'policy-mismatch', 'contention']);

/** An expected admission refusal naming the exact attempted identity. */
export default class ReservationLedgerRefusal {
  constructor(record, reason) {
    if (!(record instanceof ReservationRecord) || !REASONS.has(reason)) {
      throw new InvalidOptionsError('Reservation ledger refusal requires an attempt and known reason');
    }
    this.status = 'refused';
    this.key = record.key;
    this.binding = record.binding;
    this.reason = reason;
    Object.freeze(this);
  }
}
