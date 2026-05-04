import { describe, it, expect } from 'vitest';
import CasService from '../../../../src/domain/services/CasService.js';
import Manifest from '../../../../src/domain/value-objects/Manifest.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import { Readable } from 'node:stream';
import { encodeBase64 } from '../../../../src/domain/encoding/base64.js';

const testCrypto = await getTestCryptoAdapter();

/**
 * A mock compression adapter that tracks calls.
 */
class TrackingCompressionAdapter extends NodeCompressionAdapter {
  constructor() {
    super();
    this.decompressCalls = 0;
  }
  async *decompressStream(source) {
    this.decompressCalls++;
    yield* super.decompressStream(source);
  }
}

describe('CasService — whole scheme auth boundary (Cryptographic Doom Principle)', () => { // eslint-disable-line max-lines-per-function
  it('does NOT call decompressStream until authentication is verified for whole scheme', async () => { // eslint-disable-line max-lines-per-function
    const compression = new TrackingCompressionAdapter();
    const blobMap = new Map();
    const service = new CasService({
      persistence: {
        writeBlob: async (buf) => {
          const oid = (blobMap.size).toString(16).padStart(40, '0');
          blobMap.set(oid, buf);
          return oid;
        },
        readBlob: (oid) => {
          const buf = blobMap.get(oid);
          if (!buf) { throw new Error(`Blob not found: ${oid}`); }
          return Promise.resolve(buf);
        },
        readBlobStream: async function*(oid) {
          const buf = blobMap.get(oid);
          if (!buf) { throw new Error(`Blob not found: ${oid}`); }
          yield buf;
        },
      },
      crypto: testCrypto,
      codec: new JsonCodec(),
      observability: new SilentObserver(),
      chunker: new FixedChunker({ chunkSize: 1024 }),
      compressionAdapter: compression,
    });

    const key = new Uint8Array(32).fill(1);
    const data = new Uint8Array([1, 2, 3, 4, 5]);

    // 1. Store a whole-encrypted + compressed file
    const manifest = await service.store({
      source: Readable.from([data]),
      slug: 'test',
      filename: 'test.bin',
      encryptionKey: key,
      encryption: { scheme: 'whole' },
      compression: { algorithm: 'gzip' },
    });

    // 2. Tamper with the manifest tag to trigger INTEGRITY_ERROR
    const tamperedData = manifest.toJSON();
    const tagBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    tamperedData.encryption.tag = encodeBase64(tagBytes);
    const tamperedManifest = new Manifest(tamperedData);

    // 3. Attempt restore and verify that decompressStream was NEVER called
    await expect(service.restore({ manifest: tamperedManifest, encryptionKey: key }))
      .rejects.toThrow(/integrity/i);

    // This is where it should fail if it's not buffering correctly before decompression
    expect(compression.decompressCalls).toBe(0);
  });

  it('restoreFile (bounded-file mode) does NOT call decompressStream until authentication is verified', async () => { // eslint-disable-line max-lines-per-function
     const compression = new TrackingCompressionAdapter();
     const blobMap = new Map();
     const service = new CasService({
       persistence: {
         writeBlob: async (buf) => {
           const oid = (blobMap.size).toString(16).padStart(40, '0');
           blobMap.set(oid, buf);
           return oid;
         },
         readBlob: (oid) => {
           const buf = blobMap.get(oid);
           if (!buf) { throw new Error(`Blob not found: ${oid}`); }
           return Promise.resolve(buf);
         },
         readBlobStream: async function*(oid) {
           const buf = blobMap.get(oid);
           if (!buf) { throw new Error(`Blob not found: ${oid}`); }
           yield buf;
         },
       },
       crypto: testCrypto,
       codec: new JsonCodec(),
       observability: new SilentObserver(),
       chunker: new FixedChunker({ chunkSize: 1024 }),
       compressionAdapter: compression,
     });

     const key = new Uint8Array(32).fill(1);
     const data = new Uint8Array([1, 2, 3, 4, 5]);

     const manifest = await service.store({
       source: Readable.from([data]),
       slug: 'test',
       filename: 'test.bin',
       encryptionKey: key,
       encryption: { scheme: 'whole' },
       compression: { algorithm: 'gzip' },
     });

     // 2. Tamper with the manifest tag to trigger INTEGRITY_ERROR
     const tamperedData = manifest.toJSON();
     const tagBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
     tamperedData.encryption.tag = encodeBase64(tagBytes);
     const tamperedManifest = new Manifest(tamperedData);

     // 3. Attempt restore and verify that decompressStream was NEVER called
     await expect(service.createFileRestorePlan({ manifest: tamperedManifest, encryptionKey: key }))
       .rejects.toThrow(/integrity/i);

     expect(compression.decompressCalls).toBe(0);
  });
});
