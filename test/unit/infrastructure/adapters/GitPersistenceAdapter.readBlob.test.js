import { describe, it, expect, vi } from 'vitest';
import GitPersistenceAdapter from '../../../../src/infrastructure/adapters/GitPersistenceAdapter.js';

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
});
