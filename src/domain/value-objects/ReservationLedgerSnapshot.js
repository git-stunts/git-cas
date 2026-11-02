import ReservationLedgerHeader from './ReservationLedgerHeader.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';
import Oid from './Oid.js';

/** One validated immutable ledger generation; no claim about later heads. */
export default class ReservationLedgerSnapshot {
  constructor({ header, indexRoot, revision }) {
    if (!(header instanceof ReservationLedgerHeader)) {
      throw new ReservationStorageError('Reservation snapshot requires a ledger header');
    }
    ReservationLedgerSnapshot.assertOid(indexRoot);
    ReservationLedgerSnapshot.assertOid(revision);
    if (indexRoot.length !== revision.length) {
      throw new ReservationStorageError('Reservation snapshot changed Git object format');
    }
    this.header = header;
    this.indexRoot = indexRoot;
    this.revision = revision;
    Object.freeze(this);
  }

  static assertOid(value) {
    if (!Oid.isValid(value) || Oid.from(value).toString() !== value) {
      throw new ReservationStorageError('Reservation ledger requires a canonical Git OID');
    }
  }
}
