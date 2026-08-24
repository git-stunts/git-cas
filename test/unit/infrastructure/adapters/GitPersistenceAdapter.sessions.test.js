import { describe, expect, it, vi } from 'vitest';
import { GitProtocolError } from '@git-stunts/plumbing';
import GitPersistenceAdapter, {
  DEFAULT_MAX_BLOB_SIZE,
} from '../../../../src/infrastructure/adapters/GitPersistenceAdapter.js';

const noPolicy = { execute: (operation) => operation() };

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function rawTree(entries, oidBytes = 20) {
  const records = [];
  for (const { mode, name, oid } of entries) {
    records.push(Buffer.from(`${mode} ${name}\0`));
    records.push(Buffer.from(oid.padEnd(oidBytes * 2, '0').slice(0, oidBytes * 2), 'hex'));
  }
  return Buffer.concat(records);
}

function catObject({ oid, type = 'blob', content = Buffer.alloc(0) }) {
  return Object.freeze({
    oid,
    type,
    size: content.length,
    content: Uint8Array.from(content),
  });
}

function sessionPlumbing({ catSessions = [], mktreeSession, fastImportSession } = {}) {
  const plumbing = {
    execute: vi.fn(),
    executeStream: vi.fn(),
  };
  if (catSessions.length > 0) {
    plumbing.openCatFileSession = vi.fn();
    for (const session of catSessions) {
      plumbing.openCatFileSession.mockResolvedValueOnce(session);
    }
  }
  if (mktreeSession !== undefined) {
    plumbing.openMktreeSession = vi.fn().mockResolvedValue(mktreeSession);
  }
  if (fastImportSession !== undefined) {
    plumbing.openFastImportSession = vi.fn().mockResolvedValue(fastImportSession);
  }
  return plumbing;
}

function fakeCatSession(overrides = {}) {
  return {
    info: vi.fn(),
    read: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('GitPersistenceAdapter persistent cat-file reads', () => {
  it('coalesces concurrent session opening and serializes bounded object reads', async () => {
    const firstOid = 'a'.repeat(40);
    const secondOid = 'b'.repeat(40);
    const cat = fakeCatSession({
      read: vi.fn(async (oid) => catObject({ oid, content: Buffer.from(oid[0]) })),
    });
    const plumbing = sessionPlumbing({ catSessions: [cat] });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(
      Promise.all([adapter.readBlob(firstOid), adapter.readBlob(secondOid)])
    ).resolves.toEqual([Buffer.from('a'), Buffer.from('b')]);

    expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(1);
    expect(cat.read).toHaveBeenCalledTimes(2);
    expect(plumbing.executeStream).not.toHaveBeenCalled();
  });
});

describe('GitPersistenceAdapter metadata batches', () => {
  it('pipelines uncached metadata and preserves input order', async () => {
    const firstOid = 'a'.repeat(40);
    const secondOid = 'b'.repeat(40);
    const cat = fakeCatSession({
      infoMany: vi.fn().mockResolvedValue([
        { oid: firstOid, type: 'blob', size: 7 },
        { oid: secondOid, type: 'tree', size: 11 },
      ]),
    });
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ catSessions: [cat] }),
      policy: noPolicy,
    });

    await expect(adapter.readObjectInfos([firstOid, secondOid, firstOid])).resolves.toEqual([
      { oid: firstOid, type: 'blob', size: 7 },
      { oid: secondOid, type: 'tree', size: 11 },
      { oid: firstOid, type: 'blob', size: 7 },
    ]);
    await expect(adapter.readObjectType(secondOid)).resolves.toBe('tree');
    expect(cat.infoMany).toHaveBeenCalledWith([firstOid, secondOid]);
    expect(cat.info).not.toHaveBeenCalled();
  });

  it('falls back to ordered info() calls when infoMany() is unavailable', async () => {
    const firstOid = 'c'.repeat(40);
    const secondOid = 'd'.repeat(40);
    const cat = fakeCatSession({
      info: vi.fn(async (oid) => ({ oid, type: 'blob', size: oid === firstOid ? 1 : 2 })),
    });
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ catSessions: [cat] }),
      policy: noPolicy,
    });

    await expect(adapter.readObjectInfos([firstOid, secondOid])).resolves.toEqual([
      { oid: firstOid, type: 'blob', size: 1 },
      { oid: secondOid, type: 'blob', size: 2 },
    ]);
    expect(cat.info).toHaveBeenCalledTimes(2);
  });
});

describe('GitPersistenceAdapter cat-file recovery', () => {
  it('invalidates a failed session and opens a fresh session on the next call', async () => {
    const oid = 'c'.repeat(40);
    const failed = fakeCatSession({
      info: vi.fn().mockRejectedValue(new Error('protocol failed')),
    });
    const replacement = fakeCatSession({
      info: vi.fn().mockResolvedValue({ oid, type: 'tree', size: 12 }),
    });
    const plumbing = sessionPlumbing({ catSessions: [failed, replacement] });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.readObjectType(oid)).rejects.toThrow('protocol failed');
    await expect(adapter.readObjectType(oid)).resolves.toBe('tree');

    expect(failed.terminate).toHaveBeenCalledTimes(1);
    expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(2);
  });

  it('retries one idempotent read after a typed protocol process failure', async () => {
    const oid = 'f'.repeat(40);
    const failed = fakeCatSession({
      info: vi.fn().mockRejectedValue(new GitProtocolError('process closed', 'test')),
    });
    const replacement = fakeCatSession({
      info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: 7 }),
    });
    const plumbing = sessionPlumbing({ catSessions: [failed, replacement] });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.readObjectSize(oid)).resolves.toBe(7);
    expect(failed.terminate).toHaveBeenCalledTimes(1);
    expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(2);
  });
});

describe('GitPersistenceAdapter concurrent cat-file recovery', () => {
  it('does not let a late old-session failure invalidate its replacement', async () => {
    const firstOid = '1'.repeat(40);
    const secondOid = '2'.repeat(40);
    const firstFailure = deferred();
    const lateFailure = deferred();
    const failed = fakeCatSession({
      info: vi.fn((oid) => (oid === firstOid ? firstFailure.promise : lateFailure.promise)),
    });
    const replacement = fakeCatSession({
      info: vi.fn(async (oid) => ({ oid, type: 'blob', size: 1 })),
    });
    const plumbing = sessionPlumbing({ catSessions: [failed, replacement] });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    const firstRead = adapter.readObjectType(firstOid);
    const secondRead = adapter.readObjectType(secondOid);
    await vi.waitFor(() => expect(failed.info).toHaveBeenCalledTimes(2));

    firstFailure.reject(new GitProtocolError('first process failure', 'test'));
    await expect(firstRead).resolves.toBe('blob');
    lateFailure.reject(new GitProtocolError('late process failure', 'test'));
    await expect(secondRead).resolves.toBe('blob');

    expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(2);
    expect(replacement.info).toHaveBeenCalledTimes(2);
    expect(replacement.terminate).not.toHaveBeenCalled();
  });
});

describe('GitPersistenceAdapter cat-file invalidation barrier', () => {
  it('does not open a replacement before the failed process terminates', async () => {
    const firstOid = '3'.repeat(40);
    const secondOid = '4'.repeat(40);
    const terminated = deferred();
    const failed = fakeCatSession({
      info: vi.fn().mockRejectedValue(new GitProtocolError('process closed', 'test')),
      terminate: vi.fn().mockReturnValue(terminated.promise),
    });
    const replacement = fakeCatSession({
      info: vi.fn(async (oid) => ({ oid, type: 'blob', size: 1 })),
    });
    const plumbing = sessionPlumbing({ catSessions: [failed, replacement] });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    const firstRead = adapter.readObjectType(firstOid);
    await vi.waitFor(() => expect(failed.terminate).toHaveBeenCalledTimes(1));
    const secondRead = adapter.readObjectType(secondOid);
    await Promise.resolve();

    expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(1);
    terminated.resolve();
    await expect(Promise.all([firstRead, secondRead])).resolves.toEqual(['blob', 'blob']);
    expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(2);
    await adapter.close();
  });
});

describe('GitPersistenceAdapter cat-file invalidation failures', () => {
  it('preserves the operation and teardown failures without opening a replacement', async () => {
    const operationError = new GitProtocolError('process closed', 'test');
    const terminationError = new Error('termination failed');
    const failed = fakeCatSession({
      info: vi.fn().mockRejectedValue(operationError),
      terminate: vi.fn().mockRejectedValue(terminationError),
    });
    const replacement = fakeCatSession();
    const plumbing = sessionPlumbing({ catSessions: [failed, replacement] });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    const failure = await adapter.readObjectType('5'.repeat(40)).catch((error) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([operationError, terminationError]);
    await expect(adapter.readObjectType('6'.repeat(40))).rejects.toBe(terminationError);
    await expect(adapter.close()).rejects.toBeInstanceOf(AggregateError);
    expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(1);
  });
});

describe('GitPersistenceAdapter bounded payload streaming', () => {
  it('reads a bounded small payload through the persistent cat-file session', async () => {
    const oid = 'd'.repeat(40);
    const content = Buffer.from('session-backed');
    const cat = fakeCatSession({
      info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: content.length }),
      read: vi.fn().mockResolvedValue(catObject({ oid, content })),
    });
    const plumbing = sessionPlumbing({ catSessions: [cat] });
    plumbing.executeStream.mockResolvedValue(
      (async function* stream() {
        yield Buffer.from('legacy-stream');
      })()
    );
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    const chunks = [];

    for await (const chunk of await adapter.readBlobStream(oid)) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks)).toEqual(content);
    expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(1);
    expect(cat.info).toHaveBeenCalledWith(oid);
    expect(cat.read).toHaveBeenCalledWith(oid, { maxBytes: DEFAULT_MAX_BLOB_SIZE });
    expect(plumbing.executeStream).not.toHaveBeenCalled();
    await adapter.close();
  });
});

describe('GitPersistenceAdapter oversized payload streaming', () => {
  it('routes an oversized payload directly to the genuine streaming path', async () => {
    const oid = 'e'.repeat(40);
    const content = Buffer.from('large-stream');
    const cat = fakeCatSession({
      info: vi.fn().mockResolvedValue({
        oid,
        type: 'blob',
        size: DEFAULT_MAX_BLOB_SIZE + 1,
      }),
    });
    const plumbing = sessionPlumbing({ catSessions: [cat] });
    plumbing.executeStream.mockResolvedValue(
      (async function* stream() {
        yield content.subarray(0, 5);
        yield content.subarray(5);
      })()
    );
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    adapter.setMaxBlobSize(Number.MAX_SAFE_INTEGER);

    const chunks = [];
    for await (const chunk of await adapter.readBlobStream(oid)) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks)).toEqual(content);
    expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(1);
    expect(cat.info).toHaveBeenCalledWith(oid);
    expect(cat.read).not.toHaveBeenCalled();
    expect(plumbing.executeStream).toHaveBeenCalledTimes(1);
    expect(plumbing.executeStream).toHaveBeenCalledWith({
      args: ['cat-file', 'blob', oid],
    });
    await adapter.close();
  });
});

describe('GitPersistenceAdapter exceptional payload streaming', () => {
  it.each([
    ['missing metadata', new Error('missing'), undefined],
    ['a non-blob object', undefined, { type: 'tree', size: 8 }],
  ])('keeps %s on the existing one-shot path', async (_label, infoError, info) => {
    const oid = 'f'.repeat(40);
    const cat = fakeCatSession({
      info:
        infoError === undefined
          ? vi.fn().mockResolvedValue({ oid, ...info })
          : vi.fn().mockRejectedValue(infoError),
    });
    const plumbing = sessionPlumbing({ catSessions: [cat] });
    plumbing.executeStream.mockResolvedValue(
      (async function* stream() {
        yield Buffer.from('legacy');
      })()
    );
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    const chunks = [];
    for await (const chunk of await adapter.readBlobStream(oid)) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks)).toEqual(Buffer.from('legacy'));
    expect(cat.read).not.toHaveBeenCalled();
    expect(plumbing.executeStream).toHaveBeenCalledTimes(1);
    await adapter.close();
  });
});

describe('GitPersistenceAdapter failed session payload streaming', () => {
  it('falls back before yielding when the bounded session content read fails', async () => {
    const oid = '9'.repeat(40);
    const cat = fakeCatSession({
      info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: 8 }),
      read: vi.fn().mockRejectedValue(new Error('session read failed')),
    });
    const plumbing = sessionPlumbing({ catSessions: [cat] });
    plumbing.executeStream.mockResolvedValue(
      (async function* stream() {
        yield Buffer.from('fallback');
      })()
    );
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    const chunks = [];
    for await (const chunk of await adapter.readBlobStream(oid)) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks)).toEqual(Buffer.from('fallback'));
    expect(cat.terminate).toHaveBeenCalledTimes(1);
    expect(plumbing.executeStream).toHaveBeenCalledTimes(1);
    await adapter.close();
  });
});

describe('GitPersistenceAdapter immutable tree reuse', () => {
  it('reads one tree object for distinct exact lookups and isolates returned entries', async () => {
    const treeOid = '1'.repeat(40);
    const firstOid = '2'.repeat(40);
    const secondOid = '3'.repeat(40);
    const content = rawTree([
      { mode: '100644', name: 'first', oid: firstOid },
      { mode: '100644', name: 'second', oid: secondOid },
    ]);
    const cat = fakeCatSession({
      read: vi.fn().mockResolvedValue(catObject({ oid: treeOid, type: 'tree', content })),
    });
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ catSessions: [cat] }),
      policy: noPolicy,
      treeCacheEntries: 2,
      treeCacheBytes: 4096,
    });

    const first = await adapter.readTreeEntry(treeOid, 'first');
    first.name = 'mutated';
    await expect(adapter.readTreeEntry(treeOid, 'second')).resolves.toEqual({
      mode: '100644',
      type: 'blob',
      oid: secondOid,
      name: 'second',
    });
    await expect(adapter.readTreeEntry(treeOid, 'first')).resolves.toMatchObject({ name: 'first' });

    expect(cat.read).toHaveBeenCalledTimes(1);
  });
});

describe('GitPersistenceAdapter exact tree paths', () => {
  it('traverses an exact nested path through bounded tree objects', async () => {
    const rootOid = '4'.repeat(40);
    const childOid = '5'.repeat(40);
    const blobOid = '6'.repeat(40);
    const objects = new Map([
      [rootOid, rawTree([{ mode: '40000', name: 'nested', oid: childOid }])],
      [childOid, rawTree([{ mode: '100644', name: 'value', oid: blobOid }])],
    ]);
    const cat = fakeCatSession({
      read: vi.fn(async (oid) => catObject({ oid, type: 'tree', content: objects.get(oid) })),
    });
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ catSessions: [cat] }),
      policy: noPolicy,
    });

    await expect(adapter.readTreeEntry(rootOid, 'nested/value')).resolves.toEqual({
      mode: '100644',
      type: 'blob',
      oid: blobOid,
      name: 'nested/value',
    });
    expect(cat.read).toHaveBeenCalledTimes(2);
  });
});

describe('GitPersistenceAdapter tree cache residency', () => {
  it('evicts tree objects by the configured byte bound', async () => {
    const firstTree = '7'.repeat(40);
    const secondTree = '8'.repeat(40);
    const payloads = new Map([
      [firstTree, rawTree([{ mode: '100644', name: 'first', oid: '9'.repeat(40) }])],
      [secondTree, rawTree([{ mode: '100644', name: 'second', oid: 'a'.repeat(40) }])],
    ]);
    const cat = fakeCatSession({
      read: vi.fn(async (oid) => catObject({ oid, type: 'tree', content: payloads.get(oid) })),
    });
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ catSessions: [cat] }),
      policy: noPolicy,
      metadataCacheEntries: 1,
      treeCacheEntries: 2,
      treeCacheBytes: 200,
    });

    await adapter.readTreeEntry(firstTree, 'first');
    await adapter.readTreeEntry(secondTree, 'second');
    await adapter.readTreeEntry(firstTree, 'first');

    expect(cat.read).toHaveBeenCalledTimes(3);
  });
});

describe('GitPersistenceAdapter operation-owned write scopes', () => {
  it('keeps one operation-owned fast-import child across dependency waves', async () => {
    const fastImport = {
      writeBlobs: vi
        .fn()
        .mockResolvedValueOnce(['a'.repeat(40), 'b'.repeat(40)])
        .mockResolvedValueOnce(['c'.repeat(40)]),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const plumbing = sessionPlumbing({ fastImportSession: fastImport });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.withWriteScope(async (persistence) => {
      const first = await persistence.writeBlobs([
        Buffer.from('first'),
        Buffer.from('second'),
      ]);
      const second = await persistence.writeBlob(Buffer.from('third'));
      return [...first, second];
    })).resolves.toEqual(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]);

    expect(plumbing.openFastImportSession).toHaveBeenCalledOnce();
    expect(fastImport.writeBlobs).toHaveBeenCalledTimes(2);
    expect(fastImport.checkpoint).toHaveBeenCalledTimes(2);
    expect(fastImport.close).toHaveBeenCalledOnce();
    await adapter.close();
  });

});

describe('GitPersistenceAdapter operation-owned oversized writes', () => {
  it('keeps an oversized blob on the genuine one-shot write path', async () => {
    const fastImport = {
      writeBlobs: vi.fn(),
      checkpoint: vi.fn(),
      close: vi.fn(),
      abort: vi.fn(),
    };
    const plumbing = sessionPlumbing({ fastImportSession: fastImport });
    plumbing.execute.mockResolvedValue('d'.repeat(40));
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    const content = Buffer.alloc(64 * 1024 * 1024 + 1);

    await expect(adapter.withWriteScope((persistence) => persistence.writeBlob(content)))
      .resolves.toBe('d'.repeat(40));

    expect(plumbing.execute).toHaveBeenCalledOnce();
    expect(plumbing.execute.mock.calls[0][0].args).toEqual(['hash-object', '-w', '--stdin']);
    expect(plumbing.execute.mock.calls[0][0].input).toBe(content);
    expect(plumbing.openFastImportSession).not.toHaveBeenCalled();
    await adapter.close();
  });

  it('splits oversized elements out of a scoped blob batch without reordering', async () => {
    const fastImport = {
      writeBlobs: vi.fn().mockResolvedValue(['a'.repeat(40), 'c'.repeat(40)]),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const plumbing = sessionPlumbing({ fastImportSession: fastImport });
    plumbing.execute.mockResolvedValue('b'.repeat(40));
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    const first = Buffer.from('first');
    const oversized = Buffer.alloc(64 * 1024 * 1024 + 1);
    const third = Buffer.from('third');

    await expect(adapter.withWriteScope((persistence) => (
      persistence.writeBlobs([first, oversized, third])
    ))).resolves.toEqual(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]);

    expect(fastImport.writeBlobs).toHaveBeenCalledWith([first, third]);
    expect(plumbing.execute).toHaveBeenCalledOnce();
    expect(plumbing.execute.mock.calls[0][0].input).toBe(oversized);
    await adapter.close();
  });
});

describe('GitPersistenceAdapter persistent write sessions', () => {
  it('checkpoints and closes one scoped bulk blob write before returning OIDs', async () => {
    const fastImport = {
      writeBlob: vi
        .fn()
        .mockResolvedValueOnce('a'.repeat(40))
        .mockResolvedValueOnce('b'.repeat(40)),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const plumbing = sessionPlumbing({ fastImportSession: fastImport });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(
      adapter.writeBlobs([Buffer.from('first'), Buffer.from('second')])
    ).resolves.toEqual(['a'.repeat(40), 'b'.repeat(40)]);

    expect(plumbing.openFastImportSession).toHaveBeenCalledTimes(1);
    expect(fastImport.writeBlob).toHaveBeenCalledTimes(2);
    expect(fastImport.checkpoint).toHaveBeenCalledTimes(1);
    expect(fastImport.close).toHaveBeenCalledTimes(1);
    expect(plumbing.execute).not.toHaveBeenCalled();
  });

  it('aborts and rejects when a scoped bulk session cannot close cleanly', async () => {
    const fastImport = {
      writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(new Error('graceful close failed')),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ fastImportSession: fastImport }),
      policy: noPolicy,
    });

    await expect(adapter.writeBlobs([Buffer.from('value')])).rejects.toThrow(
      'graceful close failed'
    );

    expect(fastImport.checkpoint).toHaveBeenCalledTimes(1);
    expect(fastImport.close).toHaveBeenCalledTimes(1);
    expect(fastImport.abort).toHaveBeenCalledTimes(1);
  });
});

describe('GitPersistenceAdapter pipelined blob writes', () => {
  it('uses one bounded writeBlobs() protocol operation', async () => {
    const contents = [Buffer.from('first'), Buffer.from('second')];
    const fastImport = {
      writeBlobs: vi.fn().mockResolvedValue(['a'.repeat(40), 'b'.repeat(40)]),
      writeBlob: vi.fn(),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ fastImportSession: fastImport }),
      policy: noPolicy,
    });

    await expect(adapter.writeBlobs(contents)).resolves.toEqual([
      'a'.repeat(40),
      'b'.repeat(40),
    ]);
    expect(fastImport.writeBlobs).toHaveBeenCalledWith(contents);
    expect(fastImport.writeBlob).not.toHaveBeenCalled();
    expect(fastImport.checkpoint).toHaveBeenCalledOnce();
    expect(fastImport.close).toHaveBeenCalledOnce();
  });
});

describe('GitPersistenceAdapter bulk write retirement failures', () => {
  it('preserves mktree and bulk session retirement failures', async () => {
    const mktreeCloseError = new Error('mktree close failed');
    const fastImportCloseError = new Error('fast-import close failed');
    const mktree = {
      write: vi.fn().mockResolvedValue('a'.repeat(40)),
      close: vi.fn().mockRejectedValue(mktreeCloseError),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const fastImport = {
      writeBlob: vi.fn().mockResolvedValue('b'.repeat(40)),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(fastImportCloseError),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ mktreeSession: mktree, fastImportSession: fastImport }),
      policy: noPolicy,
    });
    await adapter.writeTree([]);

    const failure = await adapter.writeBlobs([Buffer.from('value')]).catch((error) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([mktreeCloseError, fastImportCloseError]);
    expect(mktree.terminate).toHaveBeenCalledTimes(1);
    expect(fastImport.abort).toHaveBeenCalledTimes(1);
  });
});

describe('GitPersistenceAdapter explicit retirement barrier', () => {
  it('does not open a replacement mktree while post-bulk retirement drains', async () => {
    const retired = deferred();
    const first = {
      write: vi.fn().mockResolvedValue('c'.repeat(40)),
      close: vi.fn().mockReturnValue(retired.promise),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const replacement = {
      write: vi.fn().mockResolvedValue('d'.repeat(40)),
      close: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const fastImport = {
      writeBlob: vi.fn().mockResolvedValue('e'.repeat(40)),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const plumbing = sessionPlumbing({ mktreeSession: first, fastImportSession: fastImport });
    plumbing.openMktreeSession
      .mockReset()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(replacement);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await adapter.writeTree([]);
    const write = adapter.writeBlobs([Buffer.from('value')]);
    await vi.waitFor(() => expect(first.close).toHaveBeenCalledTimes(1));
    const nextTree = adapter.writeTree([]);
    await Promise.resolve();

    expect(plumbing.openMktreeSession).toHaveBeenCalledTimes(1);
    retired.resolve();
    await expect(write).resolves.toEqual(['e'.repeat(40)]);
    await expect(nextTree).resolves.toBe('d'.repeat(40));
    expect(plumbing.openMktreeSession).toHaveBeenCalledTimes(2);
    await adapter.close();
  });
});

describe('GitPersistenceAdapter bulk write recovery', () => {
  it('replays a materialized bulk input through a fresh typed session', async () => {
    const failed = {
      writeBlob: vi.fn().mockRejectedValue(new GitProtocolError('process closed', 'test')),
      checkpoint: vi.fn(),
      close: vi.fn(),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const replacement = {
      writeBlob: vi
        .fn()
        .mockResolvedValueOnce('a'.repeat(40))
        .mockResolvedValueOnce('b'.repeat(40)),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const plumbing = sessionPlumbing();
    plumbing.openFastImportSession = vi
      .fn()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(replacement);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    const sources = [Buffer.from('first'), Buffer.from('second')];

    await expect(adapter.writeBlobs(sources.values())).resolves.toEqual([
      'a'.repeat(40),
      'b'.repeat(40),
    ]);

    expect(failed.abort).toHaveBeenCalledTimes(1);
    expect(replacement.writeBlob).toHaveBeenCalledTimes(2);
    expect(replacement.close).toHaveBeenCalledTimes(1);
  });
});

describe('GitPersistenceAdapter persistent tree writes', () => {
  it('converts mktree lines and preserves an opened persistent reader', async () => {
    const cat = fakeCatSession({
      info: vi.fn().mockResolvedValue({ oid: 'd'.repeat(40), type: 'blob', size: 1 }),
    });
    const mktree = {
      write: vi.fn().mockResolvedValue('c'.repeat(40)),
      close: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const plumbing = sessionPlumbing({ catSessions: [cat], mktreeSession: mktree });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    await adapter.readObjectType('d'.repeat(40));

    await expect(adapter.writeTree([`${'100644'} blob ${'d'.repeat(40)}\tpage`])).resolves.toBe(
      'c'.repeat(40)
    );

    expect(mktree.write).toHaveBeenCalledWith([
      { mode: '100644', type: 'blob', oid: 'd'.repeat(40), name: 'page' },
    ]);
    expect(cat.close).not.toHaveBeenCalled();
    expect(plumbing.execute).not.toHaveBeenCalled();
    await adapter.close();
  });
});

describe('GitPersistenceAdapter pipelined tree writes', () => {
  it('uses one writeMany() operation and preserves order', async () => {
    const firstOid = 'd'.repeat(40);
    const secondOid = 'e'.repeat(40);
    const trees = [
      [`100644 blob ${firstOid}\tfirst`],
      [`100644 blob ${secondOid}\tsecond`],
    ];
    const mktree = {
      write: vi.fn(),
      writeMany: vi.fn().mockResolvedValue(['1'.repeat(40), '2'.repeat(40)]),
      close: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ mktreeSession: mktree }),
      policy: noPolicy,
    });

    await expect(adapter.writeTrees(trees)).resolves.toEqual([
      '1'.repeat(40),
      '2'.repeat(40),
    ]);
    expect(mktree.writeMany).toHaveBeenCalledWith([
      [{ mode: '100644', type: 'blob', oid: firstOid, name: 'first' }],
      [{ mode: '100644', type: 'blob', oid: secondOid, name: 'second' }],
    ]);
    expect(mktree.write).not.toHaveBeenCalled();
    await adapter.close();
  });
});

describe('GitPersistenceAdapter tree batch fallback', () => {
  it('uses ordered write() calls when writeMany() is unavailable', async () => {
    const firstOid = 'f'.repeat(40);
    const secondOid = '0'.repeat(40);
    const mktree = {
      write: vi.fn()
        .mockResolvedValueOnce('3'.repeat(40))
        .mockResolvedValueOnce('4'.repeat(40)),
      close: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ mktreeSession: mktree }),
      policy: noPolicy,
    });

    await expect(adapter.writeTrees([
      [`100644 blob ${firstOid}\tfirst`],
      [`100644 blob ${secondOid}\tsecond`],
    ])).resolves.toEqual(['3'.repeat(40), '4'.repeat(40)]);
    expect(mktree.write).toHaveBeenCalledTimes(2);
    await adapter.close();
  });
});

describe('GitPersistenceAdapter fallback tree writes', () => {
  it('preserves the persistent reader after a one-shot tree write', async () => {
    const blobOid = 'd'.repeat(40);
    const treeOid = 'e'.repeat(40);
    const cat = fakeCatSession({
      info: vi.fn().mockResolvedValue({ oid: blobOid, type: 'blob', size: 1 }),
    });
    const plumbing = sessionPlumbing({ catSessions: [cat] });
    plumbing.execute.mockResolvedValue(treeOid);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    await adapter.readObjectType(blobOid);

    await expect(adapter.writeTree([])).resolves.toBe(treeOid);

    expect(cat.close).not.toHaveBeenCalled();
    await adapter.close();
  });
});

describe('GitPersistenceAdapter lifecycle', () => {
  it('closes every opened session once and rejects later operations', async () => {
    const oid = 'e'.repeat(40);
    const cat = fakeCatSession({
      info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: 1 }),
    });
    const mktree = {
      write: vi.fn().mockResolvedValue('f'.repeat(40)),
      close: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const fastImport = {
      writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)),
      checkpoint: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({
        catSessions: [cat],
        mktreeSession: mktree,
        fastImportSession: fastImport,
      }),
      policy: noPolicy,
    });

    await adapter.readObjectType(oid);
    await adapter.writeTree([]);
    await adapter.writeBlobs([Buffer.from('value')]);

    expect(cat.close).not.toHaveBeenCalled();
    expect(mktree.close).toHaveBeenCalledTimes(1);
    await Promise.all([adapter.close(), adapter.close(), adapter[Symbol.asyncDispose]()]);

    expect(cat.close).toHaveBeenCalledTimes(1);
    expect(mktree.close).toHaveBeenCalledTimes(1);
    expect(fastImport.close).toHaveBeenCalledTimes(1);
    await expect(adapter.readObjectType(oid)).rejects.toMatchObject({
      code: 'RESOURCE_CLOSED',
    });
  });
});

describe('GitPersistenceAdapter command shutdown', () => {
  it('waits for an active one-shot command before closing protocol sessions', async () => {
    const oid = '1'.repeat(40);
    const write = deferred();
    const cat = fakeCatSession({
      info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: 1 }),
    });
    const plumbing = sessionPlumbing({ catSessions: [cat] });
    plumbing.execute.mockReturnValue(write.promise);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await adapter.readObjectType(oid);
    const pendingWrite = adapter.writeBlob(Buffer.from('value'));
    await vi.waitFor(() => expect(plumbing.execute).toHaveBeenCalledTimes(1));

    let closeSettled = false;
    const close = adapter.close().then(() => {
      closeSettled = true;
    });
    await Promise.resolve();

    expect(closeSettled).toBe(false);
    expect(cat.close).not.toHaveBeenCalled();

    write.resolve('2'.repeat(40));
    await expect(pendingWrite).resolves.toBe('2'.repeat(40));
    await close;

    expect(cat.close).toHaveBeenCalledTimes(1);
  });
});

describe('GitPersistenceAdapter stream shutdown', () => {
  it('destroys an abandoned output stream and waits for its Git process', async () => {
    const finished = deferred();
    const stream = {
      async *[Symbol.asyncIterator]() {},
      destroy: vi.fn().mockResolvedValue(undefined),
      finished: finished.promise,
    };
    const plumbing = sessionPlumbing();
    plumbing.executeStream.mockResolvedValue(stream);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await adapter.readBlobStream('3'.repeat(40));
    let closeSettled = false;
    const close = adapter.close().then(() => {
      closeSettled = true;
    });
    await vi.waitFor(() => expect(stream.destroy).toHaveBeenCalledTimes(1));

    expect(closeSettled).toBe(false);
    finished.resolve({ code: 0, stderr: '' });
    await close;

    expect(closeSettled).toBe(true);
  });
});

describe('GitPersistenceAdapter failed stream shutdown', () => {
  it('waits for process completion and preserves a destroy failure', async () => {
    const destroyError = new Error('stream destroy failed');
    const finished = deferred();
    const stream = {
      async *[Symbol.asyncIterator]() {},
      destroy: vi.fn().mockRejectedValue(destroyError),
      finished: finished.promise,
    };
    const plumbing = sessionPlumbing();
    plumbing.executeStream.mockResolvedValue(stream);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    await adapter.readBlobStream('4'.repeat(40));

    let closeSettled = false;
    const close = adapter.close().then(
      () => ({ status: 'fulfilled' }),
      (error) => ({ status: 'rejected', error })
    );
    void close.then(() => {
      closeSettled = true;
    });
    await vi.waitFor(() => expect(stream.destroy).toHaveBeenCalledTimes(1));

    expect(closeSettled).toBe(false);
    finished.resolve({ code: 1, stderr: 'terminated' });
    const outcome = await close;
    expect(outcome).toMatchObject({ status: 'rejected' });
    expect(outcome.error).toBeInstanceOf(AggregateError);
    expect(outcome.error.errors).toContain(destroyError);
  });
});

describe('GitPersistenceAdapter failed session shutdown', () => {
  it('terminates a session whose graceful close fails before reporting the error', async () => {
    const oid = '4'.repeat(40);
    const cat = fakeCatSession({
      info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: 1 }),
      close: vi.fn().mockRejectedValue(new Error('graceful close failed')),
    });
    const adapter = new GitPersistenceAdapter({
      plumbing: sessionPlumbing({ catSessions: [cat] }),
      policy: noPolicy,
    });

    await adapter.readObjectType(oid);
    await expect(adapter.close()).rejects.toBeInstanceOf(AggregateError);

    expect(cat.close).toHaveBeenCalledTimes(1);
    expect(cat.terminate).toHaveBeenCalledTimes(1);
  });
});

describe('GitPersistenceAdapter idle lifecycle fallback', () => {
  it('retires an idle session when a caller omits explicit close', async () => {
    vi.useFakeTimers();
    try {
      const oid = '1'.repeat(40);
      const cat = fakeCatSession({
        info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: 1 }),
      });
      const adapter = new GitPersistenceAdapter({
        plumbing: sessionPlumbing({ catSessions: [cat] }),
        policy: noPolicy,
        sessionIdleTimeoutMs: 10,
      });

      await adapter.readObjectType(oid);
      expect(cat.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10);
      expect(cat.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GitPersistenceAdapter idle retirement shutdown', () => {
  it('waits for an in-flight idle retirement before explicit close resolves', async () => {
    vi.useFakeTimers();
    try {
      const oid = '2'.repeat(40);
      const nextOid = '3'.repeat(40);
      const retired = deferred();
      const cat = fakeCatSession({
        info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: 1 }),
        close: vi.fn().mockReturnValue(retired.promise),
      });
      const replacement = fakeCatSession({
        info: vi.fn().mockResolvedValue({ oid: nextOid, type: 'tree', size: 1 }),
      });
      const plumbing = sessionPlumbing({ catSessions: [cat, replacement] });
      const adapter = new GitPersistenceAdapter({
        plumbing,
        policy: noPolicy,
        sessionIdleTimeoutMs: 10,
      });

      await adapter.readObjectType(oid);
      await vi.advanceTimersByTimeAsync(10);
      const nextRead = adapter.readObjectType(nextOid);
      let closeSettled = false;
      const close = adapter.close().then(() => {
        closeSettled = true;
      });
      await Promise.resolve();

      expect(closeSettled).toBe(false);
      expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(1);
      retired.resolve();
      await expect(nextRead).resolves.toBe('tree');
      await close;
      expect(closeSettled).toBe(true);
      expect(plumbing.openCatFileSession).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GitPersistenceAdapter failed idle retirement', () => {
  it('reports an idle retirement failure after force-terminating the session', async () => {
    vi.useFakeTimers();
    try {
      const oid = '3'.repeat(40);
      const cat = fakeCatSession({
        info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: 1 }),
        close: vi.fn().mockRejectedValue(new Error('idle close failed')),
      });
      const adapter = new GitPersistenceAdapter({
        plumbing: sessionPlumbing({ catSessions: [cat] }),
        policy: noPolicy,
        sessionIdleTimeoutMs: 10,
      });

      await adapter.readObjectType(oid);
      await vi.advanceTimersByTimeAsync(10);
      await expect(adapter.close()).rejects.toBeInstanceOf(AggregateError);

      expect(cat.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
