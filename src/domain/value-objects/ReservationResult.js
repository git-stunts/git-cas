import ReservationRecord from '../services/ReservationRecord.js';
import ReservationLedgerSnapshot from './ReservationLedgerSnapshot.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** Durable observation. Only a fresh persisted transition may issue `armed`. */
export default class ReservationResult {
  constructor({ status, record, revision }) {
    if (!(record instanceof ReservationRecord) || !validStatus(status, record)) {
      throw new InvalidOptionsError('Reservation result requires a record consistent with its outcome');
    }
    ReservationLedgerSnapshot.assertOid(revision);
    this.status = status;
    this.record = record;
    this.revision = revision;
    Object.freeze(this);
  }
}

function validStatus(status, record) {
  if (status === 'recovered') {
    return true;
  }
  if (status === 'admitted') {
    return record.phase === 'reserved';
  }
  return ['prepared', 'armed', 'settled', 'cancelled'].includes(status) && status === record.phase;
}
