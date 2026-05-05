import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../src/domain/services/CasService.js';
import JsonCodec from '../../../src/infrastructure/codecs/JsonCodec.js';
import FixedChunker from '../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import SilentObserver from '../../../src/infrastructure/adapters/SilentObserver.js';
import { getTestCryptoAdapter } from '../../helpers/crypto-adapter.js';
import MemoryPersistenceAdapter from '../../helpers/MemoryPersistenceAdapter.js';

const testCrypto = await getTestCryptoAdapter();

async function* source(bytes) {
  yield bytes;
}

function makeService(persistence) {
  return new CasService({
    persistence,
    crypto: testCrypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunkSize: 1024,
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
}

function expectBytesEqual(actual, expected) {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBe(expected[index]);
  }
}

describe('MemoryPersistenceAdapter', () => {
  it('proves a CasService domain workflow without Git subprocesses', async () => {
    const persistence = new MemoryPersistenceAdapter();
    const service = makeService(persistence);
    const original = randomBytes(4096);

    const manifest = await service.store({
      source: source(original),
      slug: 'memory/demo',
      filename: 'demo.bin',
    });
    const treeOid = await service.createTree({ manifest });
    const readBack = await service.readManifest({ treeOid });
    const { buffer } = await service.restore({ manifest: readBack });

    expect(readBack.slug).toBe('memory/demo');
    expect(persistence.blobCount).toBeGreaterThan(0);
    expect(persistence.treeCount).toBe(1);
    expectBytesEqual(buffer, original);
  });
});
