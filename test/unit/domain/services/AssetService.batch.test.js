import { describe, expect, it, vi } from 'vitest';
import AssetService from '../../../../src/domain/services/AssetService.js';
import CasService from '../../../../src/domain/services/CasService.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';

const CRYPTO = await getTestCryptoAdapter();
const CLOCK = Object.freeze({ now: () => new Date('2026-08-23T12:00:00.000Z') });
const LIMITS = Object.freeze({
  maxBatchAssets: 4,
  maxBatchObjects: 128,
  maxBatchBytes: 1024 * 1024,
});

function fixture() {
  const persistence = new MemoryPersistenceAdapter();
  const cas = new CasService({
    persistence,
    crypto: CRYPTO,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunkSize: 1024,
    merkleThreshold: 2,
    concurrency: 1,
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
  return {
    assets: new AssetService({ cas, clock: CLOCK }),
    persistence,
  };
}

async function* source(bytes) {
  yield bytes;
}

function requests() {
  return Array.from({ length: 4 }, (_, index) => ({
    source: source(Buffer.alloc(2048 + index, index + 1)),
    slug: `asset-${index}`,
    filename: `asset-${index}.bin`,
  }));
}

function trackedSource(index, activity) {
  return (async function* generate() {
    activity.active += 1;
    activity.maximum = Math.max(activity.maximum, activity.active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    yield Buffer.from([index]);
    activity.active -= 1;
  })();
}

function trackedRequests(count, activity) {
  const inputs = [];
  for (let index = 0; index < count; index += 1) {
    inputs.push({ source: trackedSource(index, activity), slug: `ordered-${index}` });
  }
  return inputs;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function failedSource(started, failure) {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          await started.promise;
          throw failure;
        },
      };
    },
  };
}

async function* siblingSource(started, closed, progress) {
  try {
    started.resolve();
    for (let index = 0; index < 32; index += 1) {
      progress.chunks += 1;
      yield Buffer.alloc(1024, index);
      await Promise.resolve();
    }
  } finally {
    closed();
  }
}

async function* laterSource(started) {
  started();
  yield Buffer.from('must not start');
}

describe('AssetService caller-owned write scope', () => {
  it('joins a caller-owned persistence scope without opening a nested scope', async () => {
    const { assets, persistence } = fixture();
    const withWriteScope = vi.spyOn(persistence, 'withWriteScope');

    const batch = await assets.putBatchWithPersistence(
      {
        assets: requests(),
        ...LIMITS,
      },
      persistence
    );

    expect(batch).toHaveLength(requests().length);
    expect(withWriteScope).not.toHaveBeenCalled();
  });
});

describe('AssetService write batches', () => {
  it('preserves single-write handles and uses bounded persistence batches', async () => {
    const singlesFixture = fixture();
    const singles = [];
    for (const request of requests()) {
      singles.push(await singlesFixture.assets.put(request));
    }
    const batchFixture = fixture();
    const writeBlobs = vi.spyOn(batchFixture.persistence, 'writeBlobs');
    const writeTrees = vi.spyOn(batchFixture.persistence, 'writeTrees');

    const batch = await batchFixture.assets.putBatch({ assets: requests(), ...LIMITS });

    expect(batch.map((asset) => asset.handle.toString())).toEqual(
      singles.map((asset) => asset.handle.toString())
    );
    expect(Object.isFrozen(batch)).toBe(true);
    expect(writeBlobs).toHaveBeenCalled();
    expect(writeTrees).toHaveBeenCalledOnce();
    expect(writeTrees.mock.calls[0][0]).toHaveLength(requests().length);
  });

  it('returns results in input order under bounded asset concurrency', async () => {
    const { assets } = fixture();
    const activity = { active: 0, maximum: 0 };
    const inputs = trackedRequests(6, activity);

    const batch = await assets.putBatch({
      assets: inputs,
      ...LIMITS,
      maxBatchAssets: 2,
    });

    expect(batch.map((asset) => asset.asset.slug)).toEqual(inputs.map((asset) => asset.slug));
    expect(activity.maximum).toBe(2);
  });
});

describe('AssetService batch limits', () => {
  it('rejects an aggregate byte overflow with bounded staging evidence', async () => {
    const { assets } = fixture();

    await expect(
      assets.putBatch({
        assets: requests(),
        ...LIMITS,
        maxBatchBytes: 1024,
      })
    ).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
      meta: {
        staging: {
          writeObjects: expect.any(Number),
          writeBytes: expect.any(Number),
        },
      },
    });
  });

  it('rejects invalid bounds or a non-array request before starting a source', async () => {
    const { assets } = fixture();
    const started = vi.fn();
    const input = {
      source: (async function* tracked() {
        started();
        yield Buffer.from('unused');
      })(),
      slug: 'unused',
    };

    await expect(
      assets.putBatch({
        assets: [input],
        ...LIMITS,
        maxBatchAssets: 0,
      })
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    await expect(assets.putBatch({ assets: new Set(), ...LIMITS })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    expect(started).not.toHaveBeenCalled();
  });
});

describe('AssetService batch failure containment', () => {
  it('cancels sibling iterators and reports the first failed input without a partial result', async () => {
    const { assets } = fixture();
    const siblingStarted = deferred();
    const siblingClosed = vi.fn();
    const laterStarted = vi.fn();
    const cancellation = new Error('caller cancelled the source');
    cancellation.name = 'AbortError';
    const progress = { chunks: 0 };
    const inputs = [
      {
        source: failedSource(siblingStarted, cancellation),
        slug: 'cancelled',
      },
      {
        source: siblingSource(siblingStarted, siblingClosed, progress),
        slug: 'sibling',
      },
      {
        source: laterSource(laterStarted),
        slug: 'later',
      },
    ];

    const failure = await assets
      .putBatch({
        assets: inputs,
        ...LIMITS,
        maxBatchAssets: 2,
      })
      .catch((error) => error);

    expect(failure).toMatchObject({
      code: 'STREAM_ERROR',
      meta: {
        batchIndex: 0,
        staging: {
          writeObjects: expect.any(Number),
          writeBytes: expect.any(Number),
          stagedAssetCount: 0,
        },
      },
    });
    expect(failure.meta.originalError).toBe(cancellation);
    expect(siblingClosed).toHaveBeenCalledOnce();
    expect(progress.chunks).toBeLessThan(32);
    expect(laterStarted).not.toHaveBeenCalled();
  });
});

describe('AssetService frozen batch failures', () => {
  it('wraps frozen persistence failures without losing the original error', async () => {
    const { assets, persistence } = fixture();
    const rootCause = Object.freeze(Object.assign(new Error('frozen persistence failure'), {
      code: 'GIT_ERROR',
      meta: Object.freeze({ marker: 'frozen' }),
    }));
    vi.spyOn(persistence, 'writeBlobs').mockRejectedValue(rootCause);
    const inputs = ['first', 'second'].map((slug) => ({
      source: source(Buffer.alloc(0)),
      slug,
    }));

    const failure = await assets.putBatch({ assets: inputs, ...LIMITS })
      .catch((error) => error);

    expect(failure).not.toBe(rootCause);
    expect(failure).toMatchObject({
      code: 'GIT_ERROR',
      message: 'frozen persistence failure',
      cause: rootCause,
      meta: {
        marker: 'frozen',
        originalError: rootCause,
        staging: { stagedAssetCount: 0 },
      },
    });
  });
});
