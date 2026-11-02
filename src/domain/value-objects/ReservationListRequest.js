import ReservationCursor from './ReservationCursor.js';
import CollectionNamespace from './CollectionNamespace.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

export const RESERVATION_LIST_MAX_RECORDS = 100;
export const RESERVATION_LIST_MIN_NODES = 129;
export const RESERVATION_LIST_MAX_NODES = 8192;

/** The budget includes every index tree/record read, including cursor seeking. */
export default class ReservationListRequest {
  constructor(namespace, { cursor = null, phase, limit = 100, nodeBudget = 1024 } = {}) {
    this.namespace = CollectionNamespace.from(namespace).toString();
    this.cursor = cursor === null ? null : new ReservationCursor(cursor);
    this.phase = requestedPhase(phase, this.cursor);
    ReservationCursor.assertPhase(this.phase);
    assertBounds(limit, nodeBudget);
    if (this.cursor !== null && (this.cursor.namespace !== this.namespace || this.cursor.phase !== this.phase)) {
      throw new InvalidOptionsError('Reservation cursor belongs to a different namespace or filter');
    }
    this.limit = limit;
    this.nodeBudget = nodeBudget;
    Object.freeze(this);
  }
}

function requestedPhase(phase, cursor) {
  return phase === undefined ? cursor?.phase ?? null : phase;
}

function assertBounds(limit, nodeBudget) {
  if (!Number.isInteger(limit) || limit < 1 || limit > RESERVATION_LIST_MAX_RECORDS ||
      !Number.isInteger(nodeBudget) || nodeBudget < RESERVATION_LIST_MIN_NODES || nodeBudget > RESERVATION_LIST_MAX_NODES) {
    throw new InvalidOptionsError('Reservation listing allows 1–100 records and 129–8192 visited index nodes');
  }
}
