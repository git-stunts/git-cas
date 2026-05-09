import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import CasError from '../../../../src/domain/errors/CasError.js';
import {
  IntegrityError,
  InvalidOidError,
  InvalidOptionsError,
  RestoreTooLargeError,
  ErrorCodes,
  createCasError,
} from '../../../../src/domain/errors/index.js';

const repoRoot = process.cwd();
const extractedDomainFiles = [
  'src/domain/helpers/codecBytes.js',
  'src/domain/services/CasService.js',
  'src/domain/services/ChunkRepository.js',
  'src/domain/services/CompressionStreams.js',
  'src/domain/services/ManifestRepository.js',
  'src/domain/services/RecipientService.js',
  'src/domain/strategies/FramedRecordCodec.js',
  'src/domain/strategies/RestoreWhole.js',
  'src/domain/value-objects/EncryptionMetadata.js',
  'src/domain/value-objects/Oid.js',
  'src/domain/value-objects/StoreEncryptionConfig.js',
];

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('domain-specific error classes', () => {
  it('exposes immutable canonical error codes', () => {
    expect(Object.isFrozen(ErrorCodes)).toBe(true);
    expect(ErrorCodes.INVALID_OID).toBe('INVALID_OID');
    expect(ErrorCodes.VAULT_CONFLICT).toBe('VAULT_CONFLICT');
    expect(ErrorCodes.VAULT_REF_MISSING).toBe('VAULT_REF_MISSING');
  });

  it('preserves CasError compatibility while exposing code-specific classes', () => {
    const invalidOid = createCasError('bad oid', ErrorCodes.INVALID_OID, { oid: 'nope' });
    const integrity = createCasError('bad auth', ErrorCodes.INTEGRITY_ERROR);
    const invalidOptions = createCasError('bad option', ErrorCodes.INVALID_OPTIONS);
    const restoreTooLarge = createCasError('too large', ErrorCodes.RESTORE_TOO_LARGE);

    expect(invalidOid).toBeInstanceOf(CasError);
    expect(invalidOid).toBeInstanceOf(InvalidOidError);
    expect(integrity).toBeInstanceOf(IntegrityError);
    expect(invalidOptions).toBeInstanceOf(InvalidOptionsError);
    expect(restoreTooLarge).toBeInstanceOf(RestoreTooLargeError);
    expect(invalidOid).toMatchObject({ code: ErrorCodes.INVALID_OID, meta: { oid: 'nope' } });
  });

  it('serializes optional documentation URLs from createCasError', () => {
    const documentationUrl = 'https://git-cas.example/docs/errors#invalid-options';
    const err = createCasError({
      message: 'baseDirectory is required',
      code: ErrorCodes.INVALID_OPTIONS,
      meta: { option: 'baseDirectory' },
      documentationUrl,
    });

    expect(err).toMatchObject({ documentationUrl });
    expect(JSON.parse(JSON.stringify(err))).toMatchObject({
      code: ErrorCodes.INVALID_OPTIONS,
      message: 'baseDirectory is required',
      documentationUrl,
      meta: { option: 'baseDirectory' },
    });
  });

  it('keeps extracted domain modules off raw CasError construction', () => {
    const offenders = extractedDomainFiles
      .filter((file) => read(file).includes('new CasError'));

    expect(offenders).toEqual([]);
  });
});
