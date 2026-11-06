import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import ReservationIndex from '../../../../src/domain/services/ReservationIndex.js';
import ReservationRecord from '../../../../src/domain/services/ReservationRecord.js';
import ReservationRecordCodec from '../../../../src/infrastructure/codecs/ReservationRecordCodec.js';
import CryptoPort from '../../../../src/ports/CryptoPort.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';

class RouteCrypto extends CryptoPort {
  async sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
  }
}

function fixture(crypto = new RouteCrypto()) {
  const persistence = new MemoryPersistenceAdapter();
  const codec = new ReservationRecordCodec();
  return { persistence, codec, index: new ReservationIndex({ persistence, codec, crypto }) };
}

function reserved(key) {
  return new ReservationRecord({ key, binding: 'a'.repeat(64), phase: 'reserved' });
}

const corrupt = expect.objectContaining({ code: 'RESERVATION_CORRUPT' });

describe('ReservationIndex immutable snapshots', () => {
  it('keeps earlier roots and independent attempts intact when a record changes', async () => {
    const { index } = fixture();
    const first = await index.put(null, reserved('first'));
    const second = await index.put(first, reserved('second'));
    const third = await index.put(second, reserved('first').cancel());
    expect(await index.get(null, 'first')).toBeNull();
    expect(await index.get(first, 'second')).toBeNull();
    expect((await index.get(first, 'first')).phase).toBe('reserved');
    expect((await index.get(second, 'first')).phase).toBe('reserved');
    expect((await index.get(third, 'first')).charge).toBe(0);
    expect((await index.get(third, 'second')).key).toBe('second');
    expect(await index.put(third, reserved('first').cancel())).toBe(third);
  });

  it('constructs the same tree for either insertion order', async () => {
    const { index } = fixture();
    const a = await index.put(await index.put(null, reserved('a')), reserved('b'));
    const b = await index.put(await index.put(null, reserved('b')), reserved('a'));
    expect(a).toBe(b);
  });
});

describe('ReservationIndex path-local work', () => {
  it.each([1, 129])('bounds point lookup/update independently of %i retained attempts', async (count) => {
    const { index, persistence } = fixture();
    let root = null;
    for (let n = 0; n < count; n++) {
      root = await index.put(root, reserved(`attempt-${n}`));
    }
    const readTree = vi.spyOn(persistence, 'readTree');
    const readBlob = vi.spyOn(persistence, 'readBlob');
    const writeTree = vi.spyOn(persistence, 'writeTree');
    const record = await index.get(root, 'attempt-0');
    const depth = readTree.mock.calls.length;
    expect(depth).toBeLessThanOrEqual(count === 1 ? 1 : 4);
    expect(readBlob).toHaveBeenCalledTimes(1);
    expect(readBlob.mock.calls[0][1]).toBe(16 * 1024);
    readTree.mockClear(); readBlob.mockClear();
    await index.put(root, record.cancel());
    expect(readTree).toHaveBeenCalledTimes(depth);
    expect(readBlob).toHaveBeenCalledTimes(1);
    expect(writeTree).toHaveBeenCalledTimes(depth);
  });

  it('does not read an unrelated missing subtree to answer a point lookup', async () => {
    const { index, persistence } = fixture();
    const root = await index.put(null, reserved('first'));
    const [entry] = await persistence.readTree(root);
    const name = entry.name === 'f' ? '0' : 'f';
    const lines = [`${entry.mode} ${entry.type} ${entry.oid}\t${entry.name}`,
      `040000 tree ${'b'.repeat(40)}\t${name}`].sort((a, b) => a.slice(-1).localeCompare(b.slice(-1)));
    const withUnvisitedSubtree = await persistence.writeTree(lines);
    expect((await index.get(withUnvisitedSubtree, 'first')).key).toBe('first');
  });
});

describe('ReservationIndex refuses ambiguous identity', () => {
  it('rejects hash collisions instead of returning or replacing another key', async () => {
    const crypto = new RouteCrypto();
    vi.spyOn(crypto, 'sha256').mockResolvedValue('0'.repeat(64));
    const { index, persistence } = fixture(crypto);
    const root = await index.put(null, reserved('original'));
    const writes = vi.spyOn(persistence, 'writeBlob');
    await expect(index.get(root, 'collision')).rejects.toThrowError(corrupt);
    await expect(index.put(root, reserved('collision'))).rejects.toThrowError(corrupt);
    expect(writes).not.toHaveBeenCalled();
    expect((await index.get(root, 'original')).key).toBe('original');
  });

  it.each(['', '../bad key', 'x'.repeat(129)])('rejects invalid key %s before I/O', async (key) => {
    const { index, persistence } = fixture();
    const reads = vi.spyOn(persistence, 'readTree');
    await expect(index.get(null, key)).rejects.toThrowError();
    expect(reads).not.toHaveBeenCalled();
  });

  it('rejects invalid root, port digest and non-record write input', async () => {
    const crypto = new RouteCrypto();
    const { index } = fixture(crypto);
    await expect(index.get('BAD', 'key')).rejects.toThrowError();
    await expect(index.put(null, {})).rejects.toThrowError();
    vi.spyOn(crypto, 'sha256').mockResolvedValue('B'.repeat(64));
    await expect(index.get(null, 'key')).rejects.toThrowError();
  });
});

describe('ReservationIndex object read bounds', () => {
  it('checks tree metadata before asking the adapter to materialize entries', async () => {
    const { index, persistence } = fixture();
    const root = await index.put(null, reserved('key'));
    vi.spyOn(persistence, 'readObjectSize').mockResolvedValue(2049);
    const read = vi.spyOn(persistence, 'readTree');
    await expect(index.get(root, 'key')).rejects.toThrowError(corrupt);
    expect(read).not.toHaveBeenCalled();
  });

  it('checks leaf metadata and passes a hard bound before reading a record', async () => {
    const { index, persistence } = fixture();
    const root = await index.put(null, reserved('key'));
    const original = persistence.readObjectSize.bind(persistence);
    vi.spyOn(persistence, 'readObjectSize').mockImplementation(async (oid) =>
      await persistence.readObjectType(oid) === 'blob' ? 16385 : await original(oid));
    const read = vi.spyOn(persistence, 'readBlob');
    await expect(index.get(root, 'key')).rejects.toThrowError(corrupt);
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a blob where the root must be a tree', async () => {
    const { index, persistence } = fixture();
    const oid = await persistence.writeBlob(new Uint8Array([1]));
    await expect(index.get(oid, 'key')).rejects.toThrowError(corrupt);
  });
});

describe('ReservationIndex corrupt node refusal', () => {
  it.each([
    [`040000 blob ${'a'.repeat(40)}\t0`],
    [`100644 tree ${'a'.repeat(40)}\t0`],
    [`100644 commit ${'a'.repeat(40)}\t0`],
    [`040000 tree ${'a'.repeat(40)}\twrong`],
    [`040000 tree ${'A'.repeat(40)}\t0`],
    [`040000 tree ${'a'.repeat(64)}\t0`],
    [`040000 tree ${'a'.repeat(40)}\t0`, `040000 tree ${'b'.repeat(40)}\t0`],
    [`040000 tree ${'a'.repeat(40)}\tf`, `040000 tree ${'b'.repeat(40)}\t0`],
  ])('rejects malformed root entries %#', async (...lines) => {
    const { index, persistence } = fixture();
    const root = await persistence.writeTree(lines);
    await expect(index.get(root, 'key')).rejects.toThrowError(corrupt);
  });

  it('refuses oversized adapter entry output even when metadata lied', async () => {
    const { index, persistence } = fixture();
    const root = await index.put(null, reserved('key'));
    const [entry] = await persistence.readTree(root);
    vi.spyOn(persistence, 'readTree').mockResolvedValue(Array(17).fill(entry));
    await expect(index.get(root, 'key')).rejects.toThrowError(corrupt);
  });
});

describe('ReservationIndex runtime entry validation', () => {
  it('rejects numeric names instead of turning corrupt evidence into absence', async () => {
    const crypto = new RouteCrypto();
    vi.spyOn(crypto, 'sha256').mockResolvedValue('0'.repeat(64));
    const { index, persistence } = fixture(crypto);
    const root = await index.put(null, reserved('key'));
    const [entry] = await persistence.readTree(root);
    vi.spyOn(persistence, 'readTree').mockResolvedValue([{ ...entry, name: 0 }]);
    await expect(index.get(root, 'key')).rejects.toThrowError(corrupt);
  });
});
