import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FixedChunkingSchema,
  CdcChunkingSchema,
  ChunkingSchema,
} from '../../../../src/domain/schemas/ManifestSchema.js';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';

const testCrypto = await getTestCryptoAdapter();

// ---------------------------------------------------------------------------
// FixedChunkingSchema
// ---------------------------------------------------------------------------
describe('FixedChunkingSchema', () => {
  it('accepts valid fixed chunking', () => {
    const data = { strategy: 'fixed', params: { chunkSize: 262144 } };
    expect(() => FixedChunkingSchema.parse(data)).not.toThrow();
  });

  it('rejects non-positive chunkSize', () => {
    const data = { strategy: 'fixed', params: { chunkSize: 0 } };
    expect(() => FixedChunkingSchema.parse(data)).toThrow();
  });

  it('rejects non-integer chunkSize', () => {
    const data = { strategy: 'fixed', params: { chunkSize: 1.5 } };
    expect(() => FixedChunkingSchema.parse(data)).toThrow();
  });

  it('rejects negative chunkSize', () => {
    const data = { strategy: 'fixed', params: { chunkSize: -100 } };
    expect(() => FixedChunkingSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CdcChunkingSchema
// ---------------------------------------------------------------------------
describe('CdcChunkingSchema', () => {
  it('accepts valid CDC chunking', () => {
    const data = {
      strategy: 'cdc',
      params: { target: 262144, min: 65536, max: 1048576 },
    };
    expect(() => CdcChunkingSchema.parse(data)).not.toThrow();
  });

  it('rejects non-positive target', () => {
    const data = {
      strategy: 'cdc',
      params: { target: 0, min: 65536, max: 1048576 },
    };
    expect(() => CdcChunkingSchema.parse(data)).toThrow();
  });

  it('rejects missing min', () => {
    const data = { strategy: 'cdc', params: { target: 262144, max: 1048576 } };
    expect(() => CdcChunkingSchema.parse(data)).toThrow();
  });

  it('rejects missing max', () => {
    const data = { strategy: 'cdc', params: { target: 262144, min: 65536 } };
    expect(() => CdcChunkingSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ChunkingSchema (discriminated union)
// ---------------------------------------------------------------------------
describe('ChunkingSchema', () => {
  it('accepts valid fixed chunking', () => {
    const data = { strategy: 'fixed', params: { chunkSize: 262144 } };
    const result = ChunkingSchema.parse(data);
    expect(result.strategy).toBe('fixed');
    expect(result.params.chunkSize).toBe(262144);
  });

  it('accepts valid CDC chunking', () => {
    const data = {
      strategy: 'cdc',
      params: { target: 262144, min: 65536, max: 1048576 },
    };
    const result = ChunkingSchema.parse(data);
    expect(result.strategy).toBe('cdc');
    expect(result.params.target).toBe(262144);
  });

  it('rejects unknown strategy', () => {
    const data = { strategy: 'unknown', params: {} };
    expect(() => ChunkingSchema.parse(data)).toThrow();
  });

  it('rejects missing params for cdc', () => {
    const data = { strategy: 'cdc' };
    expect(() => ChunkingSchema.parse(data)).toThrow();
  });

  it('rejects wrong params for fixed strategy (target instead of chunkSize)', () => {
    const data = { strategy: 'fixed', params: { target: 256 } };
    expect(() => ChunkingSchema.parse(data)).toThrow();
  });

  it('rejects missing strategy field', () => {
    const data = { params: { chunkSize: 262144 } };
    expect(() => ChunkingSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// INVALID_CHUNKING_STRATEGY error code
// ---------------------------------------------------------------------------
describe('CasService – _validateChunking', () => {
  let service;

  beforeEach(() => {
    service = new CasService({
      persistence: {
        writeBlob: vi.fn().mockResolvedValue('mock-blob-oid'),
        writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
        readBlob: vi.fn().mockResolvedValue(Buffer.from('data')),
      },
      crypto: testCrypto,
      codec: new JsonCodec(),
      chunkSize: 1024,
      observability: new SilentObserver(),
    });
  });

  it('does not throw when chunking is undefined', () => {
    expect(() => service._validateChunking(undefined)).not.toThrow();
  });

  it('does not throw for strategy "fixed"', () => {
    expect(() => service._validateChunking({ strategy: 'fixed', params: { chunkSize: 262144 } })).not.toThrow();
  });

  it('does not throw for strategy "cdc"', () => {
    expect(() => service._validateChunking({ strategy: 'cdc', params: { target: 262144, min: 65536, max: 1048576 } })).not.toThrow();
  });

  it('throws INVALID_CHUNKING_STRATEGY for unknown strategy', () => {
    try {
      service._validateChunking({ strategy: 'rolling', params: {} });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe('INVALID_CHUNKING_STRATEGY');
      expect(err.message).toMatch(/Unsupported chunking strategy: rolling/);
      expect(err.meta.strategy).toBe('rolling');
    }
  });
});
