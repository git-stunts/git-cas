import { describe, expect, it, vi } from 'vitest';
import BoundedWriteWavePersistence from '../../../../src/domain/services/BoundedWriteWavePersistence.js';

function fixture(overrides = {}) {
  let sequence = 0;
  const persistence = {
    writeBlob: vi.fn(async () => `blob-${sequence++}`),
    writeBlobs: vi.fn(async (values) => values.map(() => `blob-${sequence++}`)),
    writeTree: vi.fn(async () => `tree-${sequence++}`),
    writeTrees: vi.fn(async (values) => values.map(() => `tree-${sequence++}`)),
    ...overrides,
  };
  const waves = new BoundedWriteWavePersistence({
    persistence,
    maxBatchObjects: 1_024,
    maxBatchBytes: 1024 * 1024,
  });
  return { persistence, waves };
}

function recordingWriter(kind, calls) {
  return vi.fn(async (values) => {
    calls.push(`${kind}:${values.length}`);
    return values.map((_, index) => `${kind.slice(0, -1)}-${index}`);
  });
}

describe('BoundedWriteWavePersistence scheduling', () => {
  it('coalesces same-kind arrivals while preserving dependency order', async () => {
    const calls = [];
    const { persistence, waves } = fixture({
      writeBlobs: recordingWriter('blobs', calls),
      writeTrees: recordingWriter('trees', calls),
    });

    const blobs = await Promise.all([
      waves.writeBlob(Uint8Array.of(1)),
      waves.writeBlob(Uint8Array.of(2)),
      waves.writeBlob(Uint8Array.of(3)),
    ]);
    const trees = await Promise.all([
      waves.writeTree([`100644 blob ${blobs[0]}\ta`]),
      waves.writeTree([`100644 blob ${blobs[1]}\tb`]),
    ]);

    expect(blobs).toEqual(['blob-0', 'blob-1', 'blob-2']);
    expect(trees).toEqual(['tree-0', 'tree-1']);
    expect(calls).toEqual(['blobs:3', 'trees:2']);
    expect(persistence.writeBlob).not.toHaveBeenCalled();
    expect(persistence.writeTree).not.toHaveBeenCalled();
  });

  it('splits protocol windows at 256 objects without reordering results', async () => {
    const { persistence, waves } = fixture();
    const writes = Array.from(
      { length: 257 },
      (_, index) => waves.writeBlob(Uint8Array.of(index % 256)),
    );

    const oids = await Promise.all(writes);

    expect(oids).toEqual(Array.from({ length: 257 }, (_, index) => `blob-${index}`));
    expect(persistence.writeBlobs).toHaveBeenCalledOnce();
    expect(persistence.writeBlobs.mock.calls[0][0]).toHaveLength(256);
    expect(persistence.writeBlob).toHaveBeenCalledOnce();
  });
});

describe('BoundedWriteWavePersistence failures', () => {
  it('fails the whole admitted wave before persistence on aggregate overflow', async () => {
    const { persistence } = fixture();
    const waves = new BoundedWriteWavePersistence({
      persistence,
      maxBatchObjects: 1,
      maxBatchBytes: 1024,
    });

    const settled = await Promise.allSettled([
      waves.writeBlob(Uint8Array.of(1)),
      waves.writeBlob(Uint8Array.of(2)),
    ]);

    expect(settled.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(settled[0].reason).toBe(settled[1].reason);
    expect(settled[0].reason).toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(persistence.writeBlob).not.toHaveBeenCalled();
    expect(persistence.writeBlobs).not.toHaveBeenCalled();
    expect(waves.snapshot()).toEqual({ writeObjects: 1, writeBytes: 1, failed: true });
  });

  it('shares a protocol failure with queued and future writes', async () => {
    const failure = new Error('batch protocol failed');
    const { persistence, waves } = fixture({
      writeBlobs: vi.fn(async () => { throw failure; }),
    });

    const first = await Promise.allSettled([
      waves.writeBlob(Uint8Array.of(1)),
      waves.writeBlob(Uint8Array.of(2)),
    ]);
    const later = await waves.writeBlob(Uint8Array.of(3)).catch((error) => error);

    expect(first.map((result) => result.reason)).toEqual([failure, failure]);
    expect(later).toBe(failure);
    expect(persistence.writeBlobs).toHaveBeenCalledOnce();
  });
});
