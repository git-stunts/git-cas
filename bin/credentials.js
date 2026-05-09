import { readFileSync } from 'node:fs';
import {
  hasAgentPassphraseSource,
  validateAgentPassphraseSource,
} from './agent/passphrase-source.js';
import {
  hasExplicitPassphraseSource,
  hasPassphraseSource,
  resolvePassphrase,
  validatePassphraseSources,
} from './passphrase-source.js';

const UNENCRYPTED_VAULT_PASSPHRASE_IGNORED_MESSAGE =
  'passphrase ignored (vault is not encrypted)';

/**
 * @param {string} message
 * @returns {Error}
 */
function defaultErrorFactory(message) {
  return new Error(message);
}

/**
 * @param {string} keyFilePath
 * @param {{
 *   readFile?: (filePath: string) => Uint8Array,
 *   errorFactory?: (message: string) => Error,
 * }} [options]
 * @returns {Uint8Array}
 */
export function readKeyFile(keyFilePath, {
  readFile = (filePath) => readFileSync(filePath),
  errorFactory = defaultErrorFactory,
} = {}) {
  const key = readFile(keyFilePath);
  if (key.length !== 32) {
    throw errorFactory(`Invalid key length: expected 32 bytes, got ${key.length} (${keyFilePath})`);
  }
  return key;
}

/**
 * Derives and verifies the vault encryption key from stored KDF metadata.
 *
 * @param {{ deriveKey: Function, verifyVaultKey: Function }} cas
 * @param {{ encryption?: { kdf?: Record<string, any> } }} metadata
 * @param {string} passphrase
 * @returns {Promise<Uint8Array>}
 */
export async function deriveVaultKey(cas, metadata, passphrase) {
  if (!metadata.encryption?.kdf) {
    throw new Error('Missing or malformed encryption metadata');
  }
  const { kdf } = metadata.encryption;
  const { key } = await cas.deriveKey({
    passphrase,
    salt: Buffer.from(kdf.salt, 'base64'),
    algorithm: /** @type {"pbkdf2" | "scrypt"} */ (kdf.algorithm),
    iterations: kdf.iterations,
    cost: kdf.cost,
    blockSize: kdf.blockSize,
    parallelization: kdf.parallelization,
    keyLength: kdf.keyLength,
  });
  await cas.verifyVaultKey({ encryptionKey: key });
  return key;
}

/**
 * @param {Record<string, any>} opts
 * @param {{
 *   validatePassphraseSources?: (opts: Record<string, any>) => void,
 *   hasExplicitPassphraseSource?: (opts: Record<string, any>) => boolean,
 *   errorFactory?: (message: string) => Error,
 * }} [deps]
 */
export function validateCliCredentialSources(opts, {
  validatePassphraseSources: validatePassphraseSourcesFn = validatePassphraseSources,
  hasExplicitPassphraseSource: hasExplicitPassphraseSourceFn = hasExplicitPassphraseSource,
  errorFactory = defaultErrorFactory,
} = {}) {
  validatePassphraseSourcesFn(opts);
  if (opts.keyFile !== undefined && hasExplicitPassphraseSourceFn(opts)) {
    throw errorFactory('Provide --key-file or a vault passphrase source, not both');
  }
}

/**
 * Resolve a human CLI encryption key from a raw key file or vault passphrase source.
 *
 * @param {{ getVaultMetadata: Function }} cas
 * @param {Record<string, any>} opts
 * @param {{
 *   readKeyFile?: (keyFilePath: string) => Uint8Array,
 *   hasPassphraseSource?: (opts: Record<string, any>) => boolean,
 *   resolvePassphrase?: (opts: Record<string, any>) => Promise<string | undefined>,
 *   writeWarning?: (message: string) => void,
 * }} [deps]
 * @returns {Promise<Uint8Array | undefined>}
 */
export async function resolveCliEncryptionKey(cas, opts, {
  readKeyFile: readKeyFileFn = readKeyFile,
  hasPassphraseSource: hasPassphraseSourceFn = hasPassphraseSource,
  resolvePassphrase: resolvePassphraseFn = resolvePassphrase,
  writeWarning = (message) => process.stderr.write(message),
} = {}) {
  if (opts.keyFile) {
    return readKeyFileFn(opts.keyFile);
  }
  const metadata = await cas.getVaultMetadata();
  if (!metadata?.encryption) {
    return resolveUnencryptedVaultKey({ opts, hasPassphraseSourceFn, writeWarning });
  }
  return await resolveCliPassphraseKey({ cas, metadata, opts, resolvePassphraseFn });
}

/**
 * @param {{
 *   opts: Record<string, any>,
 *   hasPassphraseSourceFn: (opts: Record<string, any>) => boolean,
 *   writeWarning: (message: string) => void,
 * }} params
 * @returns {undefined}
 */
function resolveUnencryptedVaultKey({ opts, hasPassphraseSourceFn, writeWarning }) {
  if (hasPassphraseSourceFn(opts)) {
    writeWarning('warning: passphrase ignored (vault is not encrypted)\n');
  }
  return undefined;
}

/**
 * @param {{
 *   cas: { deriveKey: Function, verifyVaultKey: Function },
 *   metadata: { encryption?: { kdf?: Record<string, any> } },
 *   opts: Record<string, any>,
 *   resolvePassphraseFn: (opts: Record<string, any>) => Promise<string | undefined>,
 * }} params
 * @returns {Promise<Uint8Array | undefined>}
 */
async function resolveCliPassphraseKey({ cas, metadata, opts, resolvePassphraseFn }) {
  const passphrase = await resolvePassphraseFn(opts);
  if (!passphrase) {
    return undefined;
  }
  return await deriveVaultKey(cas, metadata, passphrase);
}

/**
 * @param {Record<string, any>} input
 * @returns {boolean}
 */
export function hasAgentVaultPassphraseSource(input) {
  return hasAgentPassphraseSource({
    inlineValue: input.vaultPassphrase,
    fileValue: input.vaultPassphraseFile,
    osKeychainTarget: input.osKeychainTarget,
  });
}

/**
 * @param {Record<string, any>} input
 * @param {{ errorFactory?: (message: string) => Error }} [options]
 */
export function validateAgentCredentialSources(input, {
  errorFactory = defaultErrorFactory,
} = {}) {
  validateAgentPassphraseSource({
    inlineValue: input.vaultPassphrase,
    fileValue: input.vaultPassphraseFile,
    osKeychainTarget: input.osKeychainTarget,
    osKeychainAccount: input.osKeychainAccount,
    inlineFlag: '--vault-passphrase',
    fileFlag: '--vault-passphrase-file',
    keychainTargetFlag: '--os-keychain-target',
    keychainAccountFlag: '--os-keychain-account',
    label: 'vault passphrase source',
    errorFactory,
  });
  if (input.keyFile !== undefined && hasAgentVaultPassphraseSource(input)) {
    throw errorFactory('Provide --key-file or a vault passphrase source, not both');
  }
}

/**
 * @param {import('../src/domain/value-objects/Manifest.js').default} manifest
 * @returns {boolean}
 */
function hasEnvelopeRecipients(manifest) {
  return (
    Array.isArray(manifest.encryption?.recipients) && manifest.encryption.recipients.length > 0
  );
}

/**
 * @param {import('../src/domain/value-objects/Manifest.js').default} manifest
 * @param {Awaited<ReturnType<import('../index.js').default['getVaultMetadata']>>} metadata
 * @returns {string[]}
 */
function getRestoreRequiredInputs(manifest, metadata) {
  if (hasEnvelopeRecipients(manifest)) {
    return ['keyFile'];
  }
  if (metadata?.encryption?.kdf) {
    return ['keyFile', 'vaultPassphrase', 'vaultPassphraseFile', 'osKeychainTarget'];
  }
  return ['keyFile'];
}

/**
 * Resolve an agent store encryption key from a raw key file or vault passphrase source.
 *
 * @param {{ getVaultMetadata: Function }} cas
 * @param {Record<string, any>} input
 * @param {{
 *   readKeyFile?: (keyFilePath: string) => Uint8Array,
 *   resolveVaultPassphrase: (input: Record<string, any>, requestSource: string | undefined, options?: Record<string, any>) => Promise<string | undefined>,
 *   errorFactory?: (message: string) => Error,
 *   stdin?: NodeJS.ReadStream,
 *   onWarning?: (warning: Record<string, any>) => void,
 * }} options
 * @returns {Promise<Uint8Array | undefined>}
 */
export async function resolveAgentStoreEncryptionKey(cas, input, {
  readKeyFile: readKeyFileFn = readKeyFile,
  resolveVaultPassphrase,
  errorFactory = defaultErrorFactory,
  ...passphraseOptions
}) {
  validateAgentCredentialSources(input, { errorFactory });
  if (input.keyFile) {
    return readKeyFileFn(input.keyFile);
  }
  const passphrase = await resolveVaultPassphrase(input, input.requestSource, passphraseOptions);
  if (!passphrase) {
    return undefined;
  }
  const metadata = await cas.getVaultMetadata();
  if (!metadata?.encryption?.kdf) {
    throw errorFactory('Vault passphrase source is only valid for encrypted vaults');
  }
  return await deriveVaultKey(cas, metadata, passphrase);
}

/**
 * Resolve an agent diagnostic encryption key from a raw key file or vault passphrase source.
 * Diagnostics can inspect plaintext vaults even when callers supplied a passphrase by mistake.
 *
 * @param {{ getVaultMetadata: Function }} cas
 * @param {Record<string, any>} input
 * @param {{
 *   readKeyFile?: (keyFilePath: string) => Uint8Array,
 *   resolveVaultPassphrase?: (input: Record<string, any>, requestSource: string | undefined, options?: Record<string, any>) => Promise<string | undefined>,
 *   errorFactory?: (message: string) => Error,
 *   onWarning?: (warning: Record<string, any>) => void,
 * }} options
 * @returns {Promise<Uint8Array | undefined>}
 */
export async function resolveAgentDiagnosticEncryptionKey(cas, input, {
  readKeyFile: readKeyFileFn = readKeyFile,
  resolveVaultPassphrase,
  errorFactory = defaultErrorFactory,
  onWarning,
  ...passphraseOptions
} = {}) {
  validateAgentCredentialSources(input, { errorFactory });
  if (input.keyFile) {
    return readKeyFileFn(input.keyFile);
  }
  const metadata = await cas.getVaultMetadata();
  if (!metadata?.encryption?.kdf) {
    return resolveAgentPlaintextDiagnosticKey(input, onWarning);
  }
  return await resolveAgentEncryptedDiagnosticKey({
    cas,
    input,
    metadata,
    resolveVaultPassphrase,
    errorFactory,
    passphraseOptions,
  });
}

/**
 * @param {Record<string, any>} input
 * @param {((warning: Record<string, any>) => void) | undefined} onWarning
 * @returns {undefined}
 */
function resolveAgentPlaintextDiagnosticKey(input, onWarning) {
  if (hasAgentVaultPassphraseSource(input)) {
    onWarning?.({ message: UNENCRYPTED_VAULT_PASSPHRASE_IGNORED_MESSAGE });
  }
  return undefined;
}

/**
 * @param {{
 *   cas: { deriveKey: Function, verifyVaultKey: Function },
 *   input: Record<string, any>,
 *   metadata: { encryption?: { kdf?: Record<string, any> } },
 *   resolveVaultPassphrase?: (input: Record<string, any>, requestSource: string | undefined, options?: Record<string, any>) => Promise<string | undefined>,
 *   errorFactory: (message: string) => Error,
 *   passphraseOptions: Record<string, any>,
 * }} params
 * @returns {Promise<Uint8Array | undefined>}
 */
async function resolveAgentEncryptedDiagnosticKey({
  cas,
  input,
  metadata,
  resolveVaultPassphrase,
  errorFactory,
  passphraseOptions,
}) {
  if (!hasAgentVaultPassphraseSource(input)) {
    return undefined;
  }
  if (typeof resolveVaultPassphrase !== 'function') {
    throw errorFactory('resolveVaultPassphrase is required when input contains a vault passphrase source');
  }
  const passphrase = await resolveVaultPassphrase(input, input.requestSource, passphraseOptions);
  return passphrase ? await deriveVaultKey(cas, metadata, passphrase) : undefined;
}

/**
 * Resolve an agent restore encryption key or raise NEEDS_INPUT metadata.
 *
 * @param {{
 *   cas: { getVaultMetadata: Function },
 *   manifest: import('../src/domain/value-objects/Manifest.js').default,
 *   input: Record<string, any>,
 *   requestSource?: string,
 *   treeOid: string,
 * }} params
 * @param {{
 *   readKeyFile?: (keyFilePath: string) => Uint8Array,
 *   resolveVaultPassphrase: (input: Record<string, any>, requestSource: string | undefined, options?: Record<string, any>) => Promise<string | undefined>,
 *   errorFactory?: (message: string) => Error,
 *   needsInputFactory?: (message: string, meta?: Record<string, any>) => Error,
 * }} options
 * @returns {Promise<Uint8Array | undefined>}
 */
export async function resolveAgentRestoreEncryptionKey(
  { cas, manifest, input, requestSource, treeOid },
  {
    readKeyFile: readKeyFileFn = readKeyFile,
    resolveVaultPassphrase,
    errorFactory = defaultErrorFactory,
    needsInputFactory = (message) => new Error(message),
  }
) {
  validateAgentCredentialSources(input, { errorFactory });
  if (input.keyFile) {
    return readKeyFileFn(input.keyFile);
  }

  const metadata = await cas.getVaultMetadata();
  const passphrase = await resolveVaultPassphrase(input, requestSource, {
    stdin: input.stdin,
    onWarning: input.onWarning,
  });
  const passphraseKey = await resolveAgentRestorePassphraseKey({
    cas,
    manifest,
    metadata,
    passphrase,
    errorFactory,
  });
  if (passphraseKey) {
    return passphraseKey;
  }

  if (!manifest.encryption?.encrypted) {
    return undefined;
  }

  throw needsInputFactory('Encrypted restore requires --key-file or a vault passphrase source', {
    requiredInputs: getRestoreRequiredInputs(manifest, metadata),
    slug: input.slug || manifest.slug,
    treeOid,
  });
}

/**
 * @param {{
 *   cas: { deriveKey: Function, verifyVaultKey: Function },
 *   manifest: import('../src/domain/value-objects/Manifest.js').default,
 *   metadata: Awaited<ReturnType<import('../index.js').default['getVaultMetadata']>>,
 *   passphrase: string | undefined,
 *   errorFactory: (message: string) => Error,
 * }} params
 * @returns {Promise<Uint8Array | undefined>}
 */
async function resolveAgentRestorePassphraseKey({
  cas,
  manifest,
  metadata,
  passphrase,
  errorFactory,
}) {
  if (!passphrase) {
    return undefined;
  }
  assertAgentPassphraseCanDecryptManifest({ manifest, metadata, errorFactory });
  return await deriveVaultKey(cas, metadata, passphrase);
}

/**
 * @param {{
 *   manifest: import('../src/domain/value-objects/Manifest.js').default,
 *   metadata: Awaited<ReturnType<import('../index.js').default['getVaultMetadata']>>,
 *   errorFactory: (message: string) => Error,
 * }} params
 */
function assertAgentPassphraseCanDecryptManifest({ manifest, metadata, errorFactory }) {
  if (hasEnvelopeRecipients(manifest)) {
    throw errorFactory(
      'Vault passphrase source cannot decrypt recipient-encrypted assets; provide --key-file'
    );
  }
  if (!metadata?.encryption?.kdf) {
    throw errorFactory('Vault passphrase source is only valid for encrypted vaults');
  }
}
