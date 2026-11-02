import ReservationPolicy from './ReservationPolicy.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';

/** Policy and aggregate charge published atomically with the attempt index. */
export default class ReservationLedgerHeader {
  constructor({ policy, charged }) {
    if (!(policy instanceof ReservationPolicy) || !Number.isSafeInteger(charged) ||
        charged < 0 || charged > policy.limit) {
      throw new ReservationStorageError('Reservation ledger charge must fit its validated policy');
    }
    this.policy = policy;
    this.charged = charged;
    Object.freeze(this);
  }
}
