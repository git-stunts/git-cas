import { describe, it, expect, vi } from 'vitest';
import GitPersistenceAdapter, {
  DEFAULT_MAX_BLOB_SIZE,
} from '../../../../src/infrastructure/adapters/GitPersistenceAdapter.js';

const noPolicy = { execute: (fn) => fn() };

function createAdapter(plumbing) {
  return new GitPersistenceAdapter({ plumbing, policy: noPolicy });
}

function streamFrom(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('GitPersistenceAdapter.readBlobStream()', () => {
  it('streams blob content as Buffer chunks', async () => {
    const plumbing = {
      execute: vi.fn(),
      executeStream: vi.fn().mockResolvedValue(streamFrom([
        new Uint8Array([0x61, 0x62]),
        Buffer.from('cd'),
      ])),
    };
    const adapter = createAdapter(plumbing);

    const chunks = await collect(await adapter.readBlobStream('blob-oid'));

    expect(plumbing.executeStream).toHaveBeenCalledWith({
      args: ['cat-file', 'blob', 'blob-oid'],
    });
    expect(chunks).toHaveLength(2);
    expect(chunks.every(Buffer.isBuffer)).toBe(true);
    expect(Buffer.concat(chunks).toString()).toBe('abcd');
  });
});

describe('GitPersistenceAdapter.readBlob()', () => {
  it('collects streamed blob content into one Buffer for compatibility', async () => {
    const plumbing = {
      execute: vi.fn(),
      executeStream: vi.fn().mockResolvedValue(streamFrom([
        Buffer.from('blob-'),
        Buffer.from('data'),
      ])),
    };
    const adapter = createAdapter(plumbing);

    await expect(adapter.readBlob('blob-oid')).resolves.toEqual(Buffer.from('blob-data'));
  });

  it('reports the default metadata blob limit when no per-call limit is supplied', async () => {
    const plumbing = {
      execute: vi.fn(),
      executeStream: vi.fn().mockResolvedValue(streamFrom([
        Buffer.alloc(DEFAULT_MAX_BLOB_SIZE + 1),
      ])),
    };
    const adapter = createAdapter(plumbing);

    await expect(adapter.readBlob('blob-oid')).rejects.toMatchObject({
      code: 'RESTORE_TOO_LARGE',
      message: `Blob blob-oid exceeds safety limit of ${DEFAULT_MAX_BLOB_SIZE} bytes`,
      meta: { maxBytes: DEFAULT_MAX_BLOB_SIZE },
    });
  });
});

describe('GitPersistenceAdapter.setMaxBlobSize()', () => {
  it('uses the configured adapter-level metadata blob limit', async () => {
    const plumbing = {
      execute: vi.fn(),
      executeStream: vi.fn().mockResolvedValue(streamFrom([
        Buffer.alloc(1025),
      ])),
    };
    const adapter = createAdapter(plumbing);

    adapter.setMaxBlobSize(1024);

    await expect(adapter.readBlob('blob-oid')).rejects.toMatchObject({
      code: 'RESTORE_TOO_LARGE',
      message: 'Blob blob-oid exceeds safety limit of 1024 bytes',
      meta: { maxBytes: 1024 },
    });
  });

  it('rejects invalid adapter-level metadata blob limits', () => {
    const adapter = createAdapter({
      execute: vi.fn(),
      executeStream: vi.fn(),
    });

    expect(() => adapter.setMaxBlobSize(1023)).toThrow(
      'maxBlobSize must be an integer in [1024, 9007199254740991]',
    );
  });
});
