/**
 * Integration tests for the domain stack without a Git binary.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../src/domain/services/CasService.js';
import JsonCodec from '../../src/infrastructure/codecs/JsonCodec.js';
import FixedChunker from '../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import SilentObserver from '../../src/infrastructure/adapters/SilentObserver.js';
import { getTestCryptoAdapter } from '../helpers/crypto-adapter.js';
import MemoryPersistenceAdapter from '../helpers/MemoryPersistenceAdapter.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: npm run test:integration:node',
  );
}

vi.setConfig({
  testTimeout: 15000,
  hookTimeout: 30000,
});

const testCrypto = await getTestCryptoAdapter();

async function* source(bytes) {
  yield bytes;
}

function makeMemoryService() {
  return new CasService({
    persistence: new MemoryPersistenceAdapter(),
    crypto: testCrypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunkSize: 1024,
    merkleThreshold: 1000,
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
}

describe('memory-backed domain integration', () => {
  it('stores, publishes, reads, and restores Merkle content without Git', async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    try {
      const service = makeMemoryService();
      const original = randomBytes(4096);
      const manifest = await service.store({
        source: source(original),
        slug: 'memory/integration',
        filename: 'integration.bin',
        merkleThreshold: 2,
      });

      const treeOid = await service.createTree({ manifest });
      const raw = await service.readManifestRaw({ treeOid });
      const readBack = await service.readManifest({ treeOid });
      const restored = await service.restore({ manifest: readBack });

      expect(raw.version).toBe(2);
      expect(raw.subManifests.length).toBeGreaterThan(0);
      expect(Buffer.from(restored.buffer).equals(original)).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
