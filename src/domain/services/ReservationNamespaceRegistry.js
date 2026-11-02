import GitPersistencePort from '../../ports/GitPersistencePort.js';
import GitRefPort from '../../ports/GitRefPort.js';
import CryptoPort from '../../ports/CryptoPort.js';
import ReservationCustodyCodecPort from '../../ports/ReservationCustodyCodecPort.js';
import ReservationPolicy from '../value-objects/ReservationPolicy.js';
import ReservationLedgerHeader from '../value-objects/ReservationLedgerHeader.js';
import ReservationOpenRefusal from '../value-objects/ReservationOpenRefusal.js';
import ReservationOpenIndeterminate from '../value-objects/ReservationOpenIndeterminate.js';
import ReservationIndex from './ReservationIndex.js';
import ReservationLedgerStore from './ReservationLedgerStore.js';
import ReservationLedger from './ReservationLedger.js';
import ReservationListing from './ReservationListing.js';
import ReservationCustodyObjects from './ReservationCustodyObjects.js';
import ReservationCustodyStore from './ReservationCustodyStore.js';
import ReservationNamespace from './ReservationNamespace.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import { CasError, ErrorCodes } from '../errors/index.js';

const MAX_OPEN_ATTEMPTS = 4;

/** Creates policy at open, before the first reservation can select a limit. */
export default class ReservationNamespaceRegistry {
  #index;
  #store;
  #ports;

  constructor({ index, store, persistence, refs, crypto, custodyCodec }) {
    if (!(index instanceof ReservationIndex) || !(store instanceof ReservationLedgerStore)) {
      throw new InvalidOptionsError('Reservation registry requires an index and ledger store');
    }
    assertPorts({ persistence, refs, crypto, custodyCodec });
    this.#index = index;
    this.#store = store;
    this.#ports = Object.freeze({ persistence, refs, crypto, custodyCodec });
    Object.freeze(this);
  }

  async open(options) {
    const policy = new ReservationPolicy(options);
    for (let retry = 0; retry < MAX_OPEN_ATTEMPTS; retry++) {
      try {
        const before = await this.#store.read(policy.namespace);
        if (before !== null) {
          return this.#opened(policy, before);
        }
        const snapshot = await this.#store.write({
          before: null, header: new ReservationLedgerHeader({ policy, charged: 0 }), indexRoot: await this.#index.empty(),
        });
        return this.#opened(policy, snapshot);
      } catch (cause) {
        if (cause instanceof CasError && cause.code === ErrorCodes.GIT_REF_CONFLICT) {
          continue;
        }
        return await this.#recover(policy, cause);
      }
    }
    return new ReservationOpenRefusal(policy, 'contention');
  }

  #opened(policy, snapshot) {
    if (!policy.equals(snapshot.header.policy)) {
      return new ReservationOpenRefusal(policy, 'policy-mismatch');
    }
    const { persistence, refs, crypto, custodyCodec } = this.#ports;
    const objects = new ReservationCustodyObjects({ namespace: policy.namespace, persistence, refs, codec: custodyCodec });
    const custody = new ReservationCustodyStore({ objects, refs, crypto });
    const ledger = new ReservationLedger({ policy, index: this.#index, store: this.#store, custody });
    const listing = new ReservationListing({ policy, index: this.#index, store: this.#store });
    return new ReservationNamespace({ snapshot, ledger, listing });
  }

  async #recover(policy, cause) {
    try {
      const snapshot = await this.#store.read(policy.namespace);
      return snapshot === null ? new ReservationOpenIndeterminate(policy, cause) : this.#opened(policy, snapshot);
    } catch (inspectionError) {
      return new ReservationOpenIndeterminate(policy, new CasError(
        'Reservation namespace open and inspection failed', ErrorCodes.GIT_ERROR, { operationError: cause, inspectionError },
      ));
    }
  }
}

function assertPorts({ persistence, refs, crypto, custodyCodec }) {
  if (!(persistence instanceof GitPersistencePort) || !(refs instanceof GitRefPort) ||
      !(crypto instanceof CryptoPort) || !(custodyCodec instanceof ReservationCustodyCodecPort)) {
    throw new InvalidOptionsError('Reservation registry requires injected persistence, ref, crypto and custody codec ports');
  }
}
