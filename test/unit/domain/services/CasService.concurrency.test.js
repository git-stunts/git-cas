import { describe, it, expect, vi } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';

const testCrypto = await getTestCryptoAdapter();

function createService(concurrency) {
  return new CasService({
    persistence: {
      writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)),
      writeTree: vi.fn().mockResolvedValue('a'.repeat(40)),
    },
    crypto: testCrypto,
    codec: new JsonCodec(),
    observability: new SilentObserver(),
    concurrency,
  });
}

describe('CasService – concurrency upper bound', () => {
  it('accepts concurrency of 1', () => {
    expect(() => createService(1)).not.toThrow();
  });

  it('accepts concurrency of 64', () => {
    expect(() => createService(64)).not.toThrow();
  });

  it('rejects concurrency exceeding 64', () => {
    expect(() => createService(65)).toThrow(/concurrency/i);
  });

  it('rejects concurrency of 1000000', () => {
    expect(() => createService(1_000_000)).toThrow(/concurrency/i);
  });
});
