/**
 * @fileoverview File I/O helpers for storing and restoring files via CasService.
 *
 * @typedef {import('../../domain/services/CasService.js').default} CasService
 * @typedef {import('../../domain/value-objects/Manifest.js').default} Manifest
 * @typedef {import('../../domain/value-objects/Manifest.js').EncryptionMeta} EncryptionMeta
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import CasError from '../../domain/errors/CasError.js';
import { ErrorCodes } from '../../domain/errors/index.js';

/**
 * Reads a file from disk and stores it in Git as chunked blobs via
 * the given {@link CasService}.
 *
 * @param {CasService} service - Initialized CasService.
 * @param {Object} options
 * @param {string} options.filePath - Absolute or relative path to the file.
 * @param {string} options.slug - Logical identifier for the stored asset.
 * @param {string} [options.filename] - Override filename (defaults to basename of filePath).
 * @param {Uint8Array} [options.encryptionKey] - 32-byte key for AES-256-GCM encryption.
 * @param {string} [options.passphrase] - Derive encryption key from passphrase.
 * @param {{ scheme?: 'whole'|'framed'|'convergent', frameBytes?: number, convergent?: boolean }} [options.encryption] - Explicit encryption scheme selection.
 * @param {Object} [options.kdfOptions] - KDF options when using passphrase.
 * @param {{ algorithm: 'gzip' }} [options.compression] - Enable compression.
 * @param {Array<{label: string, key: Uint8Array}>} [options.recipients] - Envelope recipients.
 * @param {number} [options.merkleThreshold] - Per-operation chunk count threshold for Merkle manifests.
 * @returns {Promise<Manifest>} The resulting manifest.
 */
export async function storeFile(service, {
  filePath,
  slug,
  filename,
  encryptionKey,
  passphrase,
  encryption,
  kdfOptions,
  compression,
  recipients,
  merkleThreshold,
}) {
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
    merkleThreshold,
  });
}

/**
 * Restores a file from its manifest and writes it to disk via the given
 * {@link CasService}.
 *
 * @param {CasService} service - Initialized CasService.
 * @param {Object} options
 * @param {Manifest} options.manifest - The file manifest.
 * @param {Uint8Array} [options.encryptionKey] - 32-byte key, required if manifest is encrypted.
 * @param {string} [options.passphrase] - Passphrase for KDF-based decryption.
 * @param {string} options.outputPath - Destination file path.
 * @param {string} options.baseDirectory - The permitted base directory for restoration (e.g. repo root).
 * @returns {Promise<{ bytesWritten: number }>}
 */
export async function restoreFile(service, { manifest, encryptionKey, passphrase, outputPath, baseDirectory }) {
  if (!baseDirectory) {
    throw new CasError('baseDirectory is required for safe restoration', ErrorCodes.INVALID_OPTIONS);
  }

  const resolvedPath = path.resolve(baseDirectory, outputPath);
  const resolvedBase = path.resolve(baseDirectory);

  if (!isInsideBaseDirectory(resolvedPath, resolvedBase)) {
    throw new CasError(
      `Restoration path "${outputPath}" escapes base directory "${baseDirectory}"`,
      ErrorCodes.SECURITY_BOUNDARY_VIOLATION,
      { outputPath, baseDirectory },
    );
  }

  const plan = await service.createFileRestorePlan({ manifest, encryptionKey, passphrase });

  if (plan.mode === 'bounded-file') {
    return await restoreBufferedFile(service, {
      manifest,
      outputPath: resolvedPath,
      source: plan.source,
      encryptionMeta: plan.encryptionMeta,
    });
  }

  const iterable = plan.source;
  const readable = Readable.from(iterable);
  const writable = createWriteStream(resolvedPath);
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
 * @param {CasService} service
 * @param {{ manifest: Manifest, outputPath: string, source: AsyncIterable<Uint8Array>, encryptionMeta?: EncryptionMeta }} options
 * @returns {Promise<{ bytesWritten: number }>}
 */
async function restoreBufferedFile(service, {
  manifest,
  outputPath,
  source,
  encryptionMeta,
}) {
  let bytesWritten = 0;
  const outputDir = path.dirname(outputPath);
  const tempDir = await mkdtemp(path.join(outputDir, '.git-cas-restore-'));
  const tempPath = path.join(tempDir, path.basename(outputPath));

  try {
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
    if (encryptionMeta && err instanceof CasError && err.code === ErrorCodes.INTEGRITY_ERROR) {
      service.observability.metric('error', { action: 'decryption_failed', slug: manifest.slug });
    }
    throw err;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {string} resolvedPath
 * @param {string} resolvedBase
 * @returns {boolean}
 */
function isInsideBaseDirectory(resolvedPath, resolvedBase) {
  const relativePath = path.relative(resolvedBase, resolvedPath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

function createByteCounter(onChunk) {
  return new Transform({
    transform(chunk, _encoding, cb) {
      onChunk(chunk.length);
      cb(null, chunk);
    },
  });
}
