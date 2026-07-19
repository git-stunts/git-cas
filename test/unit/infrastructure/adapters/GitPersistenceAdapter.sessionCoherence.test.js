import { describe, expect, it, vi } from 'vitest';
import GitPersistenceAdapter from '../../../../src/infrastructure/adapters/GitPersistenceAdapter.js';

const noPolicy = { execute: (operation) => operation() };

describe('GitPersistenceAdapter write coherence matrix', () => {
  it('preserves cat-file and mktree sessions after a one-shot loose blob write', async () => {
    const blobOid = 'a'.repeat(40);
    const cat = catSession(blobOid);
    const mktree = mktreeSession('b'.repeat(40));
    const plumbing = sessionPlumbing({ cat, mktree });
    plumbing.execute.mockResolvedValue(blobOid);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    await adapter.writeTree([]);
    await adapter.readObjectType(blobOid);

    await expect(adapter.writeBlob(Buffer.from('value'))).resolves.toBe(blobOid);

    expect(cat.close).not.toHaveBeenCalled();
    expect(mktree.close).not.toHaveBeenCalled();
    await adapter.close();
  });

  it('preserves cat-file and retires mktree after a scoped bulk write', async () => {
    const blobOid = 'a'.repeat(40);
    const cat = catSession(blobOid);
    const mktree = mktreeSession('b'.repeat(40));
    const fastImport = {
      writeBlob: vi.fn().mockResolvedValue('c'.repeat(40)),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const plumbing = sessionPlumbing({ cat, mktree, fastImport });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    await adapter.writeTree([]);
    await adapter.readObjectType(blobOid);

    await expect(adapter.writeBlobs([Buffer.from('value')])).resolves.toEqual(['c'.repeat(40)]);

    expect(cat.close).not.toHaveBeenCalled();
    expect(mktree.close).toHaveBeenCalledTimes(1);
    expect(fastImport.close).toHaveBeenCalledTimes(1);
    await adapter.close();
  });
});

function catSession(oid) {
  return {
    info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: 1 }),
    read: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

function mktreeSession(oid) {
  return {
    write: vi.fn().mockResolvedValue(oid),
    close: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

function sessionPlumbing({ cat, mktree, fastImport } = {}) {
  const plumbing = {
    execute: vi.fn(),
    executeStream: vi.fn(),
    openCatFileSession: vi.fn().mockResolvedValue(cat),
    openMktreeSession: vi.fn().mockResolvedValue(mktree),
  };
  if (fastImport !== undefined) {
    plumbing.openFastImportSession = vi.fn().mockResolvedValue(fastImport);
  }
  return plumbing;
}
