import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Reads a file from disk and stores it in Git as chunked blobs via
 * the given {@link import('../../domain/services/CasService.js').default CasService}.
 *
 * @param {import('../../domain/services/CasService.js').default} service - Initialized CasService.
 * @param {Object} options
 * @param {string} options.filePath - Absolute or relative path to the file.
 * @param {string} options.slug - Logical identifier for the stored asset.
 * @param {string} [options.filename] - Override filename (defaults to basename of filePath).
 * @param {Buffer} [options.encryptionKey] - 32-byte key for AES-256-GCM encryption.
 * @param {string} [options.passphrase] - Derive encryption key from passphrase.
 * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
 * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
 * @param {Array<{label: string, key: Buffer}>} [options.recipients] - Envelope recipients.
 * @returns {Promise<import('../../domain/value-objects/Manifest.js').default>} The resulting manifest.
 */
export async function storeFile(service, { filePath, slug, filename, encryptionKey, passphrase, kdfOptions, compression, recipients }) {
  const source = createReadStream(filePath);
  return await service.store({
    source,
    slug,
    filename: filename || path.basename(filePath),
    encryptionKey,
    passphrase,
    kdfOptions,
    compression,
    recipients,
  });
}

/**
 * Restores a file from its manifest and writes it to disk via the given
 * {@link import('../../domain/services/CasService.js').default CasService}.
 *
 * @param {import('../../domain/services/CasService.js').default} service - Initialized CasService.
 * @param {Object} options
 * @param {import('../../domain/value-objects/Manifest.js').default} options.manifest - The file manifest.
 * @param {Buffer} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
 * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
 * @param {string} options.outputPath - Destination file path.
 * @returns {Promise<{ bytesWritten: number }>}
 */
export async function restoreFile(service, { manifest, encryptionKey, passphrase, outputPath }) {
  const iterable = service.restoreStream({ manifest, encryptionKey, passphrase });
  const readable = Readable.from(iterable);
  const writable = createWriteStream(outputPath);
  let bytesWritten = 0;
  const counter = new Transform({
    transform(chunk, _encoding, cb) {
      bytesWritten += chunk.length;
      cb(null, chunk);
    },
  });
  await pipeline(readable, counter, writable);
  return { bytesWritten };
}
