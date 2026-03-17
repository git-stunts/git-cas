import { existsSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import GitPersistenceAdapter from '../../../../src/infrastructure/adapters/GitPersistenceAdapter.js';

const noPolicy = { execute: (fn) => fn() };
const itOnBun = typeof globalThis.Bun !== 'undefined' ? it : it.skip;
const itOffBun = typeof globalThis.Bun === 'undefined' ? it : it.skip;

function createAdapter(plumbing) {
  return new GitPersistenceAdapter({ plumbing, policy: noPolicy });
}

describe('GitPersistenceAdapter.writeBlob()', () => {
  itOffBun('streams blob content over stdin outside Bun', async () => {
    const content = Buffer.from('blob-data');
    const plumbing = { execute: vi.fn().mockResolvedValue('blob-oid') };
    const adapter = createAdapter(plumbing);

    await expect(adapter.writeBlob(content)).resolves.toBe('blob-oid');
    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['hash-object', '-w', '--stdin'],
      input: content,
    });
  });

  itOnBun('writes blob content to a temp file before hashing', async () => {
    let tempPath;
    const plumbing = {
      execute: vi.fn(async ({ args }) => {
        tempPath = args.at(-1);
        expect(args.slice(0, 3)).toEqual(['hash-object', '-w', '--no-filters']);
        expect(existsSync(tempPath)).toBe(true);
        return 'blob-oid';
      }),
    };
    const adapter = createAdapter(plumbing);

    await expect(adapter.writeBlob(Buffer.from('blob-data'))).resolves.toBe('blob-oid');
    expect(plumbing.execute).toHaveBeenCalledTimes(1);
    expect(existsSync(tempPath)).toBe(false);
  });
});
