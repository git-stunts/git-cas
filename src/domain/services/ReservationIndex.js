import GitPersistencePort from '../../ports/GitPersistencePort.js';
import CryptoPort from '../../ports/CryptoPort.js';
import ReservationRecordCodecPort, { RESERVATION_RECORD_MAX_BYTES } from '../../ports/ReservationRecordCodecPort.js';
import InvalidOptionsError from '../errors/InvalidOptionsError.js';
import ReservationStorageError from '../errors/ReservationStorageError.js';
import Oid from '../value-objects/Oid.js';
import ReservationKey from '../value-objects/ReservationKey.js';
import ReservationRecord from './ReservationRecord.js';
import ReservationIndexNode from './ReservationIndexNode.js';
import ReservationScan from './ReservationScan.js';

const NODE_BYTES = 2 * 1024;

/**
 * Private immutable point index: a path-compressed hexadecimal trie over key
 * routes. Each record sits at the shortest route prefix it shares with no
 * other record, so a point read or update touches about log16(records) trees.
 * A 7.1.0 index, which placed every record at full depth, reads and updates
 * unchanged. It produces candidate trees, never publishes refs or admits
 * capacity; the ledger owner enforces lifecycle and binding. Reads validate
 * only the selected path, not every unvisited subtree.
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
    const { nodes, leaf } = await this.#walk(root, route);
    if (leaf === null) {
      return null;
    }
    const record = await this.#readRecord(leaf);
    if (record.key === identity.value) {
      return record;
    }
    await this.#resident(record, route.slice(0, nodes.length), route);
    return null;
  }

  async empty() {
    return checkedOid(await this.#persistence.writeTree([]));
  }

  async scan(root, request) {
    const scan = new ReservationScan(request);
    const complete = await this.#scanNode({ oid: checkedOid(root), type: 'tree' }, '', scan);
    if (!complete && scan.after === (request.cursor?.after ?? null)) {
      throw new ReservationStorageError('Reservation traversal made no progress within its budget');
    }
    return scan.finish(complete);
  }

  async #scanNode(entry, prefix, scan) {
    if (scan.skip(prefix)) {
      return true;
    }
    if (!scan.visit()) {
      return false;
    }
    if (entry.type === 'blob') {
      await this.#scanRecord(entry.oid, prefix, scan);
      return true;
    }
    const node = await this.#node(entry.oid, prefix.length);
    if (prefix.length > 0 && node.entries.length === 0) {
      throw new ReservationStorageError('Reservation index contains an empty internal branch');
    }
    for (const child of node.entries) {
      if (!await this.#scanNode(child, prefix + child.name, scan)) {
        return false;
      }
    }
    return true;
  }

  async #scanRecord(oid, prefix, scan) {
    const record = await this.#readRecord(oid);
    const route = await this.#placed(record, prefix);
    if (!scan.listed(route)) {
      scan.accept(record, route);
    }
  }

  async put(root, record) {
    if (!(record instanceof ReservationRecord)) {
      throw new InvalidOptionsError('Reservation index writes require a validated record');
    }
    const route = await new ReservationKey(record.key).route(this.#crypto);
    const { nodes, leaf } = await this.#walk(root, route);
    const depth = Math.max(nodes.length - 1, 0);
    const displaced = leaf === null ? null : await this.#displaced(leaf, { record, route, depth });
    const oid = await this.#writeRecord(record, root);
    let child = { oid, type: 'blob' };
    if (displaced !== null) {
      child = await this.#split({ route, depth, child, displaced });
    }
    for (let at = depth; at >= 0; at--) {
      const node = nodes[at] ?? this.#emptyNode(at, oid.length);
      child = { oid: await this.#writeNode(node.withChild(route[at], child)), type: 'tree' };
    }
    return child.oid;
  }

  /** Returns the other record a new key must share a subtree with, or null for an update. */
  async #displaced(leaf, { record, route, depth }) {
    const resident = await this.#readRecord(leaf);
    if (resident.key === record.key) {
      return null;
    }
    const residentRoute = await this.#resident(resident, route.slice(0, depth + 1), route);
    return { route: residentRoute, child: { oid: leaf, type: 'blob' } };
  }

  /** Pushes two records down to the first digit at which their routes part. */
  async #split({ route, depth, child, displaced }) {
    let fork = depth + 1;
    while (route[fork] === displaced.route[fork]) {
      fork++;
    }
    const oidLength = child.oid.length;
    const pair = this.#emptyNode(fork, oidLength)
      .withChild(route[fork], child)
      .withChild(displaced.route[fork], displaced.child);
    let subtree = { oid: await this.#writeNode(pair), type: 'tree' };
    for (let at = fork - 1; at > depth; at--) {
      const chain = this.#emptyNode(at, oidLength).withChild(route[at], subtree);
      subtree = { oid: await this.#writeNode(chain), type: 'tree' };
    }
    return subtree;
  }

  async #writeRecord(record, root) {
    const bytes = this.#codec.encode(record);
    if (!(bytes instanceof Uint8Array) || bytes.length > RESERVATION_RECORD_MAX_BYTES) {
      throw new ReservationStorageError('Encoded reservation record exceeds its byte limit');
    }
    const oid = checkedOid(await this.#persistence.writeBlob(bytes));
    assertFormat(record, oid.length);
    if (root !== null && root.length !== oid.length) {
      throw new ReservationStorageError('Reservation update changed Git object format');
    }
    return oid;
  }

  async #writeNode(node) {
    const oid = checkedOid(await this.#persistence.writeTree(node.toTreeLines()));
    if (oid.length !== node.oidLength) {
      throw new ReservationStorageError('Reservation tree writer changed Git object format');
    }
    return oid;
  }

  #emptyNode(depth, oidLength) {
    return new ReservationIndexNode({ entries: [], depth, oidLength });
  }

  /** Walks the route until it reaches an empty slot or a record blob. */
  async #walk(root, route) {
    const nodes = [];
    let entry = root === null ? null : { oid: checkedOid(root), type: 'tree' };
    while (entry !== null && entry.type === 'tree') {
      const node = await this.#node(entry.oid, nodes.length);
      entry = node.child(route[nodes.length]);
      nodes.push(node);
    }
    return { nodes, leaf: entry?.oid ?? null };
  }

  /**
   * Proves that a record found on another key's route belongs there: its own
   * route shares the walked prefix and differs from the sought route.
   */
  async #resident(record, prefix, route) {
    const residentRoute = await this.#placed(record, prefix);
    if (residentRoute === route) {
      throw new ReservationStorageError('Reservation route resolves to another key');
    }
    return residentRoute;
  }

  async #placed(record, prefix) {
    const route = await new ReservationKey(record.key).route(this.#crypto);
    if (!route.startsWith(prefix)) {
      throw new ReservationStorageError('Reservation record does not belong at its indexed route');
    }
    return route;
  }

  async #node(oid, depth) {
    await this.#assertObject(oid, { type: 'tree', maxBytes: NODE_BYTES });
    return new ReservationIndexNode({ entries: await this.#persistence.readTree(oid), depth, oidLength: oid.length });
  }

  async #readRecord(oid) {
    await this.#assertObject(oid, { type: 'blob', maxBytes: RESERVATION_RECORD_MAX_BYTES });
    const record = this.#codec.decode(await this.#persistence.readBlob(oid, RESERVATION_RECORD_MAX_BYTES));
    if (!(record instanceof ReservationRecord)) {
      throw new ReservationStorageError('Reservation route resolves to an invalid record');
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
