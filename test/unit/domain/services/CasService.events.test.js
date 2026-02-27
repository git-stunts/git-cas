import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import CasService from '../../../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import EventEmitterObserver from '../../../../src/infrastructure/adapters/EventEmitterObserver.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import CasError from '../../../../src/domain/errors/CasError.js';

function setup() {
  const crypto = new NodeCryptoAdapter();
  const blobStore = new Map();
  const observer = new EventEmitterObserver();

  const mockPersistence = {
    writeBlob: vi.fn().mockImplementation(async (content) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const oid = await crypto.sha256(buf);
      blobStore.set(oid, buf);
      return oid;
    }),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockImplementation(async (oid) => {
      const buf = blobStore.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return buf;
    }),
  };

  const service = new CasService({
    persistence: mockPersistence,
    crypto,
    codec: new JsonCodec(),
    observability: observer,
    chunkSize: 1024,
  });

  return { crypto, blobStore, mockPersistence, service, observer };
}

async function storeBuffer(svc, buf, opts = {}) {
  async function* source() { yield buf; }
  return svc.store({
    source: source(),
    slug: opts.slug || 'test',
    filename: opts.filename || 'test.bin',
    encryptionKey: opts.encryptionKey,
  });
}

describe('CasService events – chunk:stored', () => {
  it('emits chunk:stored per chunk with correct payload', async () => {
    const { service, observer } = setup();
    const onChunkStored = vi.fn();
    observer.on('chunk:stored', onChunkStored);

    await storeBuffer(service, randomBytes(2048));

    expect(onChunkStored).toHaveBeenCalledTimes(2);
    expect(onChunkStored).toHaveBeenNthCalledWith(1, expect.objectContaining({
      index: 0, size: 1024, digest: expect.any(String), blob: expect.any(String),
    }));
    expect(onChunkStored).toHaveBeenNthCalledWith(2, expect.objectContaining({
      index: 1, size: 1024, digest: expect.any(String), blob: expect.any(String),
    }));
  });
});

describe('CasService events – file:stored', () => {
  it('emits file:stored once with correct payload', async () => {
    const { service, observer } = setup();
    const onFileStored = vi.fn();
    observer.on('file:stored', onFileStored);

    await storeBuffer(service, randomBytes(2048));

    expect(onFileStored).toHaveBeenCalledTimes(1);
    expect(onFileStored).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'test', size: 2048, chunkCount: 2, encrypted: false,
    }));
  });

  it('emits encrypted=true when encryption used', async () => {
    const { service, observer } = setup();
    const onFileStored = vi.fn();
    observer.on('file:stored', onFileStored);

    await storeBuffer(service, randomBytes(1024), { encryptionKey: randomBytes(32) });

    expect(onFileStored).toHaveBeenCalledWith(expect.objectContaining({ encrypted: true }));
  });
});

describe('CasService events – chunk:restored', () => {
  it('emits chunk:restored per chunk with correct payload', async () => {
    const { service, observer } = setup();
    const manifest = await storeBuffer(service, randomBytes(2048));

    const onChunkRestored = vi.fn();
    observer.on('chunk:restored', onChunkRestored);
    await service.restore({ manifest });

    expect(onChunkRestored).toHaveBeenCalledTimes(2);
    expect(onChunkRestored).toHaveBeenNthCalledWith(1, expect.objectContaining({
      index: 0, size: 1024, digest: expect.any(String),
    }));
    expect(onChunkRestored).toHaveBeenNthCalledWith(2, expect.objectContaining({
      index: 1, size: 1024, digest: expect.any(String),
    }));
  });
});

describe('CasService events – file:restored', () => {
  it('emits file:restored once with correct payload', async () => {
    const { service, observer } = setup();
    const manifest = await storeBuffer(service, randomBytes(2048));

    const onFileRestored = vi.fn();
    observer.on('file:restored', onFileRestored);
    await service.restore({ manifest });

    expect(onFileRestored).toHaveBeenCalledTimes(1);
    expect(onFileRestored).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'test', size: 2048, chunkCount: 2,
    }));
  });
});

describe('CasService events – integrity:pass', () => {
  it('emits integrity:pass on successful verification', async () => {
    const { service, observer } = setup();
    const manifest = await storeBuffer(service, randomBytes(2048));

    const onPass = vi.fn();
    observer.on('integrity:pass', onPass);
    await service.verifyIntegrity(manifest);

    expect(onPass).toHaveBeenCalledTimes(1);
    expect(onPass).toHaveBeenCalledWith(expect.objectContaining({ slug: 'test' }));
  });
});

describe('CasService events – integrity:fail', () => {
  it('emits integrity:fail on chunk mismatch', async () => {
    const { service, observer, blobStore } = setup();
    const manifest = await storeBuffer(service, randomBytes(2048));

    blobStore.set(manifest.chunks[0].blob, Buffer.from('corrupted'));

    const onFail = vi.fn();
    observer.on('integrity:fail', onFail);
    await service.verifyIntegrity(manifest);

    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'test', chunkIndex: 0, expected: expect.any(String), actual: expect.any(String),
    }));
  });
});

describe('CasService events – error on restore integrity failure', () => {
  it('emits error event on integrity failure during restore', async () => {
    const { service, observer, blobStore } = setup();
    const manifest = await storeBuffer(service, randomBytes(1024));

    blobStore.set(manifest.chunks[0].blob, Buffer.from('corrupted'));

    const onError = vi.fn();
    observer.on('error', onError);

    await expect(service.restore({ manifest })).rejects.toThrow(CasError);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: expect.any(String), message: expect.any(String),
    }));
  });
});

function setupSilent() {
  const crypto = new NodeCryptoAdapter();
  const blobStore = new Map();
  const mockPersistence = {
    writeBlob: vi.fn().mockImplementation(async (content) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const oid = await crypto.sha256(buf);
      blobStore.set(oid, buf);
      return oid;
    }),
    writeTree: vi.fn().mockResolvedValue('mock-tree-oid'),
    readBlob: vi.fn().mockImplementation(async (oid) => {
      const buf = blobStore.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return buf;
    }),
  };
  return new CasService({
    persistence: mockPersistence, crypto, codec: new JsonCodec(),
    observability: new SilentObserver(), chunkSize: 1024,
  });
}

describe('CasService events – no listeners attached (SilentObserver)', () => {
  it('store succeeds with SilentObserver', async () => {
    const service = setupSilent();
    await expect(storeBuffer(service, randomBytes(2048))).resolves.toBeDefined();
  });

  it('restore succeeds with SilentObserver', async () => {
    const service = setupSilent();
    const manifest = await storeBuffer(service, randomBytes(1024));
    await expect(service.restore({ manifest })).resolves.toBeDefined();
  });

  it('verifyIntegrity succeeds with SilentObserver', async () => {
    const service = setupSilent();
    const manifest = await storeBuffer(service, randomBytes(1024));
    await expect(service.verifyIntegrity(manifest)).resolves.toBe(true);
  });
});

describe('CasService events – event count verification', () => {
  it('emits 3 chunk:stored for 3-chunk file', async () => {
    const { service, observer } = setup();
    const listener = vi.fn();
    observer.on('chunk:stored', listener);
    await storeBuffer(service, randomBytes(3072));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('emits 3 chunk:restored for 3-chunk file', async () => {
    const { service, observer } = setup();
    const manifest = await storeBuffer(service, randomBytes(3072));
    const listener = vi.fn();
    observer.on('chunk:restored', listener);
    await service.restore({ manifest });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('emits 1 chunk:stored for sub-chunk file', async () => {
    const { service, observer } = setup();
    const listener = vi.fn();
    observer.on('chunk:stored', listener);
    await storeBuffer(service, randomBytes(512));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
