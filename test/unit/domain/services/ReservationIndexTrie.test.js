import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import ReservationIndex from '../../../../src/domain/services/ReservationIndex.js';
import ReservationIndexNode from '../../../../src/domain/services/ReservationIndexNode.js';
import ReservationRecord from '../../../../src/domain/services/ReservationRecord.js';
import ReservationRecordCodec from '../../../../src/infrastructure/codecs/ReservationRecordCodec.js';
import ReservationListRequest from '../../../../src/domain/value-objects/ReservationListRequest.js';
import CryptoPort from '../../../../src/ports/CryptoPort.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';

const ROUTE_DOMAIN = 'git-cas/reservation-key/v1\0';

/** Routes listed keys to chosen digests and every other key through SHA-256. */
class ChosenRouteCrypto extends CryptoPort {
  #routes;

  constructor(routes = {}) {
    super();
    this.#routes = new Map(Object.entries(routes));
  }

  async sha256(bytes) {
    const key = Buffer.from(bytes).toString('utf8').slice(ROUTE_DOMAIN.length);
    return this.#routes.get(key) ?? createHash('sha256').update(bytes).digest('hex');
  }
}

function fixture(routes) {
  const persistence = new MemoryPersistenceAdapter();
  const codec = new ReservationRecordCodec();
  const index = new ReservationIndex({ persistence, codec, crypto: new ChosenRouteCrypto(routes) });
  return { persistence, codec, index };
}

function reserved(key) {
  return new ReservationRecord({ key, binding: 'a'.repeat(64), phase: 'reserved' });
}

/** Returns the digit path from root to each record blob. */
async function placements(persistence, oid, prefix = '') {
  const found = {};
  for (const entry of await persistence.readTree(oid)) {
    if (entry.type === 'blob') {
      found[prefix + entry.name] = entry.oid;
    } else {
      Object.assign(found, await placements(persistence, entry.oid, prefix + entry.name));
    }
  }
  return found;
}

/** Writes one record the way 7.1.0 did: a single-child tree per route digit. */
async function legacyRoot({ persistence, codec }, record, route) {
  let oid = await persistence.writeBlob(codec.encode(record));
  for (let depth = 63; depth >= 0; depth--) {
    const type = depth === 63 ? 'blob' : 'tree';
    const mode = type === 'blob' ? '100644' : '040000';
    oid = await persistence.writeTree([`${mode} ${type} ${oid}\t${route[depth]}`]);
  }
  return oid;
}

const corrupt = expect.objectContaining({ code: 'RESERVATION_CORRUPT' });
const route = (head, fill = '0') => head + fill.repeat(64 - head.length);

describe('ReservationIndex places each record at its shortest unshared prefix', () => {
  it('keeps a lone record at the root and pushes records down only as far as they share digits', async () => {
    const f = fixture({ one: route('ab0'), two: route('ab1'), three: route('a7'), four: route('c') });
    let root = await f.index.put(null, reserved('one'));
    expect(Object.keys(await placements(f.persistence, root))).toEqual(['a']);
    root = await f.index.put(root, reserved('two'));
    expect(Object.keys(await placements(f.persistence, root))).toEqual(['ab0', 'ab1']);
    root = await f.index.put(root, reserved('three'));
    root = await f.index.put(root, reserved('four'));
    expect(Object.keys(await placements(f.persistence, root)).sort()).toEqual(['a7', 'ab0', 'ab1', 'c']);
    for (const key of ['one', 'two', 'three', 'four']) {
      expect((await f.index.get(root, key)).key).toBe(key);
    }
    expect(await f.index.get(root, 'absent')).toBeNull();
  });

  it('splits two records that share all but the final digit', async () => {
    const f = fixture({ one: route('', '5'), two: route('5'.repeat(63), '6') });
    const root = await f.index.put(await f.index.put(null, reserved('one')), reserved('two'));
    expect(Object.keys(await placements(f.persistence, root)).sort()).toEqual([route('', '5'), route('5'.repeat(63), '6')]);
    expect((await f.index.get(root, 'two')).key).toBe('two');
  });

  it('writes a record and one tree per level, not one tree per route digit', async () => {
    const f = fixture();
    let root = null;
    for (let n = 0; n < 400; n++) {
      root = await f.index.put(root, reserved(`attempt-${n}`));
    }
    const writeTree = vi.spyOn(f.persistence, 'writeTree');
    const writeBlob = vi.spyOn(f.persistence, 'writeBlob');
    await f.index.put(root, reserved('attempt-400'));
    expect(writeBlob).toHaveBeenCalledTimes(1);
    expect(writeTree.mock.calls.length).toBeLessThanOrEqual(5);
  });
});

describe('ReservationIndex reads and extends a 7.1.0 full-depth index', () => {
  it('finds, updates and lists beside a record stored at full depth', async () => {
    const legacy = route('3', '9');
    const f = fixture({ old: legacy, near: route('3', '1'), far: route('e') });
    let root = await legacyRoot(f, reserved('old'), legacy);
    expect((await f.index.get(root, 'old')).phase).toBe('reserved');
    expect(await f.index.get(root, 'near')).toBeNull();
    root = await f.index.put(root, reserved('old').cancel());
    expect((await f.index.get(root, 'old')).charge).toBe(0);
    root = await f.index.put(root, reserved('near'));
    root = await f.index.put(root, reserved('far'));
    expect(Object.keys(await placements(f.persistence, root)).sort()).toEqual(['31', legacy, 'e']);
    const scan = await f.index.scan(root, new ReservationListRequest('ns'));
    expect(scan.records.map((record) => record.key)).toEqual(['near', 'old', 'far']);
  });
});

describe('ReservationIndex refuses a record stored off its route', () => {
  it('rejects a record whose own route does not share the prefix it sits at', async () => {
    const f = fixture({ stray: route('f'), sought: route('0') });
    const blob = await f.persistence.writeBlob(f.codec.encode(reserved('stray')));
    const root = await f.persistence.writeTree([`100644 blob ${blob}\t0`]);
    await expect(f.index.get(root, 'sought')).rejects.toThrowError(corrupt);
    await expect(f.index.put(root, reserved('sought'))).rejects.toThrowError(corrupt);
    await expect(f.index.scan(root, new ReservationListRequest('ns'))).rejects.toThrowError(corrupt);
  });

  it('rejects a subtree at the final route digit', () => {
    const entries = [{ name: '0', mode: '040000', type: 'tree', oid: 'a'.repeat(40) }];
    expect(() => new ReservationIndexNode({ entries, depth: 63, oidLength: 40 })).toThrowError(corrupt);
    expect(new ReservationIndexNode({ entries, depth: 62, oidLength: 40 }).child('0').type).toBe('tree');
  });
});

describe('ReservationIndex pages compressed records in route order', () => {
  it('resumes after a record that sits above full depth without repeating it', async () => {
    const f = fixture();
    let root = null;
    for (let n = 0; n < 40; n++) {
      root = await f.index.put(root, reserved(`page-${n}`));
    }
    const routes = [];
    let cursor = null;
    for (let page = 0; page < 20; page++) {
      const scan = await f.index.scan(root, new ReservationListRequest('ns', { limit: 7, cursor }));
      const crypto = new ChosenRouteCrypto();
      for (const record of scan.records) {
        routes.push(await crypto.sha256(Buffer.from(ROUTE_DOMAIN + record.key)));
      }
      if (scan.complete) {
        break;
      }
      cursor = { namespace: 'ns', revision: root, after: scan.after };
    }
    expect(routes).toHaveLength(40);
    expect(routes).toEqual([...routes].sort());
  });
});
