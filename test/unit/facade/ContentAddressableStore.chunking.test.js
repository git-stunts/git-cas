import { describe, it, expect, vi } from 'vitest';
import ContentAddressableStore, {
  FixedChunker,
  CdcChunker,
  ChunkingPort,
} from '../../../index.js';

// ---------------------------------------------------------------------------
// Helpers — mock plumbing to avoid real Git
// ---------------------------------------------------------------------------

function mockPlumbing() {
  return {
    hashObject: vi.fn(),
    catFile: vi.fn(),
    mktree: vi.fn(),
    lstree: vi.fn(),
    updateRef: vi.fn(),
    showRef: vi.fn(),
  };
}

function mockObservability() {
  return {
    metric: vi.fn(),
    log: vi.fn(),
    span: vi.fn(() => ({ end: vi.fn() })),
  };
}

function mockCompressionAdapter() {
  return {
    compressBuffer: vi.fn(async (buffer) => buffer),
    decompressBuffer: vi.fn(async (buffer) => buffer),
    compressStream: vi.fn((source) => source),
    decompressStream: vi.fn((source) => source),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
describe('Facade – exports', () => {
  it('exports FixedChunker', () => {
    expect(FixedChunker).toBeDefined();
    expect(new FixedChunker()).toBeInstanceOf(ChunkingPort);
  });

  it('exports CdcChunker', () => {
    expect(CdcChunker).toBeDefined();
    expect(new CdcChunker()).toBeInstanceOf(ChunkingPort);
  });

  it('exports ChunkingPort', () => {
    expect(ChunkingPort).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// chunking config — fixed strategy
// ---------------------------------------------------------------------------
describe('Facade – fixed chunking config', () => {
  it('no chunking option creates store with default FixedChunker', async () => {
    const store = new ContentAddressableStore({ plumbing: mockPlumbing() });
    const svc = await store.getService();
    expect(svc.chunker).toBeInstanceOf(FixedChunker);
    expect(svc.chunker.strategy).toBe('fixed');
  });

  it('chunking: { strategy: "fixed" } creates FixedChunker', async () => {
    const store = new ContentAddressableStore({
      plumbing: mockPlumbing(),
      chunking: { strategy: 'fixed', chunkSize: 131072 },
    });
    const svc = await store.getService();
    expect(svc.chunker).toBeInstanceOf(FixedChunker);
    expect(svc.chunker.params).toEqual({ chunkSize: 131072 });
  });

  it('chunking: { strategy: "fixed" } without chunkSize uses default', async () => {
    const store = new ContentAddressableStore({
      plumbing: mockPlumbing(),
      chunking: { strategy: 'fixed' },
    });
    const svc = await store.getService();
    expect(svc.chunker).toBeInstanceOf(FixedChunker);
    expect(svc.chunker.strategy).toBe('fixed');
  });
});

// ---------------------------------------------------------------------------
// chunking config — cdc strategy
// ---------------------------------------------------------------------------
describe('Facade – cdc chunking config', () => {
  it('chunking: { strategy: "cdc" } creates CdcChunker', async () => {
    const store = new ContentAddressableStore({
      plumbing: mockPlumbing(),
      chunking: {
        strategy: 'cdc',
        targetChunkSize: 262144,
        minChunkSize: 65536,
        maxChunkSize: 1048576,
      },
    });
    const svc = await store.getService();
    expect(svc.chunker).toBeInstanceOf(CdcChunker);
    expect(svc.chunker.strategy).toBe('cdc');
    expect(svc.chunker.params).toEqual({
      target: 262144,
      min: 65536,
      max: 1048576,
      normalized: true,
    });
  });

  it('chunking: { strategy: "cdc" } with defaults works', async () => {
    const store = new ContentAddressableStore({
      plumbing: mockPlumbing(),
      chunking: { strategy: 'cdc' },
    });
    const svc = await store.getService();
    expect(svc.chunker).toBeInstanceOf(CdcChunker);
    expect(svc.chunker.params).toEqual({
      target: 262144,
      min: 65536,
      max: 1048576,
      normalized: true,
    });
  });
});

// ---------------------------------------------------------------------------
// chunking config — raw chunker option
// ---------------------------------------------------------------------------
describe('Facade – raw chunker option', () => {
  it('chunker option (raw ChunkingPort) takes precedence over chunking', async () => {
    const customChunker = new CdcChunker({
      targetChunkSize: 512000,
      minChunkSize: 128000,
      maxChunkSize: 2048000,
    });
    const store = new ContentAddressableStore({
      plumbing: mockPlumbing(),
      chunking: { strategy: 'fixed', chunkSize: 1024 },
      chunker: customChunker,
    });
    const svc = await store.getService();
    expect(svc.chunker).toBe(customChunker);
    expect(svc.chunker.strategy).toBe('cdc');
  });
});

describe('Facade – createJson factory options', () => {
  it('createJson forwards advanced facade options', async () => {
    const observability = mockObservability();
    const compressionAdapter = mockCompressionAdapter();
    const chunker = new CdcChunker({ targetChunkSize: 131072 });
    const store = ContentAddressableStore.createJson({
      plumbing: mockPlumbing(),
      chunker,
      observability,
      compressionAdapter,
      merkleThreshold: 7,
      concurrency: 3,
      maxRestoreBufferSize: 4096,
    });

    const svc = await store.getService();

    expect(svc.codec.extension).toBe('json');
    expect(svc.chunker).toBe(chunker);
    expect(svc.observability).toBe(observability);
    expect(svc.compressionAdapter).toBe(compressionAdapter);
    expect(svc.merkleThreshold).toBe(7);
    expect(svc.concurrency).toBe(3);
    expect(svc.maxRestoreBufferSize).toBe(4096);
  });
});

describe('Facade – createCbor factory options', () => {
  it('createCbor forwards advanced facade options', async () => {
    const observability = mockObservability();
    const compressionAdapter = mockCompressionAdapter();
    const store = ContentAddressableStore.createCbor({
      plumbing: mockPlumbing(),
      chunking: { strategy: 'fixed', chunkSize: 2048 },
      observability,
      compressionAdapter,
      merkleThreshold: 9,
      concurrency: 4,
      maxRestoreBufferSize: 8192,
    });

    const svc = await store.getService();

    expect(svc.codec.extension).toBe('cbor');
    expect(svc.chunker).toBeInstanceOf(FixedChunker);
    expect(svc.chunker.params).toEqual({ chunkSize: 2048 });
    expect(svc.observability).toBe(observability);
    expect(svc.compressionAdapter).toBe(compressionAdapter);
    expect(svc.merkleThreshold).toBe(9);
    expect(svc.concurrency).toBe(4);
    expect(svc.maxRestoreBufferSize).toBe(8192);
  });
});
