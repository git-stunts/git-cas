import { createWriteStream } from 'node:fs';
import { mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import CasError from '../../domain/errors/CasError.js';
import { ErrorCodes } from '../../domain/errors/index.js';
import { resolveSafeRestorePath } from './RestorePath.js';

/** @param {import('../../../files.js').MaterializeFileOptions} options */
export async function materializeFile(options = {}) {
  validateOptions(options);
  const { source, baseDirectory, outputPath, expectedSha256, signal } = options;
  signal?.throwIfAborted();
  const destination = await resolveSafeRestorePath({ baseDirectory, outputPath });
  if (destination === await realpath(path.resolve(baseDirectory))) {
    throw new CasError(`Materialization path "${outputPath}" names base directory "${baseDirectory}"`,
      ErrorCodes.SECURITY_BOUNDARY_VIOLATION, { outputPath, baseDirectory });
  }
  const temporary = await mkdtemp(path.join(path.dirname(destination), '.git-cas-materialize-'));
  const staged = path.join(temporary, 'content');
  const hash = expectedSha256 ? createHash('sha256') : null;
  let bytesWritten = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      bytesWritten += chunk.length;
      hash?.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.from(byteChunks(source, signal), { objectMode: false }), counter,
      createWriteStream(staged, { flags: 'wx', mode: 0o600 }), { signal }
    );
    if (hash && hash.digest('hex') !== expectedSha256.toLowerCase()) {
      throw new CasError('Materialized file SHA-256 does not match expectedSha256', ErrorCodes.INTEGRITY_ERROR);
    }
    signal?.throwIfAborted();
    await rename(staged, destination);
  } catch (error) {
    // The original failure is the diagnosis; a leftover private directory is documented.
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  await rm(temporary, { recursive: true, force: true });
  return { bytesWritten };
}

function validateOptions(options) {
  if (!options || !isPath(options.baseDirectory) || !isPath(options.outputPath)
    || typeof options.source?.[Symbol.asyncIterator] !== 'function') {
    throw new CasError('source, baseDirectory and outputPath are required', ErrorCodes.INVALID_OPTIONS);
  }
  validateSignal(options.signal);
  validateDigest(options.expectedSha256);
}

function validateSignal(signal) {
  if (signal !== undefined && !(signal instanceof globalThis.AbortSignal)) {
    throw new CasError('signal must be an AbortSignal', ErrorCodes.INVALID_OPTIONS);
  }
}

/**
 * Rejects anything but byte chunks, so a misbehaving source cannot publish text.
 * Each pull races the abort signal: cancellation settles even while the producer
 * is blocked. The source is then asked to return without waiting for it.
 */
async function* byteChunks(source, signal) {
  const iterator = source[Symbol.asyncIterator]();
  const abort = abortRejection(signal);
  let finished = false;
  try {
    while (true) {
      const step = await (abort ? Promise.race([iterator.next(), abort.promise]) : iterator.next());
      if (step.done) { finished = true; return; }
      if (!(step.value instanceof Uint8Array)) {
        throw new CasError('source must yield Uint8Array chunks', ErrorCodes.INVALID_OPTIONS);
      }
      yield step.value;
    }
  } finally {
    abort?.dispose();
    if (!finished) { Promise.resolve(iterator.return?.()).catch(() => {}); }
  }
}

/** A rejection that follows `signal`, marked handled so a late abort is not reported. */
function abortRejection(signal) {
  if (!signal) { return null; }
  let onAbort;
  const promise = new Promise((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) { onAbort(); } else { signal.addEventListener('abort', onAbort, { once: true }); }
  });
  promise.catch(() => {});
  return { promise, dispose: () => signal.removeEventListener('abort', onAbort) };
}

function isPath(value) { return typeof value === 'string' && value.length > 0; }

function validateDigest(expectedSha256) {
  if (expectedSha256 !== undefined
    && (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(expectedSha256))) {
    throw new CasError('expectedSha256 must be a 64-digit hexadecimal digest', ErrorCodes.INVALID_OPTIONS);
  }
}
