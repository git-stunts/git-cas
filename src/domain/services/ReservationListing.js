import ReservationPolicy from '../value-objects/ReservationPolicy.js';
import ReservationListRequest from '../value-objects/ReservationListRequest.js';
import ReservationPage from '../value-objects/ReservationPage.js';
import ReservationListUnavailable from '../value-objects/ReservationListUnavailable.js';
import ReservationIndex from './ReservationIndex.js';
import ReservationLedgerStore from './ReservationLedgerStore.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';

/** Snapshot-bound diagnostic traversal; never used to make admission decisions. */
export default class ReservationListing {
  #policy;
  #index;
  #store;

  constructor({ policy, index, store }) {
    if (!(policy instanceof ReservationPolicy) || !(index instanceof ReservationIndex) || !(store instanceof ReservationLedgerStore)) {
      throw new InvalidOptionsError('Reservation listing requires a policy, index and ledger store');
    }
    this.#policy = policy;
    this.#index = index;
    this.#store = store;
    Object.freeze(this);
  }

  async list(options) {
    const request = new ReservationListRequest(this.#policy.namespace, options);
    try {
      const snapshot = request.cursor === null ? await this.#store.read(request.namespace) :
        await this.#store.readRevision(request.namespace, request.cursor.revision);
      if (snapshot === null || !snapshot.header.policy.equals(this.#policy)) {
        throw new ReservationStorageError('Reservation namespace is missing or its policy changed');
      }
      const scan = await this.#index.scan(snapshot.indexRoot, request);
      return new ReservationPage(snapshot, scan, request.phase);
    } catch (cause) {
      return new ReservationListUnavailable(request, cause);
    }
  }
}
