import CasError from '../errors/CasError.js';
import { ErrorCodes } from '../errors/index.js';
import Oid from '../value-objects/Oid.js';
import ReservationRefusal from '../value-objects/ReservationRefusal.js';

const KEY_PATTERN = /^[!-~]{1,128}$/u;
const BINDING_PATTERN = /^[0-9a-f]{64}$/u;
const PHASES = new Set(['reserved', 'prepared', 'armed', 'settled', 'cancelled']);

/**
 * Immutable candidate for one attempt's ledger record.
 *
 * This class performs no storage operation and grants no publication permission.
 * Its owner must persist the winning transition and validate custody before
 * acknowledging any durable outcome. Uncertainty belongs to that observation,
 * not to a made-up durable phase in this record.
 */
export default class ReservationRecord {
  constructor(value) {
    assertRecordInput(value);
    const { key, binding, phase, preparation = null, settlement = null } = value;
    assertIdentity(key, binding);
    assertPhase(phase);
    const prepared = canonicalEvidence(preparation);
    const settled = canonicalEvidence(settlement);
    assertPhaseEvidence({ phase, preparation: prepared, settlement: settled });
    this.key = key;
    this.binding = binding;
    this.phase = phase;
    this.preparation = prepared;
    this.settlement = settled;
    Object.freeze(this);
  }

  /** One charged record slot, or zero for a terminal cancelled tombstone. */
  get charge() {
    return this.phase === 'cancelled' ? 0 : 1;
  }

  /** Bind the original prepared custody generation; never replace its evidence. */
  prepare(commitOid) {
    const preparation = requiredEvidence(commitOid);
    if (this.phase === 'cancelled') {
      return new ReservationRefusal('cancelled');
    }
    if (this.preparation !== null) {
      return this.preparation === preparation
        ? this
        : new ReservationRefusal('preparation-mismatch');
    }
    return this.#next('prepared', { preparation });
  }

  /** Propose irreversible arming once; recovered arming is not a second permit. */
  arm() {
    if (this.phase === 'cancelled') {
      return new ReservationRefusal('cancelled');
    }
    if (this.phase === 'settled') {
      return new ReservationRefusal('already-settled');
    }
    if (this.phase === 'armed') {
      return new ReservationRefusal('already-armed');
    }
    if (this.phase !== 'prepared') {
      return new ReservationRefusal('not-prepared');
    }
    return this.#next('armed');
  }

  /** Prepared reads and armed writes may settle after their final pin is durable. */
  settle(commitOid) {
    const settlement = requiredEvidence(commitOid);
    if (this.phase === 'cancelled') {
      return new ReservationRefusal('cancelled');
    }
    if (this.preparation === null) {
      return new ReservationRefusal('not-prepared');
    }
    assertSameObjectFormat(this.preparation, settlement);
    if (this.settlement !== null) {
      return this.settlement === settlement
        ? this
        : new ReservationRefusal('settlement-mismatch');
    }
    return this.#next('settled', { settlement });
  }

  /** Cancellation releases a slot only before irreversible arming/settlement. */
  cancel() {
    if (this.phase === 'armed' || this.phase === 'settled') {
      return new ReservationRefusal('irreversible');
    }
    return this.phase === 'cancelled' ? this : this.#next('cancelled');
  }

  #next(phase, { preparation = this.preparation, settlement = this.settlement } = {}) {
    return new ReservationRecord({
      key: this.key,
      binding: this.binding,
      phase,
      preparation,
      settlement,
    });
  }
}

function assertRecordInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('Reservation record requires named fields');
  }
}

function assertIdentity(key, binding) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw invalid('Reservation key must be 1 to 128 printable ASCII bytes without spaces');
  }
  if (typeof binding !== 'string' || !BINDING_PATTERN.test(binding)) {
    throw invalid('Reservation binding must be a canonical SHA-256 digest');
  }
}

function assertPhase(phase) {
  if (!PHASES.has(phase)) {
    throw invalid('Reservation phase is invalid');
  }
}

function canonicalEvidence(value) {
  return value === null ? null : requiredEvidence(value);
}

function requiredEvidence(value) {
  if (typeof value !== 'string' || !Oid.isValid(value)) {
    throw invalid('Reservation evidence must name a canonical Git commit OID');
  }
  const canonical = Oid.from(value).toString();
  if (canonical !== value) {
    throw invalid('Reservation evidence OID must use canonical lowercase encoding');
  }
  return canonical;
}

function assertPhaseEvidence({ phase, preparation, settlement }) {
  if (phase === 'reserved' && preparation !== null) {
    throw invalid('Reserved attempt cannot already claim prepared custody');
  }
  if (phase !== 'reserved' && phase !== 'cancelled' && preparation === null) {
    throw invalid('This reservation phase requires original preparation evidence');
  }
  if ((phase === 'settled') !== (settlement !== null)) {
    throw invalid('Only a settled reservation has settlement evidence');
  }
  if (settlement !== null) {
    assertSameObjectFormat(preparation, settlement);
  }
}

function assertSameObjectFormat(preparation, settlement) {
  if (preparation.length !== settlement.length) {
    throw invalid('Reservation evidence must use one Git object format');
  }
}

function invalid(message) {
  return new CasError(message, ErrorCodes.INVALID_OPTIONS);
}
