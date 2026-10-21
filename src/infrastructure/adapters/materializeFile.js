import { createWriteStream } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
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
      Readable.from(source, { objectMode: false }), counter,
      createWriteStream(staged, { flags: 'wx', mode: 0o600 }), { signal }
    );
    if (hash && hash.digest('hex') !== expectedSha256.toLowerCase()) {
      throw new CasError('Materialized file SHA-256 does not match expectedSha256', ErrorCodes.INTEGRITY_ERROR);
    }
    signal?.throwIfAborted();
    await rename(staged, destination);
    return { bytesWritten };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function validateOptions(options) {
  if (!options || !isPath(options.baseDirectory) || !isPath(options.outputPath)
    || typeof options.source?.[Symbol.asyncIterator] !== 'function') {
    throw new CasError('source, baseDirectory and outputPath are required', ErrorCodes.INVALID_OPTIONS);
  }
  validateDigest(options.expectedSha256);
}

function isPath(value) { return typeof value === 'string' && value.length > 0; }

function validateDigest(expectedSha256) {
  if (expectedSha256 !== undefined
    && (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(expectedSha256))) {
    throw new CasError('expectedSha256 must be a 64-digit hexadecimal digest', ErrorCodes.INVALID_OPTIONS);
  }
}
