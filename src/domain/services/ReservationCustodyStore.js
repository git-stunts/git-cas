import GitRefPort from '../../ports/GitRefPort.js';
import CryptoPort from '../../ports/CryptoPort.js';
import ReservationCustodyObjects from './ReservationCustodyObjects.js';
import ReservationRecord from './ReservationRecord.js';
import ReservationKey from '../value-objects/ReservationKey.js';
import ReservationRefusal from '../value-objects/ReservationRefusal.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';
import { CasError, ErrorCodes } from '../errors/index.js';

/** Per-attempt pins; the ledger owner alone decides when a phase may be issued. */
export default class ReservationCustodyStore {
  #objects;
  #refs;
  #crypto;

  constructor({ objects, refs, crypto }) {
    if (!(objects instanceof ReservationCustodyObjects) || !(refs instanceof GitRefPort) || !(crypto instanceof CryptoPort)) {
      throw new InvalidOptionsError('Custody store requires immutable objects, refs and crypto');
    }
    this.namespace = objects.namespace;
    this.#objects = objects;
    this.#refs = refs;
    this.#crypto = crypto;
    Object.freeze(this);
  }

  async read(attempt) {
    const posture = await this.#refs.inspectRef(await this.#ref(attempt));
    if (posture?.symref !== null) {
      throw new ReservationStorageError('Custody must use a direct ref');
    }
    if (posture.oid === null) {
      return null;
    }
    const current = await this.#objects.read(posture.oid);
    assertIdentity(attempt, current);
    const original = current.descriptor.stage === 'preparation' ? current : await this.#original(attempt, current);
    if (attempt.preparation !== null && original.revision !== attempt.preparation) {
      throw new ReservationStorageError('Custody pin does not retain the original preparation');
    }
    return current;
  }

  async verify(attempt) {
    if (attempt.preparation === null) {
      throw new ReservationStorageError('This attempt has no prepared custody to verify');
    }
    const current = await this.read(attempt);
    if (current === null || (attempt.settlement !== null && current.revision !== attempt.settlement)) {
      throw new ReservationStorageError('Required reservation custody is missing or replaced');
    }
    return current;
  }

  async readEvidence(attempt, stage) {
    await this.verify(attempt);
    const revision = stage === 'preparation' ? attempt.preparation : attempt.settlement;
    return await this.#objects.readEvidence(revision);
  }

  async prepare(attempt, evidence) {
    const descriptor = await this.#objects.describe({ attempt, evidence });
    let current = await this.read(attempt);
    if (current === null) {
      if (attempt.preparation !== null) {
        throw new ReservationStorageError('Cannot recreate missing prepared custody');
      }
      const candidate = await this.#objects.write(descriptor);
      current = await this.#install(attempt, { expected: null, candidate });
    }
    const original = current.descriptor.stage === 'preparation' ? current : await this.#original(attempt, current);
    return original.descriptor.equals(descriptor) ? original : new ReservationRefusal('preparation-mismatch');
  }

  async settle(attempt, evidence) {
    if (attempt.preparation === null) {
      return new ReservationRefusal('not-prepared');
    }
    const descriptor = await this.#objects.describe({ attempt, evidence, preparation: attempt.preparation });
    let current = await this.verify(attempt);
    if (current.descriptor.stage === 'preparation') {
      const candidate = await this.#objects.write(descriptor);
      current = await this.#install(attempt, { expected: current.revision, candidate });
    }
    return current.descriptor.equals(descriptor) ? current : new ReservationRefusal('settlement-mismatch');
  }

  async discardCancelled(attempt) {
    if (!(attempt instanceof ReservationRecord) || attempt.phase !== 'cancelled') {
      throw new InvalidOptionsError('Only a persisted cancelled attempt may have its pin removed');
    }
    const current = await this.read(attempt);
    if (current === null) {
      return;
    }
    try {
      await this.#refs.deleteRef({ ref: await this.#ref(attempt), expectedOldOid: current.revision });
    } catch (writeError) {
      if (await this.#recover(attempt, writeError) !== null) {
        throw writeError;
      }
    }
  }

  async #install(attempt, { expected, candidate }) {
    try {
      await this.#refs.updateRef({ ref: await this.#ref(attempt), newOid: candidate.revision, expectedOldOid: expected });
      return candidate;
    } catch (writeError) {
      const current = await this.#recover(attempt, writeError);
      if (current === null || current.revision === expected) {
        throw writeError;
      }
      return current;
    }
  }

  async #recover(attempt, writeError) {
    try {
      return await this.read(attempt);
    } catch (inspectionError) {
      throw new CasError('Custody mutation and inspection failed', ErrorCodes.GIT_ERROR, { writeError, inspectionError });
    }
  }

  async #original(attempt, settlement) {
    const original = await this.#objects.read(settlement.descriptor.preparation);
    assertIdentity(attempt, original);
    if (original.descriptor.stage !== 'preparation') {
      throw new ReservationStorageError('Settlement must retain a preparation, not another settlement');
    }
    return original;
  }

  async #ref(attempt) {
    if (!(attempt instanceof ReservationRecord)) {
      throw new InvalidOptionsError('Custody operations require a validated attempt');
    }
    const route = await new ReservationKey(attempt.key).route(this.#crypto);
    return `refs/cas/reservation-custody/${this.namespace}/${route}`;
  }
}

function assertIdentity(attempt, generation) {
  if (generation.descriptor.key !== attempt.key || generation.descriptor.binding !== attempt.binding) {
    throw new ReservationStorageError('Custody pin belongs to another attempt identity');
  }
}
