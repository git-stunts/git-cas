import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import ContentAddressableStore, { FixedChunker, CdcChunker, ChunkingPort } from '../../../index.js';
import RedactingObservability from '../../../src/domain/services/RedactingObservability.js';

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

function streamOneBuffer(buffer) {
  return {
    async *[Symbol.asyncIterator]() {
      yield buffer;
    },
  };
}

function memoryPlumbing() {
  const blobs = new Map();
  return {
    execute: vi.fn(async ({ args, input }) => {
      if (args[0] === 'hash-object') {
        const bytes = Buffer.from(input);
        const oid = createHash('sha1').update('blob').update('\0').update(bytes).digest('hex');
        blobs.set(oid, bytes);
        return oid;
      }
      throw new Error(`Unexpected plumbing execute: ${args.join(' ')}`);
    }),
    executeStream: vi.fn(async ({ args }) => {
      if (args[0] === 'cat-file' && args[1] === 'blob') {
        const blob = blobs.get(args[2]);
        if (!blob) {
          throw new Error(`Missing blob ${args[2]}`);
        }
        return streamOneBuffer(blob);
      }
      throw new Error(`Unexpected plumbing stream: ${args.join(' ')}`);
    }),
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

describe('Facade – per-operation chunking', () => {
  it('allows one store operation to use CDC without changing the facade default chunker', async () => {
    const store = new ContentAddressableStore({
      plumbing: memoryPlumbing(),
      chunking: { strategy: 'fixed', chunkSize: 1024 },
    });

    const manifest = await store.store({
      source: streamOneBuffer(Buffer.alloc(8192, 'A')),
      slug: 'asset/cdc-once',
      filename: 'asset.bin',
      chunking: {
        strategy: 'cdc',
        targetChunkSize: 1024,
        minChunkSize: 256,
        maxChunkSize: 4096,
      },
    });
    const service = await store.getService();

    expect(service.chunker.strategy).toBe('fixed');
    expect(manifest.chunking?.strategy).toBe('cdc');
  });

  it('allows one store operation to use default fixed chunking over a CDC facade default', async () => {
    const store = new ContentAddressableStore({
      plumbing: memoryPlumbing(),
      chunking: {
        strategy: 'cdc',
        targetChunkSize: 1024,
        minChunkSize: 256,
        maxChunkSize: 4096,
      },
    });

    const manifest = await store.store({
      source: streamOneBuffer(Buffer.alloc(8192, 'A')),
      slug: 'asset/fixed-once',
      filename: 'asset.bin',
      chunking: { strategy: 'fixed' },
    });
    const service = await store.getService();

    expect(service.chunker.strategy).toBe('cdc');
    expect(manifest.chunking).toBeUndefined();
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
    expect(svc.observability).toBeInstanceOf(RedactingObservability);
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
    expect(svc.observability).toBeInstanceOf(RedactingObservability);
    expect(svc.compressionAdapter).toBe(compressionAdapter);
    expect(svc.merkleThreshold).toBe(9);
    expect(svc.concurrency).toBe(4);
    expect(svc.maxRestoreBufferSize).toBe(8192);
  });
});
