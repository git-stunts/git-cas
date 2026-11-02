import Oid from './Oid.js';
import ReservationSupport from './ReservationSupport.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';

export const RESERVATION_MAX_SUPPORTS = 64;
export const RESERVATION_MAX_PARENTS = 63;

/** Canonical bounded support edges; the original preparation gets parent 64. */
export default class ReservationEvidenceRoots {
  constructor({ supports = [], parents = [] } = {}) {
    if (!Array.isArray(supports) || supports.length > RESERVATION_MAX_SUPPORTS ||
        !Array.isArray(parents) || parents.length > RESERVATION_MAX_PARENTS) {
      throw new InvalidOptionsError('Reservation evidence allows at most 64 supports and 63 explicit parents');
    }
    this.supports = Object.freeze(supports.map((item) => new ReservationSupport(item)).sort(compareSupport));
    this.parents = Object.freeze(parents.map(canonicalParent).sort());
    if (new Set(this.supports.map((item) => `${item.type}:${item.oid}`)).size !== this.supports.length ||
        new Set(this.parents).size !== this.parents.length) {
      throw new InvalidOptionsError('Reservation evidence roots must be unique');
    }
    Object.freeze(this);
  }

  assertFormat(oid) {
    canonicalParent(oid);
    if (this.parents.some((parent) => parent.length !== oid.length) ||
        this.supports.some((item) => item.oid.length !== oid.length)) {
      throw new ReservationStorageError('Reservation evidence roots use different Git object formats');
    }
  }

  equals(other) {
    return other instanceof ReservationEvidenceRoots && this.parents.length === other.parents.length &&
      this.supports.length === other.supports.length && this.parents.every((oid, i) => oid === other.parents[i]) &&
      this.supports.every((item, i) => item.equals(other.supports[i]));
  }

  toTreeLines() {
    return this.supports.map((item, i) => `${item.mode} ${item.type} ${item.oid}\t${slot(i)}`);
  }

  assertTree(entries) {
    if (!Array.isArray(entries) || entries.length !== this.supports.length) {
      throw new ReservationStorageError('Reservation support tree count disagrees with its descriptor');
    }
    for (let i = 0; i < entries.length; i++) {
      const actual = entries[i];
      const expected = this.supports[i];
      if (actual.name !== slot(i) || actual.mode !== expected.mode || actual.type !== expected.type || actual.oid !== expected.oid) {
        throw new ReservationStorageError('Reservation support tree disagrees with its descriptor');
      }
    }
  }
}

function canonicalParent(oid) {
  if (!Oid.isValid(oid) || oid !== oid.toLowerCase()) {
    throw new InvalidOptionsError('Reservation evidence requires canonical Git OIDs');
  }
  return oid;
}

function compareSupport(left, right) {
  const a = `${left.type}:${left.oid}`;
  const b = `${right.type}:${right.oid}`;
  return a < b ? -1 : a > b ? 1 : 0;
}

function slot(index) {
  return index.toString(16).padStart(2, '0');
}
