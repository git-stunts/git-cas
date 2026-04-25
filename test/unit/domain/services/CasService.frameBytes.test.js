import { describe, it, expect, vi } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();

function createService() {
  return new CasService({
    persistence: {
      writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)),
      writeTree: vi.fn().mockResolvedValue('a'.repeat(40)),
    },
    crypto: testCrypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    chunker: new FixedChunker({ chunkSize: 256 * 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
  });
}

// ---------------------------------------------------------------------------
// frameBytes upper bound
// ---------------------------------------------------------------------------
describe('CasService – frameBytes upper bound', () => {
  it('accepts default frameBytes (64 KiB)', () => {
    const svc = createService();
    expect(() => svc._resolveFramedStoreEncryptionConfig(undefined)).not.toThrow();
  });

  it('accepts 64 MiB frameBytes', () => {
    const svc = createService();
    expect(() => svc._resolveFramedStoreEncryptionConfig(64 * 1024 * 1024)).not.toThrow();
  });

  it('rejects frameBytes exceeding 64 MiB', () => {
    const svc = createService();
    expect(() => svc._resolveFramedStoreEncryptionConfig(64 * 1024 * 1024 + 1)).toThrow(/frameBytes/i);
  });

  it('rejects Number.MAX_SAFE_INTEGER', () => {
    const svc = createService();
    expect(() => svc._resolveFramedStoreEncryptionConfig(Number.MAX_SAFE_INTEGER)).toThrow(/frameBytes/i);
  });
});
