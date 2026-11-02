import ReservationRecord from '../services/ReservationRecord.js';
import ReservationLedgerSnapshot from './ReservationLedgerSnapshot.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** Observed admission, never permission to execute an application effect. */
export default class ReservationAdmission {
  constructor({ status, record, revision }) {
    if (!['admitted', 'recovered'].includes(status) || !(record instanceof ReservationRecord) || record.charge !== 1) {
      throw new InvalidOptionsError('Reservation admission requires a charged record and known outcome');
    }
    ReservationLedgerSnapshot.assertOid(revision);
    this.status = status;
    this.record = record;
    this.revision = revision;
    Object.freeze(this);
  }
}
