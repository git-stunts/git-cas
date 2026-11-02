/* @ts-self-types="./ReservationNamespace.d.ts" */
import ReservationLedger from './ReservationLedger.js';
import ReservationListing from './ReservationListing.js';
import ReservationLedgerSnapshot from '../value-objects/ReservationLedgerSnapshot.js';
import ReservationEvidence from '../value-objects/ReservationEvidence.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';

/** Opened durable authority. No method executes an application effect. */
export default class ReservationNamespace {
  #ledger;
  #listing;

  constructor({ snapshot, ledger, listing }) {
    if (!(snapshot instanceof ReservationLedgerSnapshot) || !(ledger instanceof ReservationLedger) ||
        !(listing instanceof ReservationListing)) {
      throw new InvalidOptionsError('Reservation namespace requires its installed snapshot and services');
    }
    this.status = 'opened';
    this.namespace = snapshot.header.policy.namespace;
    this.policy = snapshot.header.policy;
    this.openedRevision = snapshot.revision;
    this.#ledger = ledger;
    this.#listing = listing;
    Object.freeze(this);
  }

  async reserve(identity) { return await this.#ledger.reserve(namedOptions(identity)); }
  async arm(identity) { return await this.#ledger.arm(namedOptions(identity)); }
  async cancel(identity) { return await this.#ledger.cancel(namedOptions(identity)); }
  async reconcile(identity) { return await this.#ledger.reconcile(namedOptions(identity)); }
  async inspect(identity) { return await this.#ledger.inspectCustody(namedOptions(identity)); }
  async readEvidence(options) { return await this.#ledger.readEvidence(namedOptions(options)); }
  async list(options = {}) { return await this.#listing.list(namedOptions(options)); }

  async prepare(options) {
    const { key, binding, evidence } = namedOptions(options);
    return await this.#ledger.prepare({ key, binding, evidence: new ReservationEvidence(evidence) });
  }

  async settle(options) {
    const { key, binding, evidence } = namedOptions(options);
    return await this.#ledger.settle({ key, binding, evidence: new ReservationEvidence(evidence) });
  }
}

function namedOptions(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidOptionsError('Reservation operations require named fields');
  }
  return value;
}
