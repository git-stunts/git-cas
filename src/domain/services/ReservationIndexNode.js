import ReservationStorageError from '../errors/ReservationStorageError.js';
import Oid from '../value-objects/Oid.js';
import { RESERVATION_ROUTE_DIGITS } from '../value-objects/ReservationKey.js';

const FANOUT = 16;
const DIGIT = /^[0-9a-f]$/u;

/** A bounded, ordered routing node; final-depth children are record blobs. */
export default class ReservationIndexNode {
  #entries;

  constructor({ entries, depth, oidLength }) {
    assertShape(entries, depth, oidLength);
    this.depth = depth;
    this.oidLength = oidLength;
    const type = depth === RESERVATION_ROUTE_DIGITS - 1 ? 'blob' : 'tree';
    this.#entries = Object.freeze(entries.map((entry) => checkedEntry(entry, type, oidLength)));
    for (let i = 1; i < this.#entries.length; i++) {
      if (this.#entries[i - 1].name >= this.#entries[i].name) {
        throw new ReservationStorageError('Reservation node entries must be ordered and unique');
      }
    }
    Object.freeze(this);
  }

  child(digit) {
    return this.#entries.find((entry) => entry.name === digit)?.oid ?? null;
  }

  get entries() {
    return this.#entries;
  }

  withChild(digit, oid) {
    const type = this.depth === RESERVATION_ROUTE_DIGITS - 1 ? 'blob' : 'tree';
    const entry = { name: digit, oid, type, mode: type === 'blob' ? '100644' : '040000' };
    const entries = [...this.#entries.filter((item) => item.name !== digit), entry];
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return new ReservationIndexNode({ entries, depth: this.depth, oidLength: this.oidLength });
  }

  toTreeLines() {
    return this.#entries.map((entry) => `${entry.mode} ${entry.type} ${entry.oid}\t${entry.name}`);
  }
}

function assertShape(entries, depth, oidLength) {
  if (!Array.isArray(entries) || entries.length > FANOUT) {
    throw new ReservationStorageError('Reservation index fanout exceeds sixteen entries');
  }
  if (!Number.isInteger(depth) || depth < 0 || depth >= RESERVATION_ROUTE_DIGITS) {
    throw new ReservationStorageError('Reservation index depth is invalid');
  }
  if (oidLength !== 40 && oidLength !== 64) {
    throw new ReservationStorageError('Reservation index object format is invalid');
  }
}

function checkedEntry(entry, type, oidLength) {
  assertRoutingName(entry);
  const mode = type === 'blob' ? '100644' : '040000';
  if (entry.type !== type || entry.mode !== mode) {
    throw new ReservationStorageError('Reservation index entry type or mode is invalid');
  }
  if (!Oid.isValid(entry.oid) || entry.oid.length !== oidLength || Oid.from(entry.oid).toString() !== entry.oid) {
    throw new ReservationStorageError('Reservation index entry OID is invalid');
  }
  return Object.freeze({ name: entry.name, mode, type, oid: entry.oid });
}

function assertRoutingName(entry) {
  if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string' || !DIGIT.test(entry.name)) {
    throw new ReservationStorageError('Reservation index entry name is invalid');
  }
}
