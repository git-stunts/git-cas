import ReservationCustodyDescriptor from './ReservationCustodyDescriptor.js';
import Oid from './Oid.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';

/** Validated generation identity; the custody store establishes its live pin. */
export default class ReservationCustodySnapshot {
  constructor({ descriptor, revision }) {
    if (!(descriptor instanceof ReservationCustodyDescriptor) || !Oid.isValid(revision) ||
        revision !== revision.toLowerCase() || revision.length !== descriptor.recordOid.length) {
      throw new ReservationStorageError('Custody generation requires a valid descriptor and matching commit OID');
    }
    this.descriptor = descriptor;
    this.revision = revision;
    Object.freeze(this);
  }
}
