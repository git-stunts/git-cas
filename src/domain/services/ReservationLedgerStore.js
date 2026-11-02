import GitPersistencePort from '../../ports/GitPersistencePort.js';
import GitRefPort from '../../ports/GitRefPort.js';
import ReservationLedgerCodecPort, { RESERVATION_HEADER_MAX_BYTES } from '../../ports/ReservationLedgerCodecPort.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';
import CollectionNamespace from '../value-objects/CollectionNamespace.js';
import ReservationLedgerHeader from '../value-objects/ReservationLedgerHeader.js';
import ReservationLedgerSnapshot from '../value-objects/ReservationLedgerSnapshot.js';

const ROOT_MAX_BYTES = 2 * 1024;
const COMMIT_MAX_BYTES = 16 * 1024;
const LEDGER_MESSAGE = 'git-cas reservation ledger v1';

/** Parentless generations publish the header and point index through one CAS. */
export default class ReservationLedgerStore {
  #persistence;
  #refs;
  #codec;

  constructor({ persistence, refs, codec }) {
    if (!(persistence instanceof GitPersistencePort) || !(refs instanceof GitRefPort) ||
        !(codec instanceof ReservationLedgerCodecPort)) {
      throw new InvalidOptionsError('Reservation ledger requires persistence, ref and header codec ports');
    }
    this.#persistence = persistence;
    this.#refs = refs;
    this.#codec = codec;
    Object.freeze(this);
  }

  async read(namespace) {
    const name = CollectionNamespace.from(namespace).toString();
    const posture = await this.#refs.inspectRef(ledgerRef(name));
    if (posture?.symref !== null) {
      throw new ReservationStorageError('Reservation ledger authority must be a direct ref');
    }
    if (posture.oid === null) {
      return null;
    }
    const revision = posture.oid;
    await this.#assertObject(revision, { type: 'commit', maxBytes: COMMIT_MAX_BYTES });
    const parents = await this.#refs.resolveParents(revision);
    if (!Array.isArray(parents) || parents.length !== 0) {
      throw new ReservationStorageError('Reservation ledger generation must be parentless');
    }
    const root = await this.#refs.resolveTree(revision);
    assertSameFormat(revision, root);
    const { headerOid, indexRoot } = await this.#root(root);
    const header = await this.#header(headerOid);
    if (header.policy.namespace !== name) {
      throw new ReservationStorageError('Reservation header names another namespace');
    }
    return new ReservationLedgerSnapshot({ header, indexRoot, revision });
  }

  async write({ before, header, indexRoot }) {
    assertWrite({ before, header, indexRoot });
    const bytes = this.#codec.encode(header);
    if (!(bytes instanceof Uint8Array) || bytes.length > RESERVATION_HEADER_MAX_BYTES) {
      throw new ReservationStorageError('Encoded reservation header exceeds its byte limit');
    }
    const headerOid = await this.#persistence.writeBlob(bytes);
    assertSameFormat(indexRoot, headerOid);
    const treeOid = await this.#persistence.writeTree([
      `100644 blob ${headerOid}\theader`, `040000 tree ${indexRoot}\trecords`,
    ]);
    assertSameFormat(indexRoot, treeOid);
    const revision = await this.#refs.createCommit({ treeOid, parentOids: [], message: LEDGER_MESSAGE });
    const snapshot = new ReservationLedgerSnapshot({ header, indexRoot, revision });
    await this.#refs.updateRef({
      ref: ledgerRef(header.policy.namespace), newOid: revision, expectedOldOid: before?.revision ?? null,
    });
    return snapshot;
  }

  async #root(root) {
    await this.#assertObject(root, { type: 'tree', maxBytes: ROOT_MAX_BYTES });
    const entries = await this.#persistence.readTree(root);
    if (!Array.isArray(entries) || entries.length !== 2) {
      throw new ReservationStorageError('Reservation ledger root must have exactly two entries');
    }
    const header = entries.find((entry) => entry.name === 'header');
    const records = entries.find((entry) => entry.name === 'records');
    if (header?.type !== 'blob' || header.mode !== '100644' || records?.type !== 'tree' || records.mode !== '040000') {
      throw new ReservationStorageError('Reservation ledger root entries are invalid');
    }
    assertSameFormat(root, header.oid);
    assertSameFormat(root, records.oid);
    await this.#assertObject(records.oid, { type: 'tree', maxBytes: ROOT_MAX_BYTES });
    return { headerOid: header.oid, indexRoot: records.oid };
  }

  async #header(oid) {
    await this.#assertObject(oid, { type: 'blob', maxBytes: RESERVATION_HEADER_MAX_BYTES });
    const header = this.#codec.decode(await this.#persistence.readBlob(oid, RESERVATION_HEADER_MAX_BYTES));
    if (!(header instanceof ReservationLedgerHeader)) {
      throw new ReservationStorageError('Reservation header decoder returned an invalid header');
    }
    return header;
  }

  async #assertObject(oid, { type, maxBytes }) {
    ReservationLedgerSnapshot.assertOid(oid);
    const [actualType, size] = await Promise.all([
      this.#persistence.readObjectType(oid), this.#persistence.readObjectSize(oid),
    ]);
    if (actualType !== type || !Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      throw new ReservationStorageError('Reservation ledger object type or byte bound is invalid', { oid, type, size });
    }
  }
}

function ledgerRef(namespace) {
  return `refs/cas/reservations/${namespace}`;
}

function assertSameFormat(left, right) {
  ReservationLedgerSnapshot.assertOid(left);
  ReservationLedgerSnapshot.assertOid(right);
  if (left.length !== right.length) {
    throw new ReservationStorageError('Reservation ledger changed Git object format');
  }
}

function assertWrite({ before, header, indexRoot }) {
  if (!(header instanceof ReservationLedgerHeader) || (before !== null && !(before instanceof ReservationLedgerSnapshot))) {
    throw new InvalidOptionsError('Reservation ledger write requires a validated header and prior snapshot or null');
  }
  ReservationLedgerSnapshot.assertOid(indexRoot);
  if (before !== null) {
    assertSameFormat(before.revision, indexRoot);
    if (!before.header.policy.equals(header.policy)) {
      throw new ReservationStorageError('Reservation ledger update cannot replace its namespace policy');
    }
  }
}
