import { describe, it, expect } from 'vitest';
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
  it('writes trees sequentially in input order', async () => {
    const calls = [];
    const port = new GitPersistencePort();
    port.writeTree = async (entries) => {
      calls.push(entries);
      return `tree-${calls.length}`;
    };

    await expect(port.writeTrees([['first'], ['second']])).resolves.toEqual([
      'tree-1',
      'tree-2',
    ]);
    expect(calls).toEqual([['first'], ['second']]);
  });

  it('reads metadata sequentially in input order', async () => {
    const port = new GitPersistencePort();
    port.readObjectType = async (oid) => (oid === 'tree-oid' ? 'tree' : 'blob');
    port.readObjectSize = async (oid) => oid.length;

    await expect(port.readObjectInfos(['tree-oid', 'blob-oid'])).resolves.toEqual([
      { oid: 'tree-oid', type: 'tree', size: 8 },
      { oid: 'blob-oid', type: 'blob', size: 8 },
    ]);
  });
});
