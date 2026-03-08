import { describe, it, expect, vi } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';

const testCrypto = await getTestCryptoAdapter();

const MiB = 1024 * 1024;

function makeService(chunkSize, observability) {
  return new CasService({
    persistence: { writeBlob: vi.fn(), writeTree: vi.fn(), readBlob: vi.fn() },
    crypto: testCrypto,
    codec: new JsonCodec(),
    chunkSize,
    observability: observability || new SilentObserver(),
  });
}

describe('CasService — chunk size upper bound', () => {
  it('throws when chunkSize > 100 MiB', () => {
    expect(() => makeService(100 * MiB + 1)).toThrow(/must not exceed/i);
  });

  it('accepts exactly 100 MiB', () => {
    const service = makeService(100 * MiB);
    expect(service.chunkSize).toBe(100 * MiB);
  });

  it('warns when chunkSize > 10 MiB', () => {
    const observability = {
      metric: vi.fn(),
      log: vi.fn(),
      span: vi.fn().mockReturnValue({ end: vi.fn() }),
    };
    makeService(11 * MiB, observability);
    expect(observability.log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('exceeds 10 MiB'),
      expect.objectContaining({ chunkSize: 11 * MiB }),
    );
  });
});
