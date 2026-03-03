import CasError from '../errors/CasError.js';
import buildKdfMetadata from '../helpers/buildKdfMetadata.js';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 50;

/**
 * Derives a KEK from a passphrase using stored KDF params.
 *
 * @param {import('./CasService.js').default} service - CasService instance.
 * @param {string} passphrase - The passphrase.
 * @param {Object} kdf - Stored KDF params (algorithm, salt, iterations, etc.).
 * @returns {Promise<Buffer>} The derived KEK.
 */
async function deriveKekFromKdf(service, passphrase, kdf) {
  const { key } = await service.deriveKey({
    passphrase,
    salt: Buffer.from(kdf.salt, 'base64'),
    algorithm: kdf.algorithm,
    iterations: kdf.iterations,
    cost: kdf.cost,
    blockSize: kdf.blockSize,
    parallelization: kdf.parallelization,
  });
  return key;
}

/**
 * Iterates vault entries, rotating envelope-encrypted ones and skipping others.
 *
 * @param {Object} options
 * @param {import('./CasService.js').default} options.service - CasService instance.
 * @param {Map<string, string>} options.entries - Vault entries (slug → treeOid).
 * @param {Buffer} options.oldKek - Old key-encryption key.
 * @param {Buffer} options.newKek - New key-encryption key.
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
  return err instanceof CasError && err.code === 'VAULT_CONFLICT' && attempt < maxRetries - 1;
}

/**
 * Builds updated vault metadata with new KDF params.
 *
 * @param {Object} metadata - Existing vault metadata.
 * @param {Buffer} newSalt - New KDF salt.
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
    const state = await vault.readState();
    if (!state.metadata?.encryption) {
      throw new CasError('Vault is not encrypted — nothing to rotate', 'VAULT_METADATA_INVALID');
    }

    const { kdf } = state.metadata.encryption;
    const oldKek = await deriveKekFromKdf(service, oldPassphrase, kdf);
    const { key: newKek, salt: newSalt, params: newParams } = await service.deriveKey({
      passphrase: newPassphrase, ...kdfOptions, algorithm: kdfOptions?.algorithm || kdf.algorithm,
    });

    const result = await rotateEntries({ service, entries: state.entries, oldKek, newKek });
    const newMetadata = buildRotatedMetadata(state.metadata, newSalt, newParams);

    try {
      const { commitOid } = await vault.writeCommit({
        entries: result.updatedEntries,
        metadata: newMetadata,
        parentCommitOid: state.parentCommitOid,
        message: `vault: rotate passphrase (${result.rotatedSlugs.length} rotated, ${result.skippedSlugs.length} skipped)`,
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
  throw new CasError('Vault CAS retries exhausted', 'VAULT_CONFLICT');
}
