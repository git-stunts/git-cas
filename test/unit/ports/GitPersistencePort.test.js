import { describe, it, expect, vi } from 'vitest';
import GitPersistencePort from '../../../src/ports/GitPersistencePort.js';

describe('GitPersistencePort – abstract methods', () => {
  const port = new GitPersistencePort();

  it('writeBlob() throws Not implemented', async () => {
    await expect(port.writeBlob(Buffer.alloc(0))).rejects.toThrow('Not implemented');
  });

  it('writeBlobs() preserves the writeBlob fallback contract', async () => {
    await expect(port.writeBlobs([Buffer.alloc(0)])).rejects.toThrow('Not implemented');
  });

  it('writeTree() throws Not implemented', async () => {
    await expect(port.writeTree([])).rejects.toThrow('Not implemented');
  });

  it('readBlobStream() throws Not implemented', async () => {
    await expect(port.readBlobStream('blob-oid')).rejects.toThrow('Not implemented');
  });

  it('readBlob() throws Not implemented', async () => {
    await expect(port.readBlob('blob-oid')).rejects.toThrow('Not implemented');
  });

  it('readTree() throws Not implemented', async () => {
    await expect(port.readTree('tree-oid')).rejects.toThrow('Not implemented');
  });

  it('readTreeEntry() throws Not implemented', async () => {
    await expect(port.readTreeEntry('tree-oid', 'path')).rejects.toThrow('Not implemented');
  });

  it('iterateTree() throws Not implemented', async () => {
    await expect(async () => {
      for await (const entry of port.iterateTree('tree-oid')) {
        throw new Error(`abstract iterator unexpectedly yielded ${entry}`);
      }
    }).rejects.toThrow('Not implemented');
  });

  it('readObjectType() throws Not implemented', async () => {
    await expect(port.readObjectType('object-oid')).rejects.toThrow('Not implemented');
  });

  it('readObjectSize() throws Not implemented', async () => {
    await expect(port.readObjectSize('object-oid')).rejects.toThrow('Not implemented');
  });
});

describe('GitPersistencePort batch fallbacks', () => {
  it('runs write scopes against the same custom persistence port by default', async () => {
    const port = new GitPersistencePort();

    await expect(port.withWriteScope(async (persistence) => persistence)).resolves.toBe(port);
  });

  it('writes trees sequentially in input order', async () => {
    const calls = [];
    const first = deferred();
    const second = deferred();
    const port = new GitPersistencePort();
    port.writeTree = async (entries) => {
      calls.push(entries);
      return await (calls.length === 1 ? first.promise : second.promise);
    };

    const writing = port.writeTrees([['first'], ['second']]);
    await vi.waitFor(() => expect(calls).toEqual([['first']]));
    first.resolve('tree-1');
    await vi.waitFor(() => expect(calls).toEqual([['first'], ['second']]));
    second.resolve('tree-2');

    await expect(writing).resolves.toEqual([
      'tree-1',
      'tree-2',
    ]);
    expect(calls).toEqual([['first'], ['second']]);
  });
});

describe('GitPersistencePort metadata fallback', () => {
  it('reads metadata sequentially in input order', async () => {
    const port = new GitPersistencePort();
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const calls = [];
    port.readObjectType = async (oid) => {
      calls.push(`type:${oid}`);
      return await gates[calls.length - 1].promise;
    };
    port.readObjectSize = async (oid) => {
      calls.push(`size:${oid}`);
      return await gates[calls.length - 1].promise;
    };

    const reading = port.readObjectInfos(['tree-oid', 'blob-oid']);
    await advance({ gate: gates[0], calls, expected: ['type:tree-oid'], value: 'tree' });
    await advance({
      gate: gates[1], calls, expected: ['type:tree-oid', 'size:tree-oid'], value: 8,
    });
    await advance({
      gate: gates[2],
      calls,
      expected: ['type:tree-oid', 'size:tree-oid', 'type:blob-oid'],
      value: 'blob',
    });
    await vi.waitFor(() => expect(calls).toEqual([
      'type:tree-oid', 'size:tree-oid', 'type:blob-oid', 'size:blob-oid',
    ]));
    gates[3].resolve(8);

    await expect(reading).resolves.toEqual([
      { oid: 'tree-oid', type: 'tree', size: 8 },
      { oid: 'blob-oid', type: 'blob', size: 8 },
    ]);
  });
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function advance({ gate, calls, expected, value }) {
  await vi.waitFor(() => expect(calls).toEqual(expected));
  gate.resolve(value);
}
