import Oid from './Oid.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** A real blob/tree reachability edge, never a gitlink or metadata-only OID. */
export default class ReservationSupport {
  constructor({ type, oid }) {
    if (!['blob', 'tree'].includes(type) || !Oid.isValid(oid) || oid !== oid.toLowerCase()) {
      throw new InvalidOptionsError('Reservation support requires a blob/tree type and canonical OID');
    }
    this.type = type;
    this.oid = oid;
    Object.freeze(this);
  }

  get mode() {
    return this.type === 'tree' ? '040000' : '100644';
  }

  equals(other) {
    return other instanceof ReservationSupport && this.type === other.type && this.oid === other.oid;
  }
}
