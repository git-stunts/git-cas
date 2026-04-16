import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import { storeFile, restoreFile } from '../../../../src/infrastructure/adapters/FileIOHelper.js';

const testCrypto = await getTestCryptoAdapter();

function createStoreCaptureService(capture) {
  return {
    async store(opts) {
      const chunks = [];
      for await (const chunk of opts.source) {
        chunks.push(chunk);
      }
      capture({ ...opts, source: Buffer.concat(chunks) });
      return { slug: opts.slug };
    },
  };
}

function createDrainStoreService(capture) {
  return {
    async store(opts) {
      // eslint-disable-next-line no-unused-vars
      for await (const _ of opts.source) { /* drain */ }
      capture(opts);
      return {};
    },
  };
}

function createBlobBackedService({ chunkSize = 1024, maxRestoreBufferSize } = {}) {
  const blobStore = new Map();
  const service = new CasService({
    persistence: {
      writeBlob: async (content) => {
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
        const oid = await testCrypto.sha256(buf);
        blobStore.set(oid, buf);
        return oid;
      },
      writeTree: async () => 'mock-tree-oid',
      readBlob: async (oid) => blobStore.get(oid),
      readBlobStream: async (oid) => (async function* blobSource() {
        const buf = blobStore.get(oid);
        if (buf) {
          yield buf;
        }
      })(),
      readTree: async () => [],
    },
    crypto: testCrypto,
    codec: new JsonCodec(),
    chunkSize,
    maxRestoreBufferSize,
    observability: new SilentObserver(),
  });

  return { service, blobStore };
}

async function collectStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function useTempDir(prefix) {
  let tmpDir;
  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), prefix)); });
  afterEach(() => { if (tmpDir) { rmSync(tmpDir, { recursive: true, force: true }); } });
  return () => tmpDir;
}

async function storeBufferManifest(service, plaintext, options) {
  async function* source() {
    yield plaintext;
  }

  return await service.store({
    source: source(),
    ...options,
  });
}

async function expectRestoreStreamTooLarge(service, manifest, encryptionKey) {
  await expect(
    collectStream(service.restoreStream({ manifest, encryptionKey })),
  ).rejects.toMatchObject({ code: 'RESTORE_TOO_LARGE' });
}

describe('FileIOHelper – storeFile stream forwarding', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fio-store-')); });
  afterEach(() => { if (tmpDir) { rmSync(tmpDir, { recursive: true, force: true }); } });

  it('passes a readable stream and options to service.store()', async () => {
    const filePath = path.join(tmpDir, 'input.bin');
    const data = Buffer.from('hello storeFile');
    writeFileSync(filePath, data);

    let capturedOpts;
    const mockService = createStoreCaptureService((opts) => {
      capturedOpts = opts;
    });

    const result = await storeFile(mockService, { filePath, slug: 'test-slug' });
    expect(result).toEqual({ slug: 'test-slug' });
    expect(capturedOpts.source.equals(data)).toBe(true);
    expect(capturedOpts.slug).toBe('test-slug');
    expect(capturedOpts.filename).toBe('input.bin');
  });

});

describe('FileIOHelper – storeFile option forwarding', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fio-store-')); });
  afterEach(() => { if (tmpDir) { rmSync(tmpDir, { recursive: true, force: true }); } });

  it('uses filename override when provided', async () => {
    const filePath = path.join(tmpDir, 'input.bin');
    writeFileSync(filePath, 'data');

    let capturedFilename;
    const mockService = createDrainStoreService((opts) => {
      capturedFilename = opts.filename;
    });

    await storeFile(mockService, { filePath, slug: 's', filename: 'custom.dat' });
    expect(capturedFilename).toBe('custom.dat');
  });

  it('forwards explicit encryption options to service.store()', async () => {
    const filePath = path.join(tmpDir, 'input.bin');
    writeFileSync(filePath, 'data');

    let capturedEncryption;
    const mockService = createDrainStoreService((opts) => {
      capturedEncryption = opts.encryption;
    });

    await storeFile(mockService, {
      filePath,
      slug: 's',
      encryption: { scheme: 'framed-v1', frameBytes: 32 },
    });

    expect(capturedEncryption).toEqual({ scheme: 'framed-v1', frameBytes: 32 });
  });
});

describe('FileIOHelper – restoreFile stream publication', () => {
  const getTmpDir = useTempDir('fio-restore-');

  it('writes restored chunks to the output path and counts bytes', async () => {
    const outputPath = path.join(getTmpDir(), 'output.bin');
    const chunk1 = Buffer.from('hello ');
    const chunk2 = Buffer.from('world');

    const mockService = {
      async createFileRestorePlan() {
        return {
          mode: 'stream',
          source: (async function* gen() {
            yield chunk1;
            yield chunk2;
          })(),
        };
      },
    };

    const { bytesWritten } = await restoreFile(mockService, {
      manifest: {},
      outputPath,
    });

    expect(bytesWritten).toBe(11);
    const written = readFileSync(outputPath);
    expect(written.toString()).toBe('hello world');
  });
});

describe('FileIOHelper – restoreFile bounded publication seam', () => {
  const getTmpDir = useTempDir('fio-restore-');

  it('uses createFileRestorePlan() for bounded-file publication without underscore helpers', async () => {
    const outputPath = path.join(getTmpDir(), 'bounded.bin');
    const chunk = Buffer.from('bounded restore source');

    const mockService = {
      observability: new SilentObserver(),
      async createFileRestorePlan() {
        return {
          mode: 'bounded-file',
          source: (async function* gen() {
            yield chunk;
          })(),
        };
      },
    };

    const { bytesWritten } = await restoreFile(mockService, {
      manifest: { slug: 'bounded', chunks: [{}] },
      outputPath,
    });

    expect(bytesWritten).toBe(chunk.length);
    const written = readFileSync(outputPath);
    expect(written.equals(chunk)).toBe(true);
  });
});

describe('FileIOHelper – restoreFile bounded whole-v1 encrypted path', () => {
  const getTmpDir = useTempDir('fio-bounded-restore-');

  it('restores large whole-v1 encrypted content to a file even when restoreStream() is buffer-limited', async () => {
    const { service } = createBlobBackedService({ chunkSize: 1024, maxRestoreBufferSize: 1024 });
    const key = Buffer.alloc(32, 0xab);
    const plaintext = Buffer.alloc(4096, 'z');
    const manifest = await storeBufferManifest(service, plaintext, {
      slug: 'whole-v1-large',
      filename: 'whole-v1-large.bin',
      encryptionKey: key,
      encryption: { scheme: 'whole-v1' },
    });

    await expectRestoreStreamTooLarge(service, manifest, key);

    const outputPath = path.join(getTmpDir(), 'whole-v1-large.bin');
    const { bytesWritten } = await restoreFile(service, {
      manifest,
      encryptionKey: key,
      outputPath,
    });

    expect(bytesWritten).toBe(plaintext.length);
    expect(readFileSync(outputPath).equals(plaintext)).toBe(true);
  });
});

describe('FileIOHelper – restoreFile bounded whole-v1 compressed path', () => {
  const getTmpDir = useTempDir('fio-bounded-restore-');

  it('restores large whole-v1 encrypted + compressed content to a file even when restoreStream() is buffer-limited', async () => {
    const { service } = createBlobBackedService({ chunkSize: 1024, maxRestoreBufferSize: 1024 });
    const key = Buffer.alloc(32, 0xcd);
    const plaintext = Buffer.alloc(8192, 'A');
    const manifest = await storeBufferManifest(service, plaintext, {
      slug: 'whole-v1-compressed-large',
      filename: 'whole-v1-compressed-large.bin',
      encryptionKey: key,
      encryption: { scheme: 'whole-v1' },
      compression: { algorithm: 'gzip' },
    });

    await expectRestoreStreamTooLarge(service, manifest, key);

    const outputPath = path.join(getTmpDir(), 'whole-v1-compressed-large.bin');
    const { bytesWritten } = await restoreFile(service, {
      manifest,
      encryptionKey: key,
      outputPath,
    });

    expect(bytesWritten).toBe(plaintext.length);
    expect(readFileSync(outputPath).equals(plaintext)).toBe(true);
  });
});

describe('FileIOHelper – restoreFile bounded whole-v1 auth cleanup', () => {
  const getTmpDir = useTempDir('fio-bounded-restore-');

  it('does not publish a partial destination file when whole-v1 decryption fails', async () => {
    const { service } = createBlobBackedService({ chunkSize: 1024, maxRestoreBufferSize: 1024 });
    const key = Buffer.alloc(32, 0xef);
    const wrongKey = Buffer.alloc(32, 0x11);
    const plaintext = Buffer.from('whole-v1 auth boundary');
    const manifest = await storeBufferManifest(service, plaintext, {
      slug: 'whole-v1-auth-failure',
      filename: 'whole-v1-auth-failure.bin',
      encryptionKey: key,
      encryption: { scheme: 'whole-v1' },
    });

    const outputPath = path.join(getTmpDir(), 'whole-v1-auth-failure.bin');
    await expect(
      restoreFile(service, {
        manifest,
        encryptionKey: wrongKey,
        outputPath,
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });

    expect(existsSync(outputPath)).toBe(false);
    expect(readdirSync(getTmpDir()).filter((name) => name.startsWith('.git-cas-restore-'))).toEqual([]);
  });
});
