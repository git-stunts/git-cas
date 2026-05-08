import CasError from '../errors/CasError.js';
import buildKdfMetadata from '../helpers/buildKdfMetadata.js';
import { prepareKdfOptions, prepareStoredKdfOptions } from '../../helpers/kdfPolicy.js';
import { decodeBase64 } from '../encoding/base64.js';
import { ErrorCodes } from '../errors/index.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 50;

/**
 * Derives a KEK from a passphrase using stored KDF params.
 *
 * @param {import('./CasService.js').default} service - CasService instance.
 * @param {string} passphrase - The passphrase.
 * @param {Object} kdf - Stored KDF params (algorithm, salt, iterations, etc.).
 * @returns {Promise<Uint8Array>} The derived KEK.
 */
async function deriveKekFromKdf(service, passphrase, kdf) {
  const params = prepareStoredKdfOptions(kdf, { source: 'vault-metadata' });
  const { key } = await service.deriveKey({
    passphrase,
    salt: decodeBase64(kdf.salt),
    ...params,
  });
  return key;
}

/**
 * Iterates vault entries, rotating envelope-encrypted ones and skipping others.
 *
 * @param {Object} options
 * @param {import('./CasService.js').default} options.service - CasService instance.
 * @param {Map<string, string>} options.entries - Vault entries (slug → treeOid).
 * @param {Uint8Array} options.oldKek - Old key-encryption key.
 * @param {Uint8Array} options.newKek - New key-encryption key.
 * @returns {Promise<{ updatedEntries: Map<string, string>, rotatedSlugs: string[], skippedSlugs: string[] }>}
 */
async function rotateEntries({ service, entries, oldKek, newKek }) {
  const rotatedSlugs = [];
  const skippedSlugs = [];
  const updatedEntries = new Map(entries);

  for (const [slug, treeOid] of entries) {
    const manifest = await service.readManifest({ treeOid });
    if (!manifest.encryption?.recipients?.length) {
      skippedSlugs.push(slug);
      continue;
    }
    const rotated = await service.rotateKey({ manifest, oldKey: oldKek, newKey: newKek });
    updatedEntries.set(slug, await service.createTree({ manifest: rotated }));
    rotatedSlugs.push(slug);
  }

  return { updatedEntries, rotatedSlugs, skippedSlugs };
}

/**
 * Returns true if the error is a retryable VAULT_CONFLICT and there are attempts remaining.
 *
 * @param {Error} err - Caught error.
 * @param {number} attempt - Zero-based current attempt index.
 * @param {number} maxRetries - Maximum number of attempts.
 * @returns {boolean}
 */
function isRetryableConflict(err, attempt, maxRetries) {
  return err instanceof CasError && err.code === ErrorCodes.VAULT_CONFLICT && attempt < maxRetries - 1;
}

/**
 * Builds updated vault metadata with new KDF params.
 *
 * @param {Object} metadata - Existing vault metadata.
 * @param {Uint8Array} newSalt - New KDF salt.
 * @param {Object} newParams - New KDF parameters.
 * @returns {Object} Updated metadata.
 */
function buildRotatedMetadata(metadata, newSalt, newParams) {
  return {
    ...metadata,
    encryption: {
      cipher: metadata.encryption.cipher,
      kdf: buildKdfMetadata(newSalt, newParams),
    },
  };
}

/**
 * Reads vault metadata without requiring privacy-index decryption.
 *
 * @param {import('./VaultService.js').default} vault - VaultService instance.
 * @returns {Promise<Object>} Encrypted vault metadata.
 */
async function readEncryptedVaultMetadata(vault) {
  const metadata = await vault.getVaultMetadata();
  if (!metadata?.encryption) {
    throw new CasError('Vault is not encrypted — nothing to rotate', ErrorCodes.VAULT_METADATA_INVALID);
  }
  return metadata;
}

/**
 * Rotates the vault-level passphrase. Re-wraps every envelope-encrypted
 * entry's DEK with a new KEK derived from `newPassphrase`. Entries using
 * direct-key encryption are skipped.
 *
 * Uses optimistic concurrency with retry/backoff on VAULT_CONFLICT.
 *
 * @param {Object} deps
 * @param {import('./CasService.js').default} deps.service - CasService instance.
 * @param {import('./VaultService.js').default} deps.vault - VaultService instance.
 * @param {Object} options
 * @param {string} options.oldPassphrase - Current vault passphrase.
 * @param {string} options.newPassphrase - New vault passphrase.
 * @param {Object} [options.kdfOptions] - KDF options for new passphrase.
 * @param {number} [options.maxRetries=3] - Maximum optimistic-concurrency retries on VAULT_CONFLICT.
 * @param {number} [options.retryBaseMs=50] - Base delay in ms for exponential backoff between retries.
 * @returns {Promise<{ commitOid: string, rotatedSlugs: string[], skippedSlugs: string[] }>}
 */
export default async function rotateVaultPassphrase(
  { service, vault },
  { oldPassphrase, newPassphrase, kdfOptions, maxRetries = DEFAULT_MAX_RETRIES, retryBaseMs = DEFAULT_RETRY_BASE_MS },
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const metadata = await readEncryptedVaultMetadata(vault);
    const { kdf } = metadata.encryption;
    const oldKek = await deriveKekFromKdf(service, oldPassphrase, kdf);
    await vault.verifyVaultKey({ encryptionKey: oldKek });
    const state = await vault.readState({ encryptionKey: oldKek });
    const nextKdfOptions = prepareKdfOptions(
      { ...kdfOptions, algorithm: kdfOptions?.algorithm || kdf.algorithm },
      { source: 'vault-rotation' },
    );
    const { key: newKek, salt: newSalt, params: newParams } = await service.deriveKey({
      passphrase: newPassphrase,
      ...nextKdfOptions,
    });

    const result = await rotateEntries({ service, entries: state.entries, oldKek, newKek });
    const newMetadata = buildRotatedMetadata(state.metadata, newSalt, newParams);

    try {
      const { commitOid } = await vault.writeCommit({
        entries: result.updatedEntries,
        metadata: newMetadata,
        parentCommitOid: state.parentCommitOid,
        message: `vault: rotate passphrase (${result.rotatedSlugs.length} rotated, ${result.skippedSlugs.length} skipped)`,
        encryptionKey: newKek,
      });
      return { commitOid, rotatedSlugs: result.rotatedSlugs, skippedSlugs: result.skippedSlugs };
    } catch (err) {
      if (isRetryableConflict(err, attempt, maxRetries)) {
        await new Promise((r) => setTimeout(r, retryBaseMs * (2 ** attempt)));
        continue;
      }
      throw err;
    }
  }
  /* c8 ignore next 2 */
  throw new CasError('Vault CAS retries exhausted', ErrorCodes.VAULT_CONFLICT);
}
