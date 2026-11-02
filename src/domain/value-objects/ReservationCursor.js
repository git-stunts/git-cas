/* @ts-self-types="./ReservationCursor.d.ts" */
import CollectionNamespace from './CollectionNamespace.js';
import Oid from './Oid.js';
import { RESERVATION_PHASES } from '../services/ReservationRecord.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** Serializable position in one immutable ledger, including its phase filter. */
export default class ReservationCursor {
  constructor(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new InvalidOptionsError('Reservation cursor requires named fields');
    }
    const { namespace, revision, after, phase = null } = value;
    if (!Oid.isValid(revision) || revision !== revision.toLowerCase() ||
        typeof after !== 'string' || !/^[0-9a-f]{64}$/u.test(after)) {
      throw new InvalidOptionsError('Reservation cursor requires a canonical snapshot and complete route');
    }
    ReservationCursor.assertPhase(phase);
    this.namespace = CollectionNamespace.from(namespace).toString();
    this.revision = revision;
    this.after = after;
    this.phase = phase;
    Object.freeze(this);
  }

  static assertPhase(phase) {
    if (phase !== null && !RESERVATION_PHASES.includes(phase)) {
      throw new InvalidOptionsError('Reservation phase filter is invalid');
    }
  }
}
