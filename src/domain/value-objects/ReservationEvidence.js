import ReservationEvidenceRoots from './ReservationEvidenceRoots.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

export const RESERVATION_PAGE_MAX_BYTES = 16 * 1024 * 1024;

/** Copy-owned page and validated roots; constructor performs no storage I/O. */
export default class ReservationEvidence {
  #record;

  constructor(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new InvalidOptionsError('Reservation evidence requires named fields');
    }
    const { record, supports = [], parents = [] } = value;
    if (!(record instanceof Uint8Array) || record.length > RESERVATION_PAGE_MAX_BYTES) {
      throw new InvalidOptionsError('Reservation evidence page must be at most 16 MiB of bytes');
    }
    this.roots = new ReservationEvidenceRoots({ supports, parents });
    this.#record = Uint8Array.from(record);
    Object.freeze(this);
  }

  get record() {
    return Uint8Array.from(this.#record);
  }
}
