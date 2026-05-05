import { describe, it, expect, vi } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import CdcChunker from '../../../../src/infrastructure/chunkers/CdcChunker.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';

const testCrypto = await getTestCryptoAdapter();

function makeObserver() {
  return {
    metric: vi.fn(),
    log: vi.fn(),
    span: vi.fn().mockReturnValue({ end: vi.fn() }),
  };
}

function makeService(chunker, observability) {
  return new CasService({
    persistence: { writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)), writeTree: vi.fn(), readBlob: vi.fn() },
    crypto: testCrypto,
    codec: new JsonCodec(),
    chunkSize: 1024,
    observability,
    chunker,
    compressionAdapter: new NodeCompressionAdapter(),
  });
}

describe('CasService — CDC convergent auto-selection warning', () => {
  it('warns when CDC + encryption auto-selects deterministic convergent mode', async () => {
    const obs = makeObserver();
    const service = makeService(new CdcChunker({ minChunkSize: 1024, targetChunkSize: 2048, maxChunkSize: 4096 }), obs);
    const key = Buffer.alloc(32, 0xab);

    async function* source() { yield Buffer.alloc(2048, 0xcc); }
    await service.store({ source: source(), slug: 'enc-cdc', filename: 'f.bin', encryptionKey: key });

    const warnCalls = obs.log.mock.calls.filter((c) => c[0] === 'warn' && c[1].includes('auto-selected deterministic convergent encryption'));
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][2]).toEqual({
      strategy: 'cdc',
      selectedScheme: 'convergent',
      deterministic: true,
      optOut: 'Use encryption.scheme "framed" or "whole", or encryption.convergent false.',
    });
  });
});

describe('CasService — CDC + encryption dedup warning', () => {
  it('does NOT warn for CDC + encryption when convergent is active (default)', async () => {
    const obs = makeObserver();
    const service = makeService(new CdcChunker({ minChunkSize: 1024, targetChunkSize: 2048, maxChunkSize: 4096 }), obs);
    const key = Buffer.alloc(32, 0xab);

    async function* source() { yield Buffer.alloc(2048, 0xcc); }
    await service.store({ source: source(), slug: 'enc-cdc', filename: 'f.bin', encryptionKey: key });

    const warnCalls = obs.log.mock.calls.filter((c) => c[0] === 'warn' && c[1].includes('CDC deduplication'));
    expect(warnCalls).toHaveLength(0);
  });

  it('emits warning when encryption + CDC with convergent disabled', async () => {
    const obs = makeObserver();
    const service = makeService(new CdcChunker({ minChunkSize: 1024, targetChunkSize: 2048, maxChunkSize: 4096 }), obs);
    const key = Buffer.alloc(32, 0xab);

    async function* source() { yield Buffer.alloc(2048, 0xcc); }
    await service.store({ source: source(), slug: 'enc-cdc', filename: 'f.bin', encryptionKey: key, encryption: { convergent: false } });

    const warnCalls = obs.log.mock.calls.filter((c) => c[0] === 'warn' && c[1].includes('CDC deduplication'));
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][2]).toEqual({ strategy: 'cdc' });
  });

  it('does NOT warn for encryption + fixed chunking', async () => {
    const obs = makeObserver();
    const service = makeService(new FixedChunker({ chunkSize: 1024 }), obs);
    const key = Buffer.alloc(32, 0xab);

    async function* source() { yield Buffer.alloc(2048, 0xcc); }
    await service.store({ source: source(), slug: 'enc-fixed', filename: 'f.bin', encryptionKey: key });

    const warnCalls = obs.log.mock.calls.filter((c) => c[0] === 'warn' && c[1].includes('CDC deduplication'));
    expect(warnCalls).toHaveLength(0);
  });

  it('does NOT warn for CDC without encryption', async () => {
    const obs = makeObserver();
    const service = makeService(new CdcChunker({ minChunkSize: 1024, targetChunkSize: 2048, maxChunkSize: 4096 }), obs);

    async function* source() { yield Buffer.alloc(2048, 0xcc); }
    await service.store({ source: source(), slug: 'plain-cdc', filename: 'f.bin' });

    const warnCalls = obs.log.mock.calls.filter((c) => c[0] === 'warn' && c[1].includes('CDC deduplication'));
    expect(warnCalls).toHaveLength(0);
  });
});
