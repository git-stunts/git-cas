import ReservationRecord from '../services/ReservationRecord.js';
import ReservationLedgerSnapshot from './ReservationLedgerSnapshot.js';
import ReservationCustodySnapshot from './ReservationCustodySnapshot.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** Ledger observation followed by pin observation, never a cross-ref snapshot. */
export default class ReservationInspection {
  constructor({ snapshot, record, custody }) {
    if (!(snapshot instanceof ReservationLedgerSnapshot) || !(record instanceof ReservationRecord) ||
        (custody !== null && !(custody instanceof ReservationCustodySnapshot))) {
      throw new InvalidOptionsError('Reservation inspection requires validated ledger and custody observations');
    }
    this.status = 'inspected';
    this.record = record;
    this.revision = snapshot.revision;
    this.policy = snapshot.header.policy;
    this.charged = snapshot.header.charged;
    this.custody = custody;
    Object.freeze(this);
  }
}
