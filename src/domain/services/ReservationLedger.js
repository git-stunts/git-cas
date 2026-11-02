import ReservationRecord from './ReservationRecord.js';
import ReservationIndex from './ReservationIndex.js';
import ReservationLedgerStore from './ReservationLedgerStore.js';
import ReservationCustodyStore from './ReservationCustodyStore.js';
import ReservationRefusal from '../value-objects/ReservationRefusal.js';
import ReservationEvidence from '../value-objects/ReservationEvidence.js';
import ReservationPolicy from '../value-objects/ReservationPolicy.js';
import ReservationLedgerHeader from '../value-objects/ReservationLedgerHeader.js';
import ReservationResult from '../value-objects/ReservationResult.js';
import ReservationLedgerRefusal from '../value-objects/ReservationLedgerRefusal.js';
import ReservationIndeterminate from '../value-objects/ReservationIndeterminate.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';
import { CasError, ErrorCodes } from '../errors/index.js';

const MAX_CHECKED_ATTEMPTS = 4;

/** Private reservation protocol; application meaning and execution stay outside. */
export default class ReservationLedger {
  #policy;
  #index;
  #store;
  #custody;

  constructor({ policy, index, store, custody }) {
    if (!(policy instanceof ReservationPolicy) || !(index instanceof ReservationIndex) ||
        !(store instanceof ReservationLedgerStore) || !(custody instanceof ReservationCustodyStore) ||
        custody.namespace !== policy.namespace) {
      throw new InvalidOptionsError('Reservation ledger requires policy, index, ledger and matching custody stores');
    }
    this.#policy = policy;
    this.#index = index;
    this.#store = store;
    this.#custody = custody;
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
    const { snapshot, existing, result } = await this.#readAttempt(record);
    if (result !== null || snapshot === null) {
      return { snapshot, result };
    }
    await this.#verifyCustody(existing);
    return { snapshot, result: existing === null ? capacityDecision(record, snapshot) : recoveryDecision(record, existing, snapshot) };
  }

  async #readAttempt(record) {
    const snapshot = await this.#store.read(this.#policy.namespace);
    if (snapshot === null) {
      return { snapshot, existing: null, result: null };
    }
    if (!this.#policy.equals(snapshot.header.policy)) {
      return { snapshot, existing: null, result: new ReservationLedgerRefusal(record, 'policy-mismatch') };
    }
    const existing = await this.#index.get(snapshot.indexRoot, record.key);
    if (existing !== null && existing.charge > snapshot.header.charged) {
      throw new ReservationStorageError('Reservation record charge exceeds its ledger aggregate');
    }
    const result = existing !== null && existing.binding !== record.binding ? new ReservationLedgerRefusal(record, 'binding-conflict') : null;
    return { snapshot, existing, result };
  }

  async #publish(record, before) {
    const indexRoot = await this.#index.put(before?.indexRoot ?? null, record);
    const header = new ReservationLedgerHeader({ policy: this.#policy, charged: (before?.header.charged ?? 0) + 1 });
    const snapshot = await this.#store.write({ before, header, indexRoot });
    return new ReservationResult({ status: 'admitted', record, revision: snapshot.revision });
  }

  async #recover(record, writeError) {
    try {
      const { result } = await this.#observe(record);
      // Only positive evidence of this same installed attempt resolves a lost
      // acknowledgement. A later absent observation cannot cancel a pending I/O.
      return result instanceof ReservationResult ? result : new ReservationIndeterminate(record, writeError);
    } catch (inspectionError) {
      return new ReservationIndeterminate(record, new CasError(
        'Reservation publication and subsequent inspection failed', ErrorCodes.GIT_ERROR,
        { writeError, inspectionError },
      ));
    }
  }

  async prepare({ key, binding, evidence }) {
    assertEvidence(evidence);
    return await this.#transition('prepare', new ReservationRecord({ key, binding, phase: 'reserved' }), evidence);
  }

  async arm({ key, binding }) {
    return await this.#transition('arm', new ReservationRecord({ key, binding, phase: 'reserved' }));
  }

  async settle({ key, binding, evidence }) {
    assertEvidence(evidence);
    return await this.#transition('settle', new ReservationRecord({ key, binding, phase: 'reserved' }), evidence);
  }

  async cancel({ key, binding }) {
    return await this.#transition('cancel', new ReservationRecord({ key, binding, phase: 'reserved' }));
  }

  async inspect({ key, binding }) {
    const attempt = new ReservationRecord({ key, binding, phase: 'reserved' });
    try {
      const { snapshot, existing, result } = await this.#requiredAttempt(attempt);
      if (result !== null) {
        return result;
      }
      await this.#verifyCustody(existing);
      return new ReservationResult({ status: 'recovered', record: existing, revision: snapshot.revision });
    } catch (error) {
      return new ReservationIndeterminate(attempt, error);
    }
  }

  async #transition(operation, attempt, evidence) {
    for (let retry = 0; retry < MAX_CHECKED_ATTEMPTS; retry++) {
      let next = null;
      try {
        const { snapshot, existing, result } = await this.#requiredAttempt(attempt);
        if (result !== null) {
          return result;
        }
        if (existing.phase === 'cancelled') {
          return await this.#cancelled(operation, existing, snapshot);
        }
        await this.#verifyCustody(existing);
        next = await this.#next(operation, existing, evidence);
        if (next instanceof ReservationRefusal) {
          return new ReservationLedgerRefusal(attempt, next.reason);
        }
        await this.#verifyCustody(next);
        if (next === existing) {
          return new ReservationResult({ status: 'recovered', record: next, revision: snapshot.revision });
        }
        const installed = await this.#publishTransition({ before: snapshot, previous: existing, next });
        if (operation === 'cancel') {
          await this.#custody.discardCancelled(next);
        }
        return new ReservationResult({ status: next.phase, record: next, revision: installed.revision });
      } catch (error) {
        if (error instanceof CasError && error.code === ErrorCodes.GIT_REF_CONFLICT) {
          continue;
        }
        return await this.#recoverTransition({ operation, attempt, next, error });
      }
    }
    return new ReservationLedgerRefusal(attempt, 'contention');
  }

  async #requiredAttempt(attempt) {
    const observed = await this.#readAttempt(attempt);
    if (observed.result !== null || observed.existing !== null) {
      return observed;
    }
    return { ...observed, result: new ReservationLedgerRefusal(attempt, 'not-reserved') };
  }

  async #next(operation, record, evidence) {
    if (operation === 'cancel') {
      return record.cancel();
    }
    if (operation === 'arm') {
      return record.arm();
    }
    const pin = operation === 'prepare' ? await this.#custody.prepare(record, evidence) : await this.#custody.settle(record, evidence);
    if (pin instanceof ReservationRefusal) {
      return pin;
    }
    return operation === 'prepare' ? record.prepare(pin.revision) : record.settle(pin.revision);
  }

  async #publishTransition({ before, previous, next }) {
    const indexRoot = await this.#index.put(before.indexRoot, next);
    const header = new ReservationLedgerHeader({
      policy: this.#policy, charged: before.header.charged + next.charge - previous.charge,
    });
    return await this.#store.write({ before, header, indexRoot });
  }

  async #cancelled(operation, record, snapshot) {
    await this.#custody.discardCancelled(record);
    return operation === 'cancel' ? new ReservationResult({ status: 'cancelled', record, revision: snapshot.revision }) :
      new ReservationLedgerRefusal(record, 'cancelled');
  }

  async #verifyCustody(record) {
    if (record !== null && record.preparation !== null && record.phase !== 'cancelled') {
      await this.#custody.verify(record);
    }
  }

  async #recoverTransition({ operation, attempt, next, error }) {
    try {
      const { snapshot, existing, result } = await this.#readAttempt(attempt);
      if (result !== null || existing === null) {
        return new ReservationIndeterminate(attempt, error);
      }
      if (existing.phase === 'cancelled') {
        return await this.#cancelled(operation, existing, snapshot);
      }
      await this.#verifyCustody(existing);
      if (operation === 'arm' && ['armed', 'settled'].includes(existing.phase)) {
        return new ReservationLedgerRefusal(attempt, existing.phase === 'armed' ? 'already-armed' : 'already-settled');
      }
      if (next instanceof ReservationRecord && transitionObserved(operation, next, existing)) {
        return new ReservationResult({ status: 'recovered', record: existing, revision: snapshot.revision });
      }
      return new ReservationIndeterminate(attempt, error);
    } catch (inspectionError) {
      return new ReservationIndeterminate(attempt, new CasError(
        'Reservation operation and inspection failed', ErrorCodes.GIT_ERROR, { operationError: error, inspectionError },
      ));
    }
  }
}

function capacityDecision(record, snapshot) {
  return snapshot.header.charged === snapshot.header.policy.limit ? new ReservationLedgerRefusal(record, 'capacity-full') : null;
}

function recoveryDecision(attempt, existing, snapshot) {
  if (existing.phase === 'cancelled') {
    return new ReservationLedgerRefusal(attempt, 'cancelled');
  }
  return new ReservationResult({ status: 'recovered', record: existing, revision: snapshot.revision });
}

function transitionObserved(operation, next, existing) {
  if (operation === 'prepare') {
    return existing.preparation === next.preparation && existing.preparation !== null;
  }
  return operation === 'settle' && existing.settlement === next.settlement && existing.settlement !== null;
}

function assertEvidence(evidence) {
  if (!(evidence instanceof ReservationEvidence)) {
    throw new InvalidOptionsError('Reservation preparation and settlement require validated evidence');
  }
}
