import CollectionNamespace from './CollectionNamespace.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** Immutable record-slot contract persisted by the namespace authority. */
export default class ReservationPolicy {
  constructor({ namespace, capacity }) {
    if (capacity?.unit !== 'record-slot' || !Number.isSafeInteger(capacity.limit) || capacity.limit < 1) {
      throw new InvalidOptionsError('Reservation capacity requires a positive safe record-slot limit');
    }
    this.namespace = CollectionNamespace.from(namespace).toString();
    this.unit = capacity.unit;
    this.limit = capacity.limit;
    Object.freeze(this);
  }

  equals(other) {
    return other instanceof ReservationPolicy && this.namespace === other.namespace &&
      this.unit === other.unit && this.limit === other.limit;
  }
}
