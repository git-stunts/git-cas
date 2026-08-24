import { describe, expect, it, vi } from 'vitest';
import BundleService from '../../../../src/domain/services/BundleService.js';
import PageService from '../../../../src/domain/services/PageService.js';
import parseApplicationHandle from '../../../../src/domain/value-objects/ApplicationHandle.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';

const CLOCK = Object.freeze({ now: () => new Date('2026-08-23T12:00:00.000Z') });

function fixture() {
  const persistence = new MemoryPersistenceAdapter();
  const pages = new PageService({ persistence, maxPageSize: 4096, clock: CLOCK });
  const services = {};
  const resolveHandle = async (value, context) => {
    const handle = parseApplicationHandle(value);
    return handle.kind === 'page'
      ? await pages.resolveRoot(handle)
      : await services.bundles.resolveRoot(handle, context);
  };
  services.bundles = new BundleService({
    persistence,
    codec: new JsonCodec(),
    pages,
    resolveHandle,
    openHandle: (handle) => pages.open({ handle }),
    limits: { maxFanoutEntries: 4, maxFanoutDepth: 5 },
    clock: CLOCK,
  });
  return { bundles: services.bundles, persistence };
}

function requests() {
  return [
    {
      members: [
        ['a', Buffer.from('a')],
        ['b', Buffer.from('b')],
      ],
    },
    {
      members: Array.from({ length: 17 }, (_, index) => [
        `member-${String(index).padStart(2, '0')}`,
        Buffer.from([index]),
      ]),
    },
    { members: [] },
  ];
}

const BATCH_LIMITS = Object.freeze({
  maxBatchBundles: 8,
  maxBatchMembers: 64,
  maxBatchObjects: 128,
  maxBatchBytes: 1024 * 1024,
});

describe('BundleService ordered batches', () => {
  it('preserves every single-build handle while writing dependency waves', async () => {
    const { bundles, persistence } = fixture();
    const input = requests();
    const singles = [];
    for (const request of input) {
      singles.push(await bundles.putOrdered(request));
    }
    const writeBlobs = vi.spyOn(persistence, 'writeBlobs');
    const writeTrees = vi.spyOn(persistence, 'writeTrees');

    const batch = await bundles.putOrderedBatch({ bundles: input, ...BATCH_LIMITS });

    expect(batch.map((staged) => staged.handle.toString())).toEqual(
      singles.map((staged) => staged.handle.toString())
    );
    expect(batch.map((staged) => staged.bundle)).toEqual(singles.map((staged) => staged.bundle));
    expect(writeBlobs).toHaveBeenCalledTimes(2);
    expect(writeBlobs.mock.calls[0][0]).toHaveLength(19);
    expect(writeTrees.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const staged of batch) {
      await expect(bundles.resolveRoot(staged.handle)).resolves.toMatchObject({
        memberCount: staged.bundle.memberCount,
        indexDepth: staged.bundle.indexDepth,
      });
    }
  });

  it('returns an empty immutable result without writing', async () => {
    const { bundles, persistence } = fixture();
    const writeBlob = vi.spyOn(persistence, 'writeBlob');
    const writeTree = vi.spyOn(persistence, 'writeTree');

    const result = await bundles.putOrderedBatch({ bundles: [], ...BATCH_LIMITS });

    expect(result).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(writeBlob).not.toHaveBeenCalled();
    expect(writeTree).not.toHaveBeenCalled();
  });
});

describe('BundleService ordered batch admission', () => {
  it('rejects aggregate members before creating any object', async () => {
    const { bundles, persistence } = fixture();
    const writeBlob = vi.spyOn(persistence, 'writeBlob');
    const writeTree = vi.spyOn(persistence, 'writeTree');

    await expect(
      bundles.putOrderedBatch({
        bundles: requests(),
        ...BATCH_LIMITS,
        maxBatchMembers: 10,
      })
    ).rejects.toMatchObject({ code: 'BUNDLE_MEMBER_LIMIT' });

    expect(writeBlob).not.toHaveBeenCalled();
    expect(writeTree).not.toHaveBeenCalled();
  });

  it('requires an explicitly bounded array of bundle requests', async () => {
    const { bundles } = fixture();

    await expect(
      bundles.putOrderedBatch({
        bundles: requests(),
        ...BATCH_LIMITS,
        maxBatchBundles: 2,
      })
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    await expect(
      bundles.putOrderedBatch({ bundles: new Set(), ...BATCH_LIMITS })
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
  });
});

describe('BundleService ordered batch failure containment', () => {
  it('rejects the whole result with bounded staging evidence after a tree-wave failure', async () => {
    const { bundles, persistence } = fixture();
    const protocolFailure = new Error('tree wave failed');
    vi.spyOn(persistence, 'writeTrees').mockRejectedValueOnce(protocolFailure);

    const failure = await bundles
      .putOrderedBatch({
        bundles: requests(),
        ...BATCH_LIMITS,
      })
      .catch((error) => error);

    expect(failure).toBe(protocolFailure);
    expect(failure.meta.staging).toMatchObject({
      objectCount: expect.any(Number),
      stagedHandleCount: 19,
      objectSample: expect.any(Array),
      stagedHandleSample: expect.any(Array),
      sampleTruncated: true,
    });
    expect(failure.meta.staging.objectCount).toBeGreaterThan(19);
  });
});
