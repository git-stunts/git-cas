import { bench, describe } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import CasService from '../../src/domain/services/CasService.js';
import NodeCryptoAdapter from '../../src/infrastructure/adapters/NodeCryptoAdapter.js';
import JsonCodec from '../../src/infrastructure/codecs/JsonCodec.js';
import CborCodec from '../../src/infrastructure/codecs/CborCodec.js';
import Manifest from '../../src/domain/value-objects/Manifest.js';

const crypto = new NodeCryptoAdapter();

function digestOf(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

function createMockPersistence() {
  const store = new Map();
  return {
    writeBlob: async (content) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const oid = await crypto.sha256(buf);
      store.set(oid, buf);
      return oid;
    },
    writeTree: async () => 'mock-tree-oid',
    readBlob: async (oid) => {
      const buf = store.get(oid);
      if (!buf) { throw new Error(`Blob not found: ${oid}`); }
      return buf;
    },
  };
}

async function storeBuffer(service, buf, opts = {}) {
  async function* source() { yield buf; }
  return service.store({
    source: source(),
    slug: opts.slug || 'bench',
    filename: opts.filename || 'bench.bin',
    encryptionKey: opts.encryptionKey,
  });
}

// Pre-generate test buffers
const buf1KB = randomBytes(1024);
const buf1MB = randomBytes(1024 * 1024);
const buf10MB = randomBytes(10 * 1024 * 1024);
const encryptionKey = randomBytes(32);

// ---------------------------------------------------------------------------
// Store benchmarks
// ---------------------------------------------------------------------------
describe('store – plaintext', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec() });

  bench('1MB', async () => { await storeBuffer(service, buf1MB); });
  bench('10MB', async () => { await storeBuffer(service, buf10MB); });
});

describe('store – encrypted', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec() });

  bench('1MB', async () => { await storeBuffer(service, buf1MB, { encryptionKey }); });
  bench('10MB', async () => { await storeBuffer(service, buf10MB, { encryptionKey }); });
});

// ---------------------------------------------------------------------------
// Restore benchmarks
// ---------------------------------------------------------------------------
describe('restore – plaintext', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec() });
  let m1MB;
  let m10MB;

  bench('1MB', async () => {
    if (!m1MB) { m1MB = await storeBuffer(service, buf1MB); }
    await service.restore({ manifest: m1MB });
  });

  bench('10MB', async () => {
    if (!m10MB) { m10MB = await storeBuffer(service, buf10MB); }
    await service.restore({ manifest: m10MB });
  });
});

describe('restore – encrypted', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec() });
  let m1MB;
  let m10MB;

  bench('1MB', async () => {
    if (!m1MB) { m1MB = await storeBuffer(service, buf1MB, { encryptionKey }); }
    await service.restore({ manifest: m1MB, encryptionKey });
  });

  bench('10MB', async () => {
    if (!m10MB) { m10MB = await storeBuffer(service, buf10MB, { encryptionKey }); }
    await service.restore({ manifest: m10MB, encryptionKey });
  });
});

// ---------------------------------------------------------------------------
// createTree benchmarks
// ---------------------------------------------------------------------------
function makeManifest(chunkCount) {
  return new Manifest({
    slug: 'bench',
    filename: 'bench.bin',
    size: chunkCount * 1024,
    chunks: Array.from({ length: chunkCount }, (_, i) => ({
      index: i, size: 1024, digest: digestOf(`chunk-${i}`), blob: `blob-oid-${i}`,
    })),
  });
}

describe('createTree', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec() });
  const m10 = makeManifest(10);
  const m100 = makeManifest(100);
  const m1000 = makeManifest(1000);

  bench('10 chunks', async () => { await service.createTree({ manifest: m10 }); });
  bench('100 chunks', async () => { await service.createTree({ manifest: m100 }); });
  bench('1000 chunks', async () => { await service.createTree({ manifest: m1000 }); });
});

// ---------------------------------------------------------------------------
// verifyIntegrity benchmarks
// ---------------------------------------------------------------------------
describe('verifyIntegrity – 10 chunks', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec(), chunkSize: 1024 });
  let manifest;

  bench('10 chunks', async () => {
    if (!manifest) { manifest = await storeBuffer(service, randomBytes(10 * 1024)); }
    await service.verifyIntegrity(manifest);
  });
});

describe('verifyIntegrity – 100 chunks', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec(), chunkSize: 1024 });
  let manifest;

  bench('100 chunks', async () => {
    if (!manifest) { manifest = await storeBuffer(service, randomBytes(100 * 1024)); }
    await service.verifyIntegrity(manifest);
  });
});

// ---------------------------------------------------------------------------
// Encrypt/decrypt benchmarks
// ---------------------------------------------------------------------------
describe('encrypt', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec() });

  bench('1KB', async () => { await service.encrypt({ buffer: buf1KB, key: encryptionKey }); });
  bench('1MB', async () => { await service.encrypt({ buffer: buf1MB, key: encryptionKey }); });
  bench('10MB', async () => { await service.encrypt({ buffer: buf10MB, key: encryptionKey }); });
});

describe('decrypt – 1KB', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec() });
  let enc;

  bench('1KB', async () => {
    if (!enc) { enc = await service.encrypt({ buffer: buf1KB, key: encryptionKey }); }
    await service.decrypt({ buffer: enc.buffer, key: encryptionKey, meta: enc.meta });
  });
});

describe('decrypt – 1MB', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec() });
  let enc;

  bench('1MB', async () => {
    if (!enc) { enc = await service.encrypt({ buffer: buf1MB, key: encryptionKey }); }
    await service.decrypt({ buffer: enc.buffer, key: encryptionKey, meta: enc.meta });
  });
});

describe('decrypt – 10MB', () => {
  const service = new CasService({ persistence: createMockPersistence(), crypto, codec: new JsonCodec() });
  let enc;

  bench('10MB', async () => {
    if (!enc) { enc = await service.encrypt({ buffer: buf10MB, key: encryptionKey }); }
    await service.decrypt({ buffer: enc.buffer, key: encryptionKey, meta: enc.meta });
  });
});

// ---------------------------------------------------------------------------
// Codec benchmarks
// ---------------------------------------------------------------------------
const codecData = {
  slug: 'bench', filename: 'bench.bin', size: 1024000,
  chunks: Array.from({ length: 100 }, (_, i) => ({
    index: i, size: 10240, digest: digestOf(`c-${i}`), blob: `oid-${i}`,
  })),
};

describe('JsonCodec', () => {
  const codec = new JsonCodec();
  const encoded = codec.encode(codecData);

  bench('encode (100 chunks)', () => { codec.encode(codecData); });
  bench('decode (100 chunks)', () => { codec.decode(encoded); });
});

describe('CborCodec', () => {
  const codec = new CborCodec();
  const encoded = codec.encode(codecData);

  bench('encode (100 chunks)', () => { codec.encode(codecData); });
  bench('decode (100 chunks)', () => { codec.decode(encoded); });
});
