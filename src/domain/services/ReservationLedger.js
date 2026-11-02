import ReservationRecord from './ReservationRecord.js';
import ReservationIndex from './ReservationIndex.js';
import ReservationLedgerStore from './ReservationLedgerStore.js';
import ReservationPolicy from '../value-objects/ReservationPolicy.js';
import ReservationLedgerHeader from '../value-objects/ReservationLedgerHeader.js';
import ReservationAdmission from '../value-objects/ReservationAdmission.js';
import ReservationLedgerRefusal from '../value-objects/ReservationLedgerRefusal.js';
import ReservationIndeterminate from '../value-objects/ReservationIndeterminate.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';
import { CasError, ErrorCodes } from '../errors/index.js';

const MAX_CHECKED_ATTEMPTS = 4;

/** Private hard record-slot admission. Custody and execution are separate. */
export default class ReservationLedger {
  #policy;
  #index;
  #store;

  constructor({ policy, index, store }) {
    if (!(policy instanceof ReservationPolicy) || !(index instanceof ReservationIndex) ||
        !(store instanceof ReservationLedgerStore)) {
      throw new InvalidOptionsError('Reservation ledger requires a validated policy, index and store');
    }
    this.#policy = policy;
    this.#index = index;
    this.#store = store;
    Object.freeze(this);
  }

  async reserve({ key, binding }) {
    const record = new ReservationRecord({ key, binding, phase: 'reserved' });
    for (let attempt = 0; attempt < MAX_CHECKED_ATTEMPTS; attempt++) {
      let observation;
      try {
        observation = await this.#observe(record);
      } catch (error) {
        return new ReservationIndeterminate(record, error);
      }
      if (observation.result !== null) {
        return observation.result;
      }
      try {
        return await this.#publish(record, observation.snapshot);
      } catch (error) {
        if (error instanceof CasError && error.code === ErrorCodes.GIT_REF_CONFLICT) {
          continue;
        }
        return await this.#recover(record, error);
      }
    }
    return new ReservationLedgerRefusal(record, 'contention');
  }

  async #observe(record) {
    const snapshot = await this.#store.read(this.#policy.namespace);
    if (snapshot === null) {
      return { snapshot, result: null };
    }
    if (!this.#policy.equals(snapshot.header.policy)) {
      return { snapshot, result: new ReservationLedgerRefusal(record, 'policy-mismatch') };
    }
    const existing = await this.#index.get(snapshot.indexRoot, record.key);
    const result = existing === null ? capacityDecision(record, snapshot) : recoveryDecision(record, existing, snapshot);
    return { snapshot, result };
  }

  async #publish(record, before) {
    const indexRoot = await this.#index.put(before?.indexRoot ?? null, record);
    const header = new ReservationLedgerHeader({ policy: this.#policy, charged: (before?.header.charged ?? 0) + 1 });
    const snapshot = await this.#store.write({ before, header, indexRoot });
    return new ReservationAdmission({ status: 'admitted', record, revision: snapshot.revision });
  }

  async #recover(record, writeError) {
    try {
      const { result } = await this.#observe(record);
      // Only positive evidence of this same installed attempt resolves a lost
      // acknowledgement. A later absent observation cannot cancel a pending I/O.
      return result instanceof ReservationAdmission ? result : new ReservationIndeterminate(record, writeError);
    } catch (inspectionError) {
      return new ReservationIndeterminate(record, new CasError(
        'Reservation publication and subsequent inspection failed', ErrorCodes.GIT_ERROR,
        { writeError, inspectionError },
      ));
    }
  }
}

function capacityDecision(record, snapshot) {
  return snapshot.header.charged === snapshot.header.policy.limit ? new ReservationLedgerRefusal(record, 'capacity-full') : null;
}

function recoveryDecision(attempt, existing, snapshot) {
  if (existing.charge > snapshot.header.charged) {
    throw new ReservationStorageError('Reservation record charge exceeds its ledger aggregate');
  }
  if (existing.binding !== attempt.binding) {
    return new ReservationLedgerRefusal(attempt, 'binding-conflict');
  }
  if (existing.phase === 'cancelled') {
    return new ReservationLedgerRefusal(attempt, 'cancelled');
  }
  return new ReservationAdmission({ status: 'recovered', record: existing, revision: snapshot.revision });
}
