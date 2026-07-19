import { describe, expect, it, vi } from 'vitest';
import { GitProtocolError } from '@git-stunts/plumbing';
import GitPersistenceAdapter from '../../../../src/infrastructure/adapters/GitPersistenceAdapter.js';

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

describe('GitPersistenceAdapter payload streaming', () => {
  it('keeps payload streaming on executeStream instead of buffering through cat-file', async () => {
    const oid = 'd'.repeat(40);
    const cat = fakeCatSession();
    const plumbing = sessionPlumbing({ catSessions: [cat] });
    plumbing.executeStream.mockResolvedValue(
      (async function* stream() {
        yield Buffer.from('streamed');
      })()
    );
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });
    const chunks = [];

    for await (const chunk of await adapter.readBlobStream(oid)) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks).toString()).toBe('streamed');
    expect(plumbing.executeStream).toHaveBeenCalledTimes(1);
    expect(plumbing.openCatFileSession).not.toHaveBeenCalled();
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
  it('converts existing mktree lines into structured session entries', async () => {
    const mktree = {
      write: vi.fn().mockResolvedValue('c'.repeat(40)),
      close: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const plumbing = sessionPlumbing({ mktreeSession: mktree });
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.writeTree([`${'100644'} blob ${'d'.repeat(40)}\tpage`])).resolves.toBe(
      'c'.repeat(40)
    );

    expect(mktree.write).toHaveBeenCalledWith([
      { mode: '100644', type: 'blob', oid: 'd'.repeat(40), name: 'page' },
    ]);
    expect(plumbing.execute).not.toHaveBeenCalled();
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

    expect(cat.close).toHaveBeenCalledTimes(1);
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
      const retired = deferred();
      const cat = fakeCatSession({
        info: vi.fn().mockResolvedValue({ oid, type: 'blob', size: 1 }),
        close: vi.fn().mockReturnValue(retired.promise),
      });
      const adapter = new GitPersistenceAdapter({
        plumbing: sessionPlumbing({ catSessions: [cat] }),
        policy: noPolicy,
        sessionIdleTimeoutMs: 10,
      });

      await adapter.readObjectType(oid);
      await vi.advanceTimersByTimeAsync(10);
      let closeSettled = false;
      const close = adapter.close().then(() => {
        closeSettled = true;
      });
      await Promise.resolve();

      expect(closeSettled).toBe(false);
      retired.resolve();
      await close;
      expect(closeSettled).toBe(true);
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
