import GitPersistencePort from '../../ports/GitPersistencePort.js';
import CryptoPort from '../../ports/CryptoPort.js';
import ReservationRecordCodecPort, { RESERVATION_RECORD_MAX_BYTES } from '../../ports/ReservationRecordCodecPort.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';
import Oid from '../value-objects/Oid.js';
import ReservationKey, { RESERVATION_ROUTE_DIGITS } from '../value-objects/ReservationKey.js';
import ReservationRecord from './ReservationRecord.js';
import ReservationIndexNode from './ReservationIndexNode.js';

const NODE_BYTES = 2 * 1024;

/**
 * Private immutable point index. It produces candidate trees, never publishes
 * refs or admits capacity. The ledger owner enforces lifecycle and binding.
 * Reads validate only the selected path, not every unvisited subtree.
 */
export default class ReservationIndex {
  #persistence;
  #codec;
  #crypto;

  constructor({ persistence, codec, crypto }) {
    if (!(persistence instanceof GitPersistencePort) || !(codec instanceof ReservationRecordCodecPort) ||
        !(crypto instanceof CryptoPort)) {
      throw new InvalidOptionsError('Reservation index requires persistence, record codec and crypto ports');
    }
    this.#persistence = persistence;
    this.#codec = codec;
    this.#crypto = crypto;
    Object.freeze(this);
  }

  async get(root, key) {
    const identity = new ReservationKey(key);
    const route = await identity.route(this.#crypto);
    const { leaf } = await this.#walk(root, route);
    return leaf === null ? null : await this.#record(leaf, identity.value);
  }

  async put(root, record) {
    if (!(record instanceof ReservationRecord)) {
      throw new InvalidOptionsError('Reservation index writes require a validated record');
    }
    const route = await new ReservationKey(record.key).route(this.#crypto);
    const { nodes, leaf } = await this.#walk(root, route);
    if (leaf !== null) {
      await this.#record(leaf, record.key);
    }
    const bytes = this.#codec.encode(record);
    if (!(bytes instanceof Uint8Array) || bytes.length > RESERVATION_RECORD_MAX_BYTES) {
      throw new ReservationStorageError('Encoded reservation record exceeds its byte limit');
    }
    let oid = checkedOid(await this.#persistence.writeBlob(bytes));
    assertFormat(record, oid.length);
    if (root !== null && root.length !== oid.length) {
      throw new ReservationStorageError('Reservation update changed Git object format');
    }
    for (let depth = RESERVATION_ROUTE_DIGITS - 1; depth >= 0; depth--) {
      const node = nodes[depth] ?? new ReservationIndexNode({ entries: [], depth, oidLength: oid.length });
      const updated = node.withChild(route[depth], oid);
      const next = checkedOid(await this.#persistence.writeTree(updated.toTreeLines()));
      if (next.length !== oid.length) {
        throw new ReservationStorageError('Reservation tree writer changed Git object format');
      }
      oid = next;
    }
    return oid;
  }

  async #walk(root, route) {
    let oid = root === null ? null : checkedOid(root);
    const nodes = [];
    for (let depth = 0; depth < RESERVATION_ROUTE_DIGITS && oid !== null; depth++) {
      await this.#assertObject(oid, { type: 'tree', maxBytes: NODE_BYTES });
      const node = new ReservationIndexNode({
        entries: await this.#persistence.readTree(oid), depth, oidLength: oid.length,
      });
      nodes.push(node);
      oid = node.child(route[depth]);
    }
    return { nodes, leaf: nodes.length === RESERVATION_ROUTE_DIGITS ? oid : null };
  }

  async #record(oid, key) {
    await this.#assertObject(oid, { type: 'blob', maxBytes: RESERVATION_RECORD_MAX_BYTES });
    const record = this.#codec.decode(await this.#persistence.readBlob(oid, RESERVATION_RECORD_MAX_BYTES));
    if (!(record instanceof ReservationRecord) || record.key !== key) {
      throw new ReservationStorageError('Reservation route resolves to another key or invalid record');
    }
    assertFormat(record, oid.length);
    return record;
  }

  async #assertObject(oid, { type, maxBytes }) {
    const [actualType, size] = await Promise.all([
      this.#persistence.readObjectType(oid), this.#persistence.readObjectSize(oid),
    ]);
    if (actualType !== type || !Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      throw new ReservationStorageError('Reservation object type or byte bound is invalid', { oid, type, size });
    }
  }
}

function checkedOid(value) {
  if (!Oid.isValid(value) || Oid.from(value).toString() !== value) {
    throw new ReservationStorageError('Reservation index requires a canonical Git OID');
  }
  return value;
}

function assertFormat(record, oidLength) {
  for (const oid of [record.preparation, record.settlement]) {
    if (oid !== null && oid.length !== oidLength) {
      throw new ReservationStorageError('Reservation evidence and index use different Git object formats');
    }
  }
}
