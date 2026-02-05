import { describe, it, expect, vi, beforeEach } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CasError from '../../../../src/domain/errors/CasError.js';

/**
 * Creates an async iterable that yields `n` chunks of `chunkSize` bytes
 * then throws an error.
 */
function failingSource(chunksBeforeError, chunkSize = 1024) {
  let yielded = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (yielded >= chunksBeforeError) {
            throw new Error('simulated stream failure');
          }
          yielded++;
          return { value: Buffer.alloc(chunkSize, 0xaa), done: false };
        },
      };
    },
  };
}

/**
 * Shared factory: builds the standard test fixtures used by every block.
 */
function setup() {
  const mockPersistence = {
    writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
  };
  const service = new CasService({
    persistence: mockPersistence,
    crypto: new NodeCryptoAdapter(),
    codec: new JsonCodec(),
    chunkSize: 1024,
  });
  return { mockPersistence, service };
}

// ---------------------------------------------------------------------------
// STREAM_ERROR after 3 chunks
// ---------------------------------------------------------------------------
describe('CasService stream error – STREAM_ERROR after 3 chunks', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('throws STREAM_ERROR when stream fails after 3 chunks', async () => {
    await expect(
      service.store({
        source: failingSource(3),
        slug: 'fail-test',
        filename: 'fail.bin',
      }),
    ).rejects.toThrow(CasError);

    try {
      await service.store({
        source: failingSource(3),
        slug: 'fail-test',
        filename: 'fail.bin',
      });
    } catch (err) {
      expect(err.code).toBe('STREAM_ERROR');
      expect(err.meta.chunksWritten).toBe(3);
      expect(err.message).toContain('simulated stream failure');
    }
  });
});

// ---------------------------------------------------------------------------
// STREAM_ERROR immediate failure
// ---------------------------------------------------------------------------
describe('CasService stream error – STREAM_ERROR immediate failure', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('throws STREAM_ERROR with chunksWritten=0 when stream fails immediately', async () => {
    await expect(
      service.store({
        source: failingSource(0),
        slug: 'fail-test',
        filename: 'fail.bin',
      }),
    ).rejects.toThrow(CasError);

    try {
      await service.store({
        source: failingSource(0),
        slug: 'fail-test',
        filename: 'fail.bin',
      });
    } catch (err) {
      expect(err.code).toBe('STREAM_ERROR');
      expect(err.meta.chunksWritten).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// No manifest on error
// ---------------------------------------------------------------------------
describe('CasService stream error – no manifest on error', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('does not return a manifest on stream error', async () => {
    let manifest;
    try {
      manifest = await service.store({
        source: failingSource(2),
        slug: 'no-manifest',
        filename: 'fail.bin',
      });
    } catch {
      // expected
    }
    expect(manifest).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Successful stores still work
// ---------------------------------------------------------------------------
describe('CasService stream error – successful stores', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('succeeds when stream completes normally', async () => {
    async function* goodSource() {
      yield Buffer.alloc(512, 0xbb);
    }

    const manifest = await service.store({
      source: goodSource(),
      slug: 'ok',
      filename: 'ok.bin',
    });

    expect(manifest).toBeDefined();
    expect(manifest.slug).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// CasError passthrough (not double-wrapped)
// ---------------------------------------------------------------------------
describe('CasService stream error – CasError passthrough', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  it('does not wrap CasError as STREAM_ERROR', async () => {
    const casErr = new CasError('custom error', 'CUSTOM_CODE');
    const badSource = {
      [Symbol.asyncIterator]() {
        return {
          async next() { throw casErr; },
        };
      },
    };

    await expect(
      service.store({
        source: badSource,
        slug: 'x',
        filename: 'x.bin',
      }),
    ).rejects.toThrow(casErr);

    try {
      await service.store({ source: badSource, slug: 'x', filename: 'x.bin' });
    } catch (err) {
      expect(err.code).toBe('CUSTOM_CODE');
    }
  });
});

// ---------------------------------------------------------------------------
// Fuzz: randomized failure points
// ---------------------------------------------------------------------------
describe('CasService stream error – fuzz', () => {
  let service;

  beforeEach(() => {
    ({ service } = setup());
  });

  for (let i = 0; i < 20; i++) {
    const failAfter = i;

    it(`STREAM_ERROR with chunksWritten=${failAfter} (iteration ${i})`, async () => {
      await expect(
        service.store({
          source: failingSource(failAfter),
          slug: `fuzz-${i}`,
          filename: 'fuzz.bin',
        }),
      ).rejects.toThrow(CasError);

      try {
        await service.store({
          source: failingSource(failAfter),
          slug: `fuzz-${i}`,
          filename: 'fuzz.bin',
        });
      } catch (err) {
        expect(err.code).toBe('STREAM_ERROR');
        expect(err.meta.chunksWritten).toBe(failAfter);
      }
    });
  }
});
