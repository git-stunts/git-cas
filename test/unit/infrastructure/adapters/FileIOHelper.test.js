import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import CasService from '../../../../src/domain/services/CasService.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
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
    chunker: new FixedChunker({ chunkSize }),
    compressionAdapter: new NodeCompressionAdapter(),
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

function createStreamRestoreService(chunk = Buffer.from('blocked')) {
  return {
    async createFileRestorePlan() {
      return {
        mode: 'stream',
        source: (async function* gen() {
          yield chunk;
        })(),
      };
    },
  };
}

function createBoundedRestoreService(chunk = Buffer.from('blocked')) {
  return {
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
}

function createOutsideSymlink(baseDirectory, linkName) {
  const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'fio-outside-'));
  const linkedDir = path.join(baseDirectory, linkName);
  symlinkSync(outsideDir, linkedDir, 'dir');
  return { outsideDir, linkedDir };
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
    expect(Buffer.from(capturedOpts.source).equals(data)).toBe(true);
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
      encryption: { scheme: 'framed', frameBytes: 32 },
    });

    expect(capturedEncryption).toEqual({ scheme: 'framed', frameBytes: 32 });
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

    const tmpDir = getTmpDir();
    const { bytesWritten } = await restoreFile(mockService, {
      manifest: {},
      outputPath,
      baseDirectory: tmpDir,
    });

    expect(bytesWritten).toBe(11);
    const written = readFileSync(outputPath);
    expect(written.toString()).toBe('hello world');
  });

});

describe('FileIOHelper – restoreFile path boundary', () => {
  const getTmpDir = useTempDir('fio-restore-');

  it('rejects sibling paths that only share a string prefix with the base directory', async () => {
    const tmpDir = getTmpDir();
    const outputPath = path.join(`${tmpDir}-sibling`, 'output.bin');
    const mockService = {
      async createFileRestorePlan() {
        return {
          mode: 'stream',
          source: (async function* gen() {
            yield Buffer.from('blocked');
          })(),
        };
      },
    };

    await expect(restoreFile(mockService, {
      manifest: {},
      outputPath,
      baseDirectory: tmpDir,
    })).rejects.toMatchObject({
      code: 'SECURITY_BOUNDARY_VIOLATION',
    });
  });
});

describe('FileIOHelper – restoreFile symlink boundary', () => {
  const getTmpDir = useTempDir('fio-restore-');

  it('rejects stream restores through symlinked directories outside the base', async () => {
    const tmpDir = getTmpDir();
    const { outsideDir, linkedDir } = createOutsideSymlink(tmpDir, 'linked-out');
    try {
      await expect(restoreFile(createStreamRestoreService(), {
        manifest: {},
        outputPath: path.join(linkedDir, 'escape.bin'),
        baseDirectory: tmpDir,
      })).rejects.toMatchObject({
        code: 'SECURITY_BOUNDARY_VIOLATION',
      });
      expect(existsSync(path.join(outsideDir, 'escape.bin'))).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects bounded restores through symlinked directories outside the base', async () => {
    const tmpDir = getTmpDir();
    const { outsideDir, linkedDir } = createOutsideSymlink(tmpDir, 'bounded-link');
    try {
      await expect(restoreFile(createBoundedRestoreService(), {
        manifest: { slug: 'bounded', chunks: [{}] },
        outputPath: path.join(linkedDir, 'escape.bin'),
        baseDirectory: tmpDir,
      })).rejects.toMatchObject({
        code: 'SECURITY_BOUNDARY_VIOLATION',
      });
      expect(existsSync(path.join(outsideDir, 'escape.bin'))).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('FileIOHelper – restoreFile bounded publication seam', () => {
  const getTmpDir = useTempDir('fio-restore-');

  it('uses createFileRestorePlan() for bounded-file publication without underscore helpers', async () => {
    const tmpDir = getTmpDir();
    const outputPath = path.join(tmpDir, 'bounded.bin');
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
      baseDirectory: tmpDir,
    });

    expect(bytesWritten).toBe(chunk.length);
    const written = readFileSync(outputPath);
    expect(Buffer.from(written).equals(chunk)).toBe(true);
  });
});

describe('FileIOHelper – restoreFile bounded whole encrypted path', () => {
  const getTmpDir = useTempDir('fio-bounded-restore-');

  it('restores large whole encrypted content to a file even when restoreStream() is buffer-limited', async () => {
    const { service } = createBlobBackedService({ chunkSize: 1024, maxRestoreBufferSize: 1024 });
    const key = Buffer.alloc(32, 0xab);
    const plaintext = Buffer.alloc(4096, 'z');
    const manifest = await storeBufferManifest(service, plaintext, {
      slug: 'whole-large',
      filename: 'whole-large.bin',
      encryptionKey: key,
      encryption: { scheme: 'whole' },
    });

    await expectRestoreStreamTooLarge(service, manifest, key);

    const tmpDir = getTmpDir();
    const outputPath = path.join(tmpDir, 'whole-large.bin');
    const { bytesWritten } = await restoreFile(service, {
      manifest,
      encryptionKey: key,
      outputPath,
      baseDirectory: tmpDir,
    });

    expect(bytesWritten).toBe(plaintext.length);
    expect(readFileSync(outputPath).equals(plaintext)).toBe(true);
  });
});

describe('FileIOHelper – restoreFile bounded whole compressed path', () => {
  const getTmpDir = useTempDir('fio-bounded-restore-');

  it('restores large whole encrypted + compressed content to a file even when restoreStream() is buffer-limited', async () => {
    const { service } = createBlobBackedService({ chunkSize: 1024, maxRestoreBufferSize: 1024 });
    const key = Buffer.alloc(32, 0xcd);
    const plaintext = Buffer.alloc(8192, 'A');
    const manifest = await storeBufferManifest(service, plaintext, {
      slug: 'whole-compressed-large',
      filename: 'whole-compressed-large.bin',
      encryptionKey: key,
      encryption: { scheme: 'whole' },
      compression: { algorithm: 'gzip' },
    });

    await expectRestoreStreamTooLarge(service, manifest, key);

    const tmpDir = getTmpDir();
    const outputPath = path.join(tmpDir, 'whole-compressed-large.bin');
    const { bytesWritten } = await restoreFile(service, {
      manifest,
      encryptionKey: key,
      outputPath,
      baseDirectory: tmpDir,
    });

    expect(bytesWritten).toBe(plaintext.length);
    expect(readFileSync(outputPath).equals(plaintext)).toBe(true);
  });
});

describe('FileIOHelper – restoreFile bounded whole auth cleanup', () => {
  const getTmpDir = useTempDir('fio-bounded-restore-');

  it('does not publish a partial destination file when whole decryption fails', async () => {
    const { service } = createBlobBackedService({ chunkSize: 1024, maxRestoreBufferSize: 1024 });
    const key = Buffer.alloc(32, 0xef);
    const wrongKey = Buffer.alloc(32, 0x11);
    const plaintext = Buffer.from('whole auth boundary');
    const manifest = await storeBufferManifest(service, plaintext, {
      slug: 'whole-auth-failure',
      filename: 'whole-auth-failure.bin',
      encryptionKey: key,
      encryption: { scheme: 'whole' },
    });

    const tmpDir = getTmpDir();
    const outputPath = path.join(tmpDir, 'whole-auth-failure.bin');
    await expect(
      restoreFile(service, {
        manifest,
        encryptionKey: wrongKey,
        outputPath,
        baseDirectory: tmpDir,
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });

    expect(existsSync(outputPath)).toBe(false);
    expect(readdirSync(tmpDir).filter((name) => name.startsWith('.git-cas-restore-'))).toEqual([]);
  });
});
