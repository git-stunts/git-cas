import { describe, it, expect } from 'vitest';
import GitPersistencePort from '../../../src/ports/GitPersistencePort.js';

describe('GitPersistencePort – abstract methods', () => {
  const port = new GitPersistencePort();

  it('writeBlob() throws Not implemented', async () => {
    await expect(port.writeBlob(Buffer.alloc(0))).rejects.toThrow('Not implemented');
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
});
