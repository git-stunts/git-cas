/**
 * @fileoverview File I/O helpers for storing and restoring files via CasService.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import CasError from '../../domain/errors/CasError.js';

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
 * @param {{ scheme?: 'whole-v1'|'framed-v1', frameBytes?: number }} [options.encryption] - Explicit encryption scheme selection.
 * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
 * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
 * @param {Array<{label: string, key: Buffer}>} [options.recipients] - Envelope recipients.
 * @returns {Promise<import('../../domain/value-objects/Manifest.js').default>} The resulting manifest.
 */
export async function storeFile(service, { filePath, slug, filename, encryptionKey, passphrase, encryption, kdfOptions, compression, recipients }) {
  const source = createReadStream(filePath);
  return await service.store({
    source,
    slug,
    filename: filename || path.basename(filePath),
    encryptionKey,
    passphrase,
    encryption,
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
  const encryptionMeta = typeof service._validatedEncryptionMeta === 'function'
    ? service._validatedEncryptionMeta(manifest)
    : manifest.encryption;

  if (shouldUseBufferedFileRestore(manifest, encryptionMeta)) {
    return await restoreBufferedFile(service, {
      manifest,
      encryptionKey,
      passphrase,
      outputPath,
      encryptionMeta,
    });
  }

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

/**
 * Restores buffered modes through a temp-file path so whole-object auth can
 * stay intact without publishing partial output.
 *
 * @param {import('../../domain/services/CasService.js').default} service
 * @param {{ manifest: import('../../domain/value-objects/Manifest.js').default, encryptionKey?: Buffer, passphrase?: string, outputPath: string, encryptionMeta?: { scheme: 'whole-v1', encrypted: true, algorithm: 'aes-256-gcm', nonce: string, tag: string } }} options
 * @returns {Promise<{ bytesWritten: number }>}
 */
async function restoreBufferedFile(service, {
  manifest,
  encryptionKey,
  passphrase,
  outputPath,
  encryptionMeta,
}) {
  let bytesWritten = 0;
  const outputDir = path.dirname(outputPath);
  const tempDir = await mkdtemp(path.join(outputDir, '.git-cas-restore-'));
  const tempPath = path.join(tempDir, path.basename(outputPath));

  try {
    const source = await createBufferedRestoreSource(service, {
      manifest,
      encryptionKey,
      passphrase,
      encryptionMeta,
    });
    const counter = createByteCounter((n) => { bytesWritten += n; });

    await pipeline(
      Readable.from(source),
      counter,
      createWriteStream(tempPath),
    );

    await rename(tempPath, outputPath);
    service.observability.metric('file', {
      action: 'restored',
      slug: manifest.slug,
      size: bytesWritten,
      chunkCount: manifest.chunks.length,
    });
    return { bytesWritten };
  } catch (err) {
    if (encryptionMeta && err instanceof CasError && err.code === 'INTEGRITY_ERROR') {
      service.observability.metric('error', { action: 'decryption_failed', slug: manifest.slug });
    }
    throw err;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function shouldUseBufferedFileRestore(manifest, encryptionMeta) {
  return encryptionMeta?.scheme === 'whole-v1' || (!encryptionMeta && manifest.compression);
}

function createByteCounter(onChunk) {
  return new Transform({
    transform(chunk, _encoding, cb) {
      onChunk(chunk.length);
      cb(null, chunk);
    },
  });
}

async function createBufferedRestoreSource(service, {
  manifest,
  encryptionKey,
  passphrase,
  encryptionMeta,
}) {
  /** @type {AsyncIterable<Buffer>} */
  let source = service._iterVerifiedChunkBlobs(manifest);

  if (encryptionMeta) {
    const key = await service._resolveRestoreKey(manifest, encryptionKey, passphrase);
    source = service.crypto.createDecryptionStream(key, encryptionMeta).decrypt(source);
  }

  if (manifest.compression) {
    source = service._decompressStreaming(source);
  }

  return source;
}
