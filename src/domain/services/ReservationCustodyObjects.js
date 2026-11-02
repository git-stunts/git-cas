import GitPersistencePort from '../../ports/GitPersistencePort.js';
import GitRefPort from '../../ports/GitRefPort.js';
import ReservationCustodyCodecPort, { RESERVATION_CUSTODY_MAX_BYTES } from '../../ports/ReservationCustodyCodecPort.js';
import ReservationEvidence, { RESERVATION_PAGE_MAX_BYTES } from '../value-objects/ReservationEvidence.js';
import ReservationCustodyDescriptor from '../value-objects/ReservationCustodyDescriptor.js';
import ReservationCustodySnapshot from '../value-objects/ReservationCustodySnapshot.js';
import ReservationRecord from './ReservationRecord.js';
import CollectionNamespace from '../value-objects/CollectionNamespace.js';
import Oid from '../value-objects/Oid.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';

const COMMIT_MAX_BYTES = 16 * 1024;
const ROOT_MAX_BYTES = 2 * 1024;
const SUPPORT_TREE_MAX_BYTES = 8 * 1024;

/** Bounded immutable custody objects. This class never creates or deletes refs. */
export default class ReservationCustodyObjects {
  #persistence;
  #refs;
  #codec;

  constructor({ namespace, persistence, refs, codec }) {
    if (!(persistence instanceof GitPersistencePort) || !(refs instanceof GitRefPort) ||
        !(codec instanceof ReservationCustodyCodecPort)) {
      throw new InvalidOptionsError('Custody objects require persistence, ref and descriptor codec ports');
    }
    this.namespace = CollectionNamespace.from(namespace).toString();
    this.#persistence = persistence;
    this.#refs = refs;
    this.#codec = codec;
    Object.freeze(this);
  }

  async describe({ attempt, evidence, preparation = null }) {
    if (!(attempt instanceof ReservationRecord) || !(evidence instanceof ReservationEvidence)) {
      throw new InvalidOptionsError('Custody description requires an attempt and validated evidence');
    }
    await this.#assertRoots(evidence.roots);
    const recordOid = await this.#persistence.writeBlob(evidence.record);
    return new ReservationCustodyDescriptor({
      namespace: this.namespace, key: attempt.key, binding: attempt.binding,
      stage: preparation === null ? 'preparation' : 'settlement', preparation,
      recordOid, roots: evidence.roots,
    });
  }

  async write(descriptor) {
    this.#assertDescriptor(descriptor);
    await this.#assertPayload(descriptor);
    const bytes = this.#codec.encode(descriptor);
    if (!(bytes instanceof Uint8Array) || bytes.length > RESERVATION_CUSTODY_MAX_BYTES) {
      throw new ReservationStorageError('Encoded custody descriptor exceeds its bound');
    }
    const metadata = await this.#persistence.writeBlob(bytes);
    const support = await this.#persistence.writeTree(descriptor.roots.toTreeLines());
    const treeOid = await this.#persistence.writeTree([
      `100644 blob ${metadata}\tdescriptor`, `100644 blob ${descriptor.recordOid}\trecord`, `040000 tree ${support}\tsupport`,
    ]);
    for (const oid of [metadata, support, treeOid]) {
      assertSameFormat(oid, descriptor.recordOid);
    }
    const revision = await this.#refs.createCommit({
      treeOid, parentOids: descriptor.parents, message: `git-cas reservation ${descriptor.stage} v1`,
    });
    return new ReservationCustodySnapshot({ descriptor, revision });
  }

  async read(revision) {
    await this.#assertObject(revision, { type: 'commit', maxBytes: COMMIT_MAX_BYTES });
    const root = await this.#refs.resolveTree(revision);
    assertSameFormat(root, revision);
    await this.#assertObject(root, { type: 'tree', maxBytes: ROOT_MAX_BYTES });
    const entries = await this.#persistence.readTree(root);
    const { metadata, record, support } = rootEntries(entries, revision);
    await this.#assertObject(metadata, { type: 'blob', maxBytes: RESERVATION_CUSTODY_MAX_BYTES });
    const descriptor = this.#codec.decode(await this.#persistence.readBlob(metadata, RESERVATION_CUSTODY_MAX_BYTES));
    this.#assertDescriptor(descriptor);
    if (descriptor.recordOid !== record) {
      throw new ReservationStorageError('Custody record edge disagrees with its descriptor');
    }
    const parents = await this.#refs.resolveParents(revision);
    assertParents(parents, descriptor.parents);
    await this.#assertObject(support, { type: 'tree', maxBytes: SUPPORT_TREE_MAX_BYTES });
    descriptor.roots.assertTree(await this.#persistence.readTree(support));
    await this.#assertPayload(descriptor);
    return new ReservationCustodySnapshot({ descriptor, revision });
  }

  async readEvidence(revision) {
    const { descriptor } = await this.read(revision);
    return new ReservationEvidence({
      record: await this.#persistence.readBlob(descriptor.recordOid, RESERVATION_PAGE_MAX_BYTES),
      supports: descriptor.roots.supports, parents: descriptor.roots.parents,
    });
  }

  #assertDescriptor(descriptor) {
    if (!(descriptor instanceof ReservationCustodyDescriptor) || descriptor.namespace !== this.namespace) {
      throw new ReservationStorageError('Custody descriptor does not belong to this namespace');
    }
  }

  async #assertPayload(descriptor) {
    await this.#assertObject(descriptor.recordOid, { type: 'blob', maxBytes: RESERVATION_PAGE_MAX_BYTES });
    await this.#assertRoots(descriptor.roots);
    if (descriptor.preparation !== null) {
      await this.#assertObject(descriptor.preparation, { type: 'commit', maxBytes: COMMIT_MAX_BYTES });
    }
  }

  async #assertRoots(roots) {
    for (const item of roots.supports) {
      await this.#assertObject(item.oid, { type: item.type, maxBytes: Number.MAX_SAFE_INTEGER });
    }
    for (const parent of roots.parents) {
      await this.#assertObject(parent, { type: 'commit', maxBytes: Number.MAX_SAFE_INTEGER });
    }
  }

  async #assertObject(oid, { type, maxBytes }) {
    assertOid(oid);
    const [actualType, size] = await Promise.all([
      this.#persistence.readObjectType(oid), this.#persistence.readObjectSize(oid),
    ]);
    if (actualType !== type || !Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      throw new ReservationStorageError('Custody object type or byte bound is invalid', { oid, type, size });
    }
  }
}

function rootEntries(entries, revision) {
  if (!Array.isArray(entries) || entries.length !== 3) {
    throw new ReservationStorageError('Custody root must have exactly three entries');
  }
  const metadata = rootEntry(entries, { name: 'descriptor', type: 'blob', mode: '100644' });
  const record = rootEntry(entries, { name: 'record', type: 'blob', mode: '100644' });
  const support = rootEntry(entries, { name: 'support', type: 'tree', mode: '040000' });
  for (const oid of [metadata, record, support]) {
    assertSameFormat(oid, revision);
  }
  return { metadata, record, support };
}

function rootEntry(entries, { name, type, mode }) {
  const entry = entries.find((item) => item.name === name);
  if (!entry || entry.type !== type || entry.mode !== mode) {
    throw new ReservationStorageError('Custody root entry is invalid', { name });
  }
  return entry.oid;
}

function assertParents(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((oid, i) => oid !== expected[i])) {
    throw new ReservationStorageError('Custody commit parents disagree with its descriptor');
  }
}

function assertSameFormat(left, right) {
  assertOid(left);
  assertOid(right);
  if (left.length !== right.length) {
    throw new ReservationStorageError('Custody changed Git object format');
  }
}

function assertOid(value) {
  if (!Oid.isValid(value) || value !== value.toLowerCase()) {
    throw new ReservationStorageError('Custody requires canonical Git OIDs');
  }
}
