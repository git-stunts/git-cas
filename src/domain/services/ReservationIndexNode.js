import ReservationStorageError from '../errors/ReservationStorageError.js';
import Oid from '../value-objects/Oid.js';
import { RESERVATION_ROUTE_DIGITS } from '../value-objects/ReservationKey.js';

const FANOUT = 16;
const DIGIT = /^[0-9a-f]$/u;
const MODES = Object.freeze({ blob: '100644', tree: '040000' });

/**
 * A bounded, ordered routing node. A record blob sits at the shortest route
 * prefix that no other record shares, so a child above the final digit is a
 * subtree or a record. A final-depth child is always a record.
 */
export default class ReservationIndexNode {
  #entries;

  constructor({ entries, depth, oidLength }) {
    assertShape(entries, depth, oidLength);
    this.depth = depth;
    this.oidLength = oidLength;
    this.#entries = Object.freeze(entries.map((entry) => checkedEntry(entry, depth, oidLength)));
    for (let i = 1; i < this.#entries.length; i++) {
      if (this.#entries[i - 1].name >= this.#entries[i].name) {
        throw new ReservationStorageError('Reservation node entries must be ordered and unique');
      }
    }
    Object.freeze(this);
  }

  child(digit) {
    return this.#entries.find((entry) => entry.name === digit) ?? null;
  }

  get entries() {
    return this.#entries;
  }

  withChild(digit, { oid, type }) {
    const entry = { name: digit, oid, type, mode: MODES[type] };
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

function checkedEntry(entry, depth, oidLength) {
  assertRoutingName(entry);
  const final = depth === RESERVATION_ROUTE_DIGITS - 1;
  if ((entry.type !== 'blob' && (final || entry.type !== 'tree')) || entry.mode !== MODES[entry.type]) {
    throw new ReservationStorageError('Reservation index entry type or mode is invalid');
  }
  if (!Oid.isValid(entry.oid) || entry.oid.length !== oidLength || Oid.from(entry.oid).toString() !== entry.oid) {
    throw new ReservationStorageError('Reservation index entry OID is invalid');
  }
  return Object.freeze({ name: entry.name, mode: entry.mode, type: entry.type, oid: entry.oid });
}

function assertRoutingName(entry) {
  if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string' || !DIGIT.test(entry.name)) {
    throw new ReservationStorageError('Reservation index entry name is invalid');
  }
}
