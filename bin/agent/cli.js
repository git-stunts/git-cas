import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ContentAddressableStore from '../../index.js';
import Manifest from '../../src/domain/value-objects/Manifest.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';
import { buildVaultStats, inspectVaultHealth } from '../ui/vault-report.js';
import { filterEntries } from '../ui/vault-list.js';
import {
  hasAgentPassphraseSource,
  resolveAgentPassphraseSource,
  validateAgentPassphraseSource,
} from './passphrase-source.js';
import { AGENT_EXIT_CODES, createAgentSession, getAgentExitCode } from './protocol.js';

const AVAILABLE_COMMANDS = Object.freeze([
  'store',
  'tree',
  'restore',
  'rotate',
  'inspect',
  'verify',
  'doctor',
  'recipient add',
  'recipient remove',
  'recipient list',
  'vault init',
  'vault list',
  'vault info',
  'vault history',
  'vault remove',
  'vault rotate',
  'vault stats',
]);

const REQUEST_OPTION = { request: { type: 'string' } };
const INPUT_ALIAS_MAP = Object.freeze({
  passphrase: 'passphrase',
  passphraseFile: 'passphrase-file',
  keyFile: 'key-file',
  oldKeyFile: 'old-key-file',
  newKeyFile: 'new-key-file',
  existingKeyFile: 'existing-key-file',
  oldPassphrase: 'old-passphrase',
  newPassphrase: 'new-passphrase',
  oldPassphraseFile: 'old-passphrase-file',
  newPassphraseFile: 'new-passphrase-file',
  vaultPassphrase: 'vault-passphrase',
  vaultPassphraseFile: 'vault-passphrase-file',
  osKeychainTarget: 'os-keychain-target',
  osKeychainAccount: 'os-keychain-account',
  oldOsKeychainTarget: 'old-os-keychain-target',
  oldOsKeychainAccount: 'old-os-keychain-account',
  newOsKeychainTarget: 'new-os-keychain-target',
  newOsKeychainAccount: 'new-os-keychain-account',
});

const START_REDACTED_FIELDS = new Set([
  'passphrase',
  'passphraseFile',
  'keyFile',
  'oldKeyFile',
  'newKeyFile',
  'existingKeyFile',
  'oldPassphrase',
  'newPassphrase',
  'oldPassphraseFile',
  'newPassphraseFile',
  'vaultPassphrase',
  'vaultPassphraseFile',
  'osKeychainTarget',
  'osKeychainAccount',
  'oldOsKeychainTarget',
  'oldOsKeychainAccount',
  'newOsKeychainTarget',
  'newOsKeychainAccount',
]);

const LOCAL_INPUT_ERROR_CODES = new Set(['ENOENT', 'EISDIR', 'ENOTDIR', 'EACCES', 'EPERM']);

/**
 * @param {string | undefined} requestSource
 * @returns {'inline' | 'file' | 'stdin' | undefined}
 */
function normalizeRequestSourceKind(requestSource) {
  if (!requestSource) {
    return undefined;
  }
  if (requestSource === '-') {
    return 'stdin';
  }
  if (requestSource.startsWith('@')) {
    return 'file';
  }
  return 'inline';
}

/**
 * @param {string | undefined} key
 * @param {unknown} value
 * @returns {{ handled: boolean, value?: unknown }}
 */
function sanitizeSpecialStartValue(key, value) {
  if (!key) {
    return { handled: false };
  }

  if (key.includes('-')) {
    return { handled: true };
  }

  if (key === 'requestSource') {
    return {
      handled: true,
      value: normalizeRequestSourceKind(/** @type {string | undefined} */ (value)),
    };
  }

  if (key === 'manifest') {
    return {
      handled: true,
      value: {
        provided: true,
        source: typeof value === 'string' ? 'file' : 'inline',
      },
    };
  }

  if (START_REDACTED_FIELDS.has(key)) {
    return { handled: true, value: true };
  }

  return { handled: false };
}

/**
 * @param {Record<string, unknown>} value
 * @returns {Record<string, unknown>}
 */
function sanitizeStartObject(value) {
  /** @type {Record<string, unknown>} */
  const sanitized = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    const safeValue = sanitizeStartValue(nestedKey, nestedValue);
    if (safeValue !== undefined) {
      sanitized[nestedKey] = safeValue;
    }
  }
  return sanitized;
}

/**
 * @param {unknown[]} value
 * @returns {unknown[]}
 */
function sanitizeStartArray(value) {
  return value
    .map((entry) => sanitizeStartValue(undefined, entry))
    .filter((entry) => entry !== undefined);
}

/**
 * @param {string | undefined} key
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeStartValue(key, value) {
  if (value === undefined) {
    return undefined;
  }

  const special = sanitizeSpecialStartValue(key, value);
  if (special.handled) {
    return special.value;
  }

  if (Buffer.isBuffer(value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return sanitizeStartArray(value);
  }

  if (value && typeof value === 'object') {
    return sanitizeStartObject(/** @type {Record<string, unknown>} */ (value));
  }

  return value;
}

/**
 * @param {Record<string, any>} input
 * @param {string[]} fields
 * @returns {Record<string, any>}
 */
function selectStartInput(input, fields) {
  /** @type {Record<string, any>} */
  const selected = {};
  for (const field of fields) {
    if (input[field] !== undefined) {
      selected[field] = input[field];
    }
  }
  return selected;
}

/**
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
function buildAgentStartData(input) {
  const sanitized = sanitizeStartValue(undefined, input);
  if (
    sanitized &&
    typeof sanitized === 'object' &&
    !Array.isArray(sanitized) &&
    Object.keys(sanitized).length > 0
  ) {
    return { input: sanitized };
  }
  return {};
}

/**
 * @param {ReturnType<typeof createAgentSession>} session
 * @param {Record<string, any>} input
 */
function writeAgentStart(session, input) {
  session.writeStart(buildAgentStartData(input));
}

/**
 * @param {unknown} err
 * @param {string} label
 * @param {string} filePath
 * @returns {Error}
 */
function normalizeLocalInputError(err, label, filePath) {
  const resolvedPath = path.resolve(filePath);

  if (err instanceof SyntaxError) {
    return invalidInput(`Invalid ${label}: ${resolvedPath}: ${err.message}`, {
      filePath: resolvedPath,
    });
  }

  if (typeof err === 'object' && err && typeof err.code === 'string') {
    if (LOCAL_INPUT_ERROR_CODES.has(err.code)) {
      return invalidInput(`Unable to read ${label}: ${resolvedPath}`, {
        filePath: resolvedPath,
        errorCode: err.code,
      });
    }
  }

  return err instanceof Error ? err : new Error(String(err));
}

/**
 * @param {string} filePath
 * @param {string} label
 * @returns {Buffer}
 */
function readBinaryInputFile(filePath, label) {
  try {
    return readFileSync(filePath);
  } catch (err) {
    throw normalizeLocalInputError(err, label, filePath);
  }
}

/**
 * @param {string} filePath
 * @param {string} label
 * @returns {string}
 */
function readTextInputFile(filePath, label) {
  try {
    return readFileSync(path.resolve(filePath), 'utf8');
  } catch (err) {
    throw normalizeLocalInputError(err, label, filePath);
  }
}

/**
 * @param {string} cwd
 * @returns {ContentAddressableStore}
 */
function createCas(cwd) {
  const plumbing = createGitPlumbing({ cwd });
  return new ContentAddressableStore({ plumbing });
}

/**
 * @param {string} message
 * @param {Record<string, any>} [meta]
 * @returns {Error & { code: string, meta?: Record<string, any> }}
 */
function invalidInput(message, meta) {
  const err = /** @type {Error & { code: string, meta?: Record<string, any> }} */ (
    new Error(message)
  );
  err.code = 'INVALID_INPUT';
  if (meta) {
    err.meta = meta;
  }
  return err;
}

/**
 * @param {string} message
 * @param {Record<string, any>} [meta]
 * @returns {Error & { code: string, meta?: Record<string, any> }}
 */
function needsInput(message, meta) {
  const err = /** @type {Error & { code: string, meta?: Record<string, any> }} */ (
    new Error(message)
  );
  err.code = 'NEEDS_INPUT';
  if (meta) {
    err.meta = meta;
  }
  return err;
}

/**
 * @param {string | undefined} request
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<Record<string, any>>}
 */
async function readRequestPayload(request, stdin) {
  if (!request) {
    return {};
  }

  let raw;
  if (request === '-') {
    raw = await readStream(stdin);
  } else if (request.startsWith('@')) {
    raw = readTextInputFile(request.slice(1), 'request payload file');
  } else {
    raw = request;
  }

  if (!raw.trim()) {
    throw invalidInput('Agent request payload must not be empty');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw invalidInput(
      `Invalid JSON request payload: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidInput('Agent request payload must be a JSON object');
  }

  return parsed;
}

/**
 * @param {string} key
 * @param {Record<string, { type: 'string' | 'boolean' }>} options
 * @returns {{ type: 'string' | 'boolean' } | undefined}
 */
function resolveRequestOptionSpec(key, options) {
  if (options[key]) {
    return options[key];
  }

  const alias = INPUT_ALIAS_MAP[key];
  if (alias && options[alias]) {
    return options[alias];
  }

  return undefined;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean}
 */
function allowsStructuredRequestValue(key, value) {
  return key === 'manifest' && Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {{ type: 'string' | 'boolean' } | undefined} spec
 */
function validateRequestFieldType(key, value, spec) {
  if (spec?.type === 'boolean' && typeof value !== 'boolean') {
    throw invalidInput(`Request field "${key}" must be a boolean`);
  }
  if (spec?.type === 'string' && typeof value !== 'string' && !allowsStructuredRequestValue(key, value)) {
    throw invalidInput(`Request field "${key}" must be a string`);
  }
}

/**
 * @param {Record<string, any>} request
 * @param {Record<string, { type: 'string' | 'boolean' }>} options
 * @returns {Record<string, any>}
 */
function normalizeRequestValues(request, options) {
  /** @type {Record<string, any>} */
  const normalized = {};

  for (const [key, value] of Object.entries(request)) {
    const spec = resolveRequestOptionSpec(key, options);
    validateRequestFieldType(key, value, spec);
    normalized[key] = value;
  }

  return normalized;
}

/**
 * @param {NodeJS.ReadStream} stream
 * @returns {Promise<string>}
 */
async function readStream(stream) {
  if (typeof stream.setEncoding === 'function') {
    stream.setEncoding('utf8');
  }

  let raw = '';
  for await (const chunk of stream) {
    raw += String(chunk);
  }
  return raw;
}

/**
 * @param {string[]} args
 * @param {Record<string, { type: 'string' | 'boolean' }>} options
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ values: Record<string, any>, positionals: string[], requestSource?: string }>}
 */
async function parseAgentInput(args, options, stdin) {
  const optionSpec = {
    ...options,
    ...REQUEST_OPTION,
  };

  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: optionSpec,
    });
  } catch (err) {
    throw invalidInput(err instanceof Error ? err.message : String(err));
  }

  const request = normalizeRequestValues(
    await readRequestPayload(parsed.values.request, stdin),
    optionSpec
  );
  const values = { ...request, ...parsed.values };
  delete values.request;

  return {
    values,
    positionals: parsed.positionals,
    requestSource: parsed.values.request,
  };
}

/**
 * @param {string[]} positionals
 * @param {string[]} names
 * @returns {Record<string, string>}
 */
function assignPositionals(positionals, names) {
  if (positionals.length > names.length) {
    throw invalidInput(
      `Unexpected positional arguments: ${positionals.slice(names.length).join(' ')}`
    );
  }

  /** @type {Record<string, string>} */
  const assigned = {};
  names.forEach((name, index) => {
    if (positionals[index] !== undefined) {
      assigned[name] = positionals[index];
    }
  });
  return assigned;
}

/**
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
function normalizeInputAliases(input) {
  const normalized = { ...input };
  for (const [key, alias] of Object.entries(INPUT_ALIAS_MAP)) {
    normalized[key] = input[key] ?? input[alias];
  }
  return normalized;
}

/**
 * @param {Record<string, any>} input
 * @returns {{ cwd: string, slug?: string, oid?: string }}
 */
function resolveTarget(input) {
  if (input.slug && input.oid) {
    throw invalidInput('Provide --slug or --oid, not both');
  }
  if (!input.slug && !input.oid) {
    throw invalidInput('Provide --slug <slug> or --oid <tree-oid>');
  }
  return {
    cwd: input.cwd || '.',
    ...(input.slug ? { slug: input.slug } : {}),
    ...(input.oid ? { oid: input.oid } : {}),
  };
}

/**
 * @param {Record<string, any>} input
 * @returns {{ cwd: string, slug: string }}
 */
function resolveSlugTarget(input) {
  if (!input.slug) {
    throw invalidInput('Provide --slug <slug>');
  }

  return {
    cwd: input.cwd || '.',
    slug: input.slug,
  };
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function parsePositiveInteger(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  throw invalidInput('Expected a positive integer');
}

/**
 * @param {{ cwd: string, slug?: string, oid?: string }} input
 * @returns {Promise<{ cas: ContentAddressableStore, treeOid: string }>}
 */
async function resolveTree(input) {
  const cas = createCas(input.cwd);
  const treeOid = input.oid || (await cas.resolveVaultEntry({ slug: input.slug }));
  return { cas, treeOid };
}

/**
 * @param {string} keyFilePath
 * @returns {Buffer}
 */
function readKeyFile(keyFilePath) {
  const key = readBinaryInputFile(keyFilePath, 'key file');
  if (key.length !== 32) {
    throw invalidInput(`Invalid key length: expected 32 bytes, got ${key.length} (${keyFilePath})`);
  }
  return key;
}

/**
 * @param {string} filePath
 * @param {{ stdin?: NodeJS.ReadStream, onWarning?: (warning: Record<string, any>) => void }} [options]
 * @returns {Promise<string>}
 */
async function readAgentPassphraseFile(filePath, { stdin, onWarning } = {}) {
  if (filePath === '-') {
    const raw = await readStream(stdin || process.stdin);
    const trimmed = raw.replace(/\r?\n$/, '');
    if (!trimmed) {
      throw invalidInput('Passphrase must not be empty');
    }
    return trimmed;
  }

  const resolvedPath = path.resolve(filePath);
  try {
    const stats = statSync(resolvedPath);
    if (stats.mode & 0o077) {
      onWarning?.({
        code: 'INSECURE_FILE_PERMISSIONS',
        message: `${resolvedPath} has insecure permissions`,
        filePath: resolvedPath,
        recommendation: 'chmod 600',
      });
    }
  } catch {
    // Let the file read raise the real error.
  }

  const trimmed = readTextInputFile(resolvedPath, 'passphrase file').replace(/\r?\n$/, '');
  if (!trimmed) {
    throw invalidInput('Passphrase must not be empty');
  }

  return trimmed;
}

/**
 * @param {Record<string, any>} input
 * @returns {boolean}
 */
function hasVaultPassphraseSource(input) {
  return hasAgentPassphraseSource({
    inlineValue: input.vaultPassphrase,
    fileValue: input.vaultPassphraseFile,
    osKeychainTarget: input.osKeychainTarget,
  });
}

/**
 * @param {Record<string, any>} input
 */
function validateCredentialSources(input) {
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
    errorFactory: invalidInput,
  });
  if (input.keyFile && hasVaultPassphraseSource(input)) {
    throw invalidInput('Provide --key-file or a vault passphrase source, not both');
  }
}

/**
 * @param {Record<string, any>} input
 * @param {string | undefined} requestSource
 * @returns {Promise<string | undefined>}
 */
async function resolveVaultPassphrase(input, requestSource, options = {}) {
  return await resolveAgentPassphraseSource({
    label: 'Passphrase',
    inlineValue: input.vaultPassphrase,
    fileValue: input.vaultPassphraseFile,
    osKeychainTarget: input.osKeychainTarget,
    osKeychainAccount: input.osKeychainAccount,
    requestSource,
    readPassphraseFile: (filePath) => readAgentPassphraseFile(filePath, options),
    resolveInlinePassphrase,
    errorFactory: invalidInput,
  });
}

/**
 * @param {ContentAddressableStore} cas
 * @param {NonNullable<Awaited<ReturnType<ContentAddressableStore['getVaultMetadata']>>>} metadata
 * @param {string} passphrase
 * @returns {Promise<Buffer>}
 */
async function deriveVaultKey(cas, metadata, passphrase) {
  const { kdf } = metadata.encryption;
  const { key } = await cas.deriveKey({
    passphrase,
    salt: Buffer.from(kdf.salt, 'base64'),
    algorithm: kdf.algorithm,
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
 * @param {import('../../index.js').default} cas
 * @param {Record<string, any>} input
 * @returns {Promise<Buffer | undefined>}
 */
async function resolveStoreEncryptionKey(cas, input, options = {}) {
  validateCredentialSources(input);
  if (input.keyFile) {
    return readKeyFile(input.keyFile);
  }
  const passphrase = await resolveVaultPassphrase(input, input.requestSource, options);
  if (!passphrase) {
    return undefined;
  }
  const metadata = await cas.getVaultMetadata();
  if (!metadata?.encryption?.kdf) {
    throw invalidInput('Vault passphrase source is only valid for encrypted vaults');
  }
  return await deriveVaultKey(cas, metadata, passphrase);
}

/**
 * @param {import('../../src/domain/value-objects/Manifest.js').default} manifest
 * @returns {boolean}
 */
function hasEnvelopeRecipients(manifest) {
  return (
    Array.isArray(manifest.encryption?.recipients) && manifest.encryption.recipients.length > 0
  );
}

/**
 * @param {import('../../src/domain/value-objects/Manifest.js').default} manifest
 * @param {Awaited<ReturnType<ContentAddressableStore['getVaultMetadata']>>} metadata
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
 * @param {{
 *   cas: ContentAddressableStore,
 *   manifest: import('../../src/domain/value-objects/Manifest.js').default,
 *   input: Record<string, any>,
 *   requestSource?: string,
 *   treeOid: string,
 * }} options
 * @returns {Promise<Buffer | undefined>}
 */
async function resolveRestoreEncryptionKey({ cas, manifest, input, requestSource, treeOid }) {
  validateCredentialSources(input);
  if (input.keyFile) {
    return readKeyFile(input.keyFile);
  }

  const metadata = await cas.getVaultMetadata();
  const passphrase = await resolveVaultPassphrase(input, requestSource, {
    stdin: input.stdin,
    onWarning: input.onWarning,
  });

  if (passphrase) {
    if (hasEnvelopeRecipients(manifest)) {
      throw invalidInput(
        'Vault passphrase source cannot decrypt recipient-encrypted assets; provide --key-file'
      );
    }
    if (!metadata?.encryption?.kdf) {
      throw invalidInput('Vault passphrase source is only valid for encrypted vaults');
    }
    return await deriveVaultKey(cas, metadata, passphrase);
  }

  if (!manifest.encryption?.encrypted) {
    return undefined;
  }

  throw needsInput('Encrypted restore requires --key-file or a vault passphrase source', {
    requiredInputs: getRestoreRequiredInputs(manifest, metadata),
    slug: input.slug || manifest.slug,
    treeOid,
  });
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<Record<string, any>>}
 */
async function parseStoreInput(args, stdin) {
  const { values, positionals, requestSource } = await parseAgentInput(
    args,
    {
      slug: { type: 'string' },
      tree: { type: 'boolean' },
      force: { type: 'boolean' },
      gzip: { type: 'boolean' },
      cwd: { type: 'string' },
      'key-file': { type: 'string' },
      'vault-passphrase': { type: 'string' },
      'vault-passphrase-file': { type: 'string' },
      'os-keychain-target': { type: 'string' },
      'os-keychain-account': { type: 'string' },
    },
    stdin
  );
  return normalizeInputAliases({
    ...values,
    ...assignPositionals(positionals, ['file']),
    requestSource,
  });
}

/**
 * @param {Record<string, any>} input
 */
function validateStoreInput(input) {
  if (input.file !== undefined && typeof input.file !== 'string') {
    throw invalidInput('Request field "file" must be a string');
  }
  if (!input.file) {
    throw invalidInput('Provide a file path');
  }
  if (!input.slug) {
    throw invalidInput('Provide --slug <slug>');
  }
  if (input.force && !input.tree) {
    throw invalidInput('--force requires --tree');
  }
}

/**
 * @param {{
 *   input: Record<string, any>,
 *   manifest: import('../../src/domain/value-objects/Manifest.js').default,
 *   treeOid?: string,
 *   commitOid?: string,
 * }} options
 * @returns {{ data: Record<string, any> }}
 */
function buildStoreOutcome({ input, manifest, treeOid, commitOid }) {
  return {
    data: {
      slug: input.slug,
      manifest: manifest.toJSON(),
      ...(treeOid ? { treeOid } : {}),
      ...(commitOid ? { commitOid } : {}),
      addedToVault: Boolean(commitOid),
      chunkCount: manifest.chunks.length,
      encrypted: Boolean(manifest.encryption?.encrypted),
      compressed: Boolean(manifest.compression),
    },
  };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<Record<string, any>>}
 */
async function parseVaultInitInput(args, stdin) {
  const { values, positionals, requestSource } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
      algorithm: { type: 'string' },
      passphrase: { type: 'string' },
      'passphrase-file': { type: 'string' },
      'os-keychain-target': { type: 'string' },
      'os-keychain-account': { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  return normalizeInputAliases({
    ...values,
    requestSource,
  });
}

/**
 * @param {Record<string, any>} input
 */
function validateVaultInitInput(input) {
  validateAgentPassphraseSource({
    inlineValue: input.passphrase,
    fileValue: input.passphraseFile,
    osKeychainTarget: input.osKeychainTarget,
    osKeychainAccount: input.osKeychainAccount,
    inlineFlag: '--passphrase',
    fileFlag: '--passphrase-file',
    keychainTargetFlag: '--os-keychain-target',
    keychainAccountFlag: '--os-keychain-account',
    label: 'passphrase source',
    errorFactory: invalidInput,
  });

  const algorithm = parseKdfAlgorithm(input.algorithm);
  if (
    algorithm &&
    !hasAgentPassphraseSource({
      inlineValue: input.passphrase,
      fileValue: input.passphraseFile,
      osKeychainTarget: input.osKeychainTarget,
    })
  ) {
    throw invalidInput(
      'Provide --passphrase <pass>, --passphrase-file <path>, or --os-keychain-target <target> when using --algorithm'
    );
  }
}

/**
 * @param {Record<string, any>} input
 * @param {string | undefined} requestSource
 * @returns {Promise<string | undefined>}
 */
async function resolveVaultInitPassphrase(input, requestSource, options = {}) {
  return await resolveAgentPassphraseSource({
    label: 'Passphrase',
    inlineValue: input.passphrase,
    fileValue: input.passphraseFile,
    osKeychainTarget: input.osKeychainTarget,
    osKeychainAccount: input.osKeychainAccount,
    requestSource,
    readPassphraseFile: (filePath) => readAgentPassphraseFile(filePath, options),
    resolveInlinePassphrase,
    errorFactory: invalidInput,
  });
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<Record<string, any>>}
 */
async function parseRotateInput(args, stdin) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      slug: { type: 'string' },
      oid: { type: 'string' },
      label: { type: 'string' },
      cwd: { type: 'string' },
      'old-key-file': { type: 'string' },
      'new-key-file': { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  return normalizeInputAliases(values);
}

/**
 * @param {Record<string, any>} input
 */
function validateRotateInput(input) {
  if (!input.oldKeyFile) {
    throw invalidInput('Provide --old-key-file <path>');
  }
  if (!input.newKeyFile) {
    throw invalidInput('Provide --new-key-file <path>');
  }
}

/**
 * @param {unknown} value
 * @returns {'pbkdf2' | 'scrypt' | undefined}
 */
function parseKdfAlgorithm(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'pbkdf2' || value === 'scrypt') {
    return value;
  }
  throw invalidInput('Provide --algorithm <pbkdf2|scrypt>');
}

/**
 * @param {string} label
 * @param {unknown} value
 * @returns {string | undefined}
 */
function resolveInlinePassphrase(label, value) {
  if (value === undefined) {
    return undefined;
  }

  const passphrase = String(value);
  if (!passphrase.trim()) {
    throw invalidInput(`${label} must not be empty`);
  }

  return passphrase;
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<Record<string, any>>}
 */
async function parseVaultRotateInput(args, stdin) {
  const { values, positionals, requestSource } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
      algorithm: { type: 'string' },
      'old-passphrase': { type: 'string' },
      'new-passphrase': { type: 'string' },
      'old-passphrase-file': { type: 'string' },
      'new-passphrase-file': { type: 'string' },
      'old-os-keychain-target': { type: 'string' },
      'old-os-keychain-account': { type: 'string' },
      'new-os-keychain-target': { type: 'string' },
      'new-os-keychain-account': { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  return normalizeInputAliases({
    ...values,
    requestSource,
  });
}

/**
 * @param {Record<string, any>} input
 */
function validateVaultRotateInput(input) {
  validateAgentPassphraseSource({
    inlineValue: input.oldPassphrase,
    fileValue: input.oldPassphraseFile,
    osKeychainTarget: input.oldOsKeychainTarget,
    osKeychainAccount: input.oldOsKeychainAccount,
    inlineFlag: '--old-passphrase',
    fileFlag: '--old-passphrase-file',
    keychainTargetFlag: '--old-os-keychain-target',
    keychainAccountFlag: '--old-os-keychain-account',
    label: 'old passphrase source',
    errorFactory: invalidInput,
  });
  validateAgentPassphraseSource({
    inlineValue: input.newPassphrase,
    fileValue: input.newPassphraseFile,
    osKeychainTarget: input.newOsKeychainTarget,
    osKeychainAccount: input.newOsKeychainAccount,
    inlineFlag: '--new-passphrase',
    fileFlag: '--new-passphrase-file',
    keychainTargetFlag: '--new-os-keychain-target',
    keychainAccountFlag: '--new-os-keychain-account',
    label: 'new passphrase source',
    errorFactory: invalidInput,
  });
  if (!hasAgentPassphraseSource({
    inlineValue: input.oldPassphrase,
    fileValue: input.oldPassphraseFile,
    osKeychainTarget: input.oldOsKeychainTarget,
  })) {
    throw invalidInput(
      'Provide --old-passphrase <pass>, --old-passphrase-file <path>, or --old-os-keychain-target <target>'
    );
  }
  if (!hasAgentPassphraseSource({
    inlineValue: input.newPassphrase,
    fileValue: input.newPassphraseFile,
    osKeychainTarget: input.newOsKeychainTarget,
  })) {
    throw invalidInput(
      'Provide --new-passphrase <pass>, --new-passphrase-file <path>, or --new-os-keychain-target <target>'
    );
  }

  parseKdfAlgorithm(input.algorithm);
}

/**
 * @param {Record<string, any>} input
 * @param {string | undefined} requestSource
 * @returns {Promise<{ oldPassphrase: string, newPassphrase: string }>}
 */
async function resolveVaultRotatePassphrases(input, requestSource, options = {}) {
  validateVaultRotateStdinSources(input, requestSource);

  return {
    oldPassphrase: await readVaultRotatePassphrase({
      label: 'Old passphrase',
      inlineValue: input.oldPassphrase,
      fileValue: input.oldPassphraseFile,
      osKeychainTarget: input.oldOsKeychainTarget,
      osKeychainAccount: input.oldOsKeychainAccount,
      requestSource,
      ...options,
    }),
    newPassphrase: await readVaultRotatePassphrase({
      label: 'New passphrase',
      inlineValue: input.newPassphrase,
      fileValue: input.newPassphraseFile,
      osKeychainTarget: input.newOsKeychainTarget,
      osKeychainAccount: input.newOsKeychainAccount,
      requestSource,
      ...options,
    }),
  };
}

/**
 * @param {Record<string, any>} input
 * @param {string | undefined} requestSource
 */
function validateVaultRotateStdinSources(input, requestSource) {
  if (input.oldPassphraseFile === '-' && input.newPassphraseFile === '-') {
    throw invalidInput('Cannot read both old and new passphrase from stdin');
  }
  if (
    requestSource === '-' &&
    (input.oldPassphraseFile === '-' || input.newPassphraseFile === '-')
  ) {
    throw invalidInput('Cannot read both request payload and vault rotation passphrase from stdin');
  }
}

/**
 * @param {{
 *   label: string,
 *   inlineValue: unknown,
 *   fileValue?: string,
 *   osKeychainTarget?: string,
 *   osKeychainAccount?: string,
 *   requestSource?: string,
 *   stdin?: NodeJS.ReadStream,
 *   onWarning?: (warning: Record<string, any>) => void,
 * }} options
 * @returns {Promise<string>}
 */
async function readVaultRotatePassphrase({
  label,
  inlineValue,
  fileValue,
  osKeychainTarget,
  osKeychainAccount,
  requestSource,
  ...options
}) {
  const passphrase = await resolveAgentPassphraseSource({
    label,
    inlineValue,
    fileValue,
    osKeychainTarget,
    osKeychainAccount,
    requestSource,
    readPassphraseFile: (filePath) => readAgentPassphraseFile(filePath, options),
    resolveInlinePassphrase,
    errorFactory: invalidInput,
  });

  if (!passphrase?.trim()) {
    throw invalidInput(`${label} must not be empty`);
  }

  return passphrase;
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<Record<string, any>>}
 */
async function parseRecipientAddInput(args, stdin) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      slug: { type: 'string' },
      label: { type: 'string' },
      cwd: { type: 'string' },
      'key-file': { type: 'string' },
      'existing-key-file': { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  return normalizeInputAliases(values);
}

/**
 * @param {Record<string, any>} input
 */
function validateRecipientAddInput(input) {
  if (!input.slug) {
    throw invalidInput('Provide --slug <slug>');
  }
  if (!input.label) {
    throw invalidInput('Provide --label <label>');
  }
  if (!input.keyFile) {
    throw invalidInput('Provide --key-file <path>');
  }
  if (!input.existingKeyFile) {
    throw invalidInput('Provide --existing-key-file <path>');
  }
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<Record<string, any>>}
 */
async function parseRecipientRemoveInput(args, stdin) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      slug: { type: 'string' },
      label: { type: 'string' },
      cwd: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  return values;
}

/**
 * @param {Record<string, any>} input
 */
function validateRecipientRemoveInput(input) {
  if (!input.slug) {
    throw invalidInput('Provide --slug <slug>');
  }
  if (!input.label) {
    throw invalidInput('Provide --label <label>');
  }
}

/**
 * @param {{ cwd: string, slug: string }} input
 * @returns {Promise<{
 *   cas: ContentAddressableStore,
 *   treeOid: string,
 *   manifest: import('../../src/domain/value-objects/Manifest.js').default,
 * }>}
 */
async function resolveVaultManifestBySlug(input) {
  const cas = createCas(input.cwd);
  const treeOid = await cas.resolveVaultEntry({ slug: input.slug });
  const manifest = await cas.readManifest({ treeOid });
  return { cas, treeOid, manifest };
}

/**
 * @param {{
 *   action: 'add' | 'remove',
 *   slug: string,
 *   label: string,
 *   previousTreeOid: string,
 *   treeOid: string,
 *   commitOid: string,
 *   manifest: import('../../src/domain/value-objects/Manifest.js').default,
 * }} options
 * @returns {{ data: Record<string, any> }}
 */
function buildRecipientMutationOutcome({
  action,
  slug,
  label,
  previousTreeOid,
  treeOid,
  commitOid,
  manifest,
}) {
  const recipients = buildRecipientRows(manifest);

  return {
    data: {
      action,
      slug,
      label,
      previousTreeOid,
      treeOid,
      commitOid,
      recipientCount: recipients.length,
      recipients,
    },
  };
}

/**
 * @param {{
 *   previousTreeOid: string,
 *   treeOid: string,
 *   commitOid?: string,
 *   manifest: import('../../src/domain/value-objects/Manifest.js').default,
 *   label?: string,
 * }} options
 * @returns {{ data: Record<string, any> }}
 */
function buildRotateOutcome({ previousTreeOid, treeOid, commitOid, manifest, label }) {
  const recipients = buildRecipientRows(manifest);

  return {
    data: {
      action: 'rotate',
      slug: manifest.slug,
      ...(label ? { label } : {}),
      previousTreeOid,
      treeOid,
      ...(commitOid ? { commitOid } : {}),
      updatedVault: Boolean(commitOid),
      keyVersion: manifest.encryption?.keyVersion,
      recipientCount: recipients.length,
      recipients,
    },
  };
}

/**
 * @param {{
 *   commitOid: string,
 *   rotatedSlugs: string[],
 *   skippedSlugs: string[],
 *   kdfAlgorithm?: string,
 * }} options
 * @returns {{ data: Record<string, any> }}
 */
function buildVaultRotateOutcome({ commitOid, rotatedSlugs, skippedSlugs, kdfAlgorithm }) {
  return {
    data: {
      commitOid,
      updatedVault: true,
      rotatedSlugs,
      skippedSlugs,
      rotatedCount: rotatedSlugs.length,
      skippedCount: skippedSlugs.length,
      entryCount: rotatedSlugs.length + skippedSlugs.length,
      ...(kdfAlgorithm ? { kdfAlgorithm } : {}),
    },
  };
}

/**
 * @param {{
 *   commitOid: string,
 *   encrypted: boolean,
 *   kdfAlgorithm?: string,
 * }} options
 * @returns {{ data: Record<string, any> }}
 */
function buildVaultInitOutcome({ commitOid, encrypted, kdfAlgorithm }) {
  return {
    data: {
      commitOid,
      initializedVault: true,
      encrypted,
      ...(kdfAlgorithm ? { kdfAlgorithm } : {}),
    },
  };
}

/**
 * @param {{
 *   slug: string,
 *   commitOid: string,
 *   removedTreeOid: string,
 * }} options
 * @returns {{ data: Record<string, any> }}
 */
function buildVaultRemoveOutcome({ slug, commitOid, removedTreeOid }) {
  return {
    data: {
      slug,
      commitOid,
      removedTreeOid,
      updatedVault: true,
    },
  };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<Record<string, any>>}
 */
async function parseTreeInput(args, stdin) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      manifest: { type: 'string' },
      cwd: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  return values;
}

/**
 * @param {Record<string, any>} input
 * @returns {Manifest}
 */
function resolveManifestInput(input) {
  if (typeof input.manifest === 'string') {
    const manifestPath = input.manifest;
    const raw = readTextInputFile(manifestPath, 'manifest file');
    try {
      return new Manifest(JSON.parse(raw));
    } catch (err) {
      throw normalizeLocalInputError(err, 'manifest file', manifestPath);
    }
  }

  if (input.manifest && typeof input.manifest === 'object' && !Array.isArray(input.manifest)) {
    try {
      return new Manifest(input.manifest);
    } catch (err) {
      throw invalidInput(
        `Invalid manifest object: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw invalidInput('Provide --manifest <path> or request.manifest');
}

/**
 * @param {Manifest} manifest
 * @param {string} treeOid
 * @returns {{ data: Record<string, any> }}
 */
function buildTreeOutcome(manifest, treeOid) {
  return {
    data: {
      treeOid,
      slug: manifest.slug,
      chunkCount: manifest.chunks.length,
      encrypted: Boolean(manifest.encryption?.encrypted),
      compressed: Boolean(manifest.compression),
    },
  };
}

/**
 * @param {string[]} argv
 * @returns {{ command: string, args: string[] }}
 */
function resolveCommand(argv) {
  if (argv.length === 0) {
    return { command: 'agent', args: [] };
  }

  if (argv[0] === 'vault' || argv[0] === 'recipient') {
    if (!argv[1]) {
      return { command: argv[0], args: [] };
    }
    return { command: `${argv[0]}.${argv[1]}`, args: argv.slice(2) };
  }

  return { command: argv[0], args: argv.slice(1) };
}

/**
 * @param {string[]} argv
 * @param {{ stdout?: Pick<NodeJS.WriteStream, 'write'>, stderr?: Pick<NodeJS.WriteStream, 'write'>, stdin?: NodeJS.ReadStream }} [deps]
 * @returns {Promise<void>}
 */
export async function runAgentCli(
  argv,
  { stdout = process.stdout, stderr = process.stderr, stdin = process.stdin } = {}
) {
  const { command, args } = resolveCommand(argv);
  const session = createAgentSession({ command, stdout, stderr });

  try {
    const outcome = await executeAgentCommand(command, args, { stdin, session });
    const exitCode = outcome.exitCode ?? AGENT_EXIT_CODES.SUCCESS;
    process.exitCode = exitCode;
    session.writeResult(outcome.data);
    session.writeEnd({ ok: exitCode === AGENT_EXIT_CODES.SUCCESS, exitCode });
  } catch (err) {
    const exitCode = getAgentExitCode(err);
    process.exitCode = exitCode;
    if (err instanceof Error && err.code === 'NEEDS_INPUT') {
      session.writeNeedsInput(err);
    } else {
      session.writeError(err);
    }
    session.writeEnd({ ok: false, exitCode });
  }
}

const COMMAND_HANDLERS = Object.freeze({
  store: storeCommand,
  tree: treeCommand,
  restore: restoreCommand,
  rotate: rotateCommand,
  inspect: inspectCommand,
  verify: verifyCommand,
  doctor: doctorCommand,
  'recipient.add': recipientAddCommand,
  'recipient.remove': recipientRemoveCommand,
  'recipient.list': recipientListCommand,
  'vault.init': vaultInitCommand,
  'vault.list': vaultListCommand,
  'vault.info': vaultInfoCommand,
  'vault.history': vaultHistoryCommand,
  'vault.remove': vaultRemoveCommand,
  'vault.rotate': vaultRotateCommand,
  'vault.stats': vaultStatsCommand,
});

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ stdin: NodeJS.ReadStream, session: ReturnType<typeof createAgentSession> }} context
 * @returns {Promise<{ exitCode?: number, data: Record<string, any> }>}
 */
async function executeAgentCommand(command, args, context) {
  const handler = COMMAND_HANDLERS[command];

  if (!handler) {
    throw invalidInput('Unknown agent command', {
      command,
      availableCommands: AVAILABLE_COMMANDS,
    });
  }

  return handler(args, context.stdin, context.session);
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ input: Record<string, any>, requestSource?: string }>}
 */
async function parseRestoreInput(args, stdin) {
  const { values, positionals, requestSource } = await parseAgentInput(
    args,
    {
      slug: { type: 'string' },
      oid: { type: 'string' },
      out: { type: 'string' },
      cwd: { type: 'string' },
      'key-file': { type: 'string' },
      'vault-passphrase': { type: 'string' },
      'vault-passphrase-file': { type: 'string' },
      'os-keychain-target': { type: 'string' },
      'os-keychain-account': { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);

  return {
    input: normalizeInputAliases(values),
    requestSource,
  };
}

/**
 * @param {{
 *   manifest: import('../../src/domain/value-objects/Manifest.js').default,
 *   treeOid: string,
 *   outputPath: string,
 *   bytesWritten: number,
 * }} options
 * @returns {{ data: Record<string, any> }}
 */
function buildRestoreOutcome({ manifest, treeOid, outputPath, bytesWritten }) {
  return {
    data: {
      slug: manifest.slug,
      treeOid,
      outputPath,
      bytesWritten,
      encrypted: Boolean(manifest.encryption?.encrypted),
    },
  };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function storeCommand(args, stdin, session) {
  const input = await parseStoreInput(args, stdin);
  validateStoreInput(input);
  validateCredentialSources(input);
  writeAgentStart(
    session,
    selectStartInput(input, [
      'cwd',
      'file',
      'slug',
      'tree',
      'force',
      'gzip',
      'keyFile',
      'vaultPassphrase',
      'vaultPassphraseFile',
      'osKeychainTarget',
      'osKeychainAccount',
      'requestSource',
    ])
  );

  const cas = createCas(input.cwd || '.');
  const encryptionKey = await resolveStoreEncryptionKey(cas, input, {
    stdin,
    onWarning: (warning) => session.writeWarning(warning),
  });
  const vaultEncryptionKey = encryptionKey && !input.keyFile ? encryptionKey : undefined;
  const manifest = await cas.storeFile({
    filePath: input.file,
    slug: input.slug,
    ...(encryptionKey ? { encryptionKey } : {}),
    ...(input.gzip ? { compression: { algorithm: 'gzip' } } : {}),
  });

  let treeOid;
  let commitOid;
  if (input.tree) {
    treeOid = await cas.createTree({ manifest });
    ({ commitOid } = await cas.addToVault({
      slug: input.slug,
      treeOid,
      force: Boolean(input.force),
      ...(vaultEncryptionKey ? { encryptionKey: vaultEncryptionKey } : {}),
    }));
  }

  return buildStoreOutcome({ input, manifest, treeOid, commitOid });
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function treeCommand(args, stdin, session) {
  const input = await parseTreeInput(args, stdin);
  const manifest = resolveManifestInput(input);
  writeAgentStart(session, selectStartInput(input, ['cwd', 'manifest', 'requestSource']));
  const cas = createCas(input.cwd || '.');
  const treeOid = await cas.createTree({ manifest });

  return buildTreeOutcome(manifest, treeOid);
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function restoreCommand(args, stdin, session) {
  const { input, requestSource } = await parseRestoreInput(args, stdin);
  if (!input.out) {
    throw invalidInput('Provide --out <path>');
  }
  validateCredentialSources(input);
  const target = resolveTarget(input);
  writeAgentStart(
    session,
    selectStartInput(input, [
      'cwd',
      'slug',
      'oid',
      'out',
      'keyFile',
      'vaultPassphrase',
      'vaultPassphraseFile',
      'osKeychainTarget',
      'osKeychainAccount',
      'requestSource',
    ])
  );
  const { cas, treeOid } = await resolveTree(target);
  const manifest = await cas.readManifest({ treeOid });
  const encryptionKey = await resolveRestoreEncryptionKey({
    cas,
    manifest,
    input: {
      ...input,
      stdin,
      onWarning: (warning) => session.writeWarning(warning),
    },
    requestSource,
    treeOid,
  });
  const { bytesWritten } = await cas.restoreFile({
    manifest,
    ...(encryptionKey ? { encryptionKey } : {}),
    outputPath: input.out,
  });

  return buildRestoreOutcome({
    manifest,
    treeOid,
    outputPath: input.out,
    bytesWritten,
  });
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function rotateCommand(args, stdin, session) {
  const input = await parseRotateInput(args, stdin);
  const target = resolveTarget(input);
  validateRotateInput(input);
  writeAgentStart(
    session,
    selectStartInput(input, ['cwd', 'slug', 'oid', 'label', 'oldKeyFile', 'newKeyFile'])
  );

  const { cas, treeOid: previousTreeOid } = await resolveTree(target);
  const manifest = await cas.readManifest({ treeOid: previousTreeOid });
  const updated = await cas.rotateKey({
    manifest,
    oldKey: readKeyFile(input.oldKeyFile),
    newKey: readKeyFile(input.newKeyFile),
    ...(input.label ? { label: input.label } : {}),
  });

  const treeOid = await cas.createTree({ manifest: updated });
  let commitOid;
  if (input.slug) {
    ({ commitOid } = await cas.addToVault({
      slug: input.slug,
      treeOid,
      force: true,
    }));
  }

  return buildRotateOutcome({
    previousTreeOid,
    treeOid,
    commitOid,
    manifest: updated,
    label: input.label,
  });
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function inspectCommand(args, stdin, session) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      slug: { type: 'string' },
      oid: { type: 'string' },
      cwd: { type: 'string' },
    },
    stdin
  );
  const positionalInput = assignPositionals(positionals, []);
  const input = resolveTarget({ ...values, ...positionalInput });
  writeAgentStart(session, selectStartInput(input, ['cwd', 'slug', 'oid']));
  const { cas, treeOid } = await resolveTree(input);
  const manifest = await cas.readManifest({ treeOid });
  return {
    data: {
      treeOid,
      manifest: manifest.toJSON(),
    },
  };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ exitCode: number, data: Record<string, any> }>}
 */
async function verifyCommand(args, stdin, session) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      slug: { type: 'string' },
      oid: { type: 'string' },
      cwd: { type: 'string' },
    },
    stdin
  );
  const positionalInput = assignPositionals(positionals, []);
  const input = resolveTarget({ ...values, ...positionalInput });
  writeAgentStart(session, selectStartInput(input, ['cwd', 'slug', 'oid']));
  const { cas, treeOid } = await resolveTree(input);
  const manifest = await cas.readManifest({ treeOid });
  const ok = await cas.verifyIntegrity(manifest);

  return {
    exitCode: ok ? AGENT_EXIT_CODES.SUCCESS : AGENT_EXIT_CODES.VERIFICATION_FAILED,
    data: {
      ok,
      slug: manifest.slug,
      treeOid,
      chunks: manifest.chunks.length,
    },
  };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ exitCode: number, data: Record<string, any> }>}
 */
async function doctorCommand(args, stdin, session) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  writeAgentStart(session, selectStartInput(values, ['cwd']));

  const cas = createCas(values.cwd || '.');
  const report = await inspectVaultHealth(cas);
  const exitCode =
    report.status === 'ok' ? AGENT_EXIT_CODES.SUCCESS : AGENT_EXIT_CODES.VERIFICATION_FAILED;

  return {
    exitCode,
    data: { report },
  };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function recipientAddCommand(args, stdin, session) {
  const input = await parseRecipientAddInput(args, stdin);
  validateRecipientAddInput(input);
  writeAgentStart(
    session,
    selectStartInput(input, ['cwd', 'slug', 'label', 'keyFile', 'existingKeyFile'])
  );

  const target = resolveSlugTarget(input);
  const { cas, treeOid: previousTreeOid, manifest } = await resolveVaultManifestBySlug(target);
  const updated = await cas.addRecipient({
    manifest,
    existingKey: readKeyFile(input.existingKeyFile),
    newRecipientKey: readKeyFile(input.keyFile),
    label: input.label,
  });
  const treeOid = await cas.createTree({ manifest: updated });
  const { commitOid } = await cas.addToVault({
    slug: input.slug,
    treeOid,
    force: true,
  });

  return buildRecipientMutationOutcome({
    action: 'add',
    slug: input.slug,
    label: input.label,
    previousTreeOid,
    treeOid,
    commitOid,
    manifest: updated,
  });
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function recipientRemoveCommand(args, stdin, session) {
  const input = await parseRecipientRemoveInput(args, stdin);
  validateRecipientRemoveInput(input);
  writeAgentStart(session, selectStartInput(input, ['cwd', 'slug', 'label']));

  const target = resolveSlugTarget(input);
  const { cas, treeOid: previousTreeOid, manifest } = await resolveVaultManifestBySlug(target);
  const updated = await cas.removeRecipient({
    manifest,
    label: input.label,
  });
  const treeOid = await cas.createTree({ manifest: updated });
  const { commitOid } = await cas.addToVault({
    slug: input.slug,
    treeOid,
    force: true,
  });

  return buildRecipientMutationOutcome({
    action: 'remove',
    slug: input.slug,
    label: input.label,
    previousTreeOid,
    treeOid,
    commitOid,
    manifest: updated,
  });
}

/**
 * @param {import('../../src/domain/value-objects/Manifest.js').default} manifest
 * @returns {Array<{ label: string, keyVersion?: number }>}
 */
function buildRecipientRows(manifest) {
  return (manifest.encryption?.recipients || []).map((recipient) => ({
    label: recipient.label,
    ...(recipient.keyVersion !== undefined ? { keyVersion: recipient.keyVersion } : {}),
  }));
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function recipientListCommand(args, stdin, session) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      slug: { type: 'string' },
      oid: { type: 'string' },
      cwd: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);

  const input = resolveTarget(values);
  writeAgentStart(session, selectStartInput(input, ['cwd', 'slug', 'oid']));
  const { cas, treeOid } = await resolveTree(input);
  const manifest = await cas.readManifest({ treeOid });
  const recipients = buildRecipientRows(manifest);

  return {
    data: {
      slug: manifest.slug,
      treeOid,
      envelope: recipients.length > 0,
      recipientCount: recipients.length,
      recipients,
    },
  };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function vaultInitCommand(args, stdin, session) {
  const input = await parseVaultInitInput(args, stdin);
  validateVaultInitInput(input);
  writeAgentStart(
    session,
    selectStartInput(input, [
      'cwd',
      'algorithm',
      'passphrase',
      'passphraseFile',
      'osKeychainTarget',
      'osKeychainAccount',
      'requestSource',
    ])
  );

  const passphrase = await resolveVaultInitPassphrase(input, input.requestSource, {
    stdin,
    onWarning: (warning) => session.writeWarning(warning),
  });
  const algorithm = parseKdfAlgorithm(input.algorithm);
  const cas = createCas(input.cwd || '.');
  const { commitOid } = await cas.initVault({
    ...(passphrase ? { passphrase } : {}),
    ...(passphrase && algorithm ? { kdfOptions: { algorithm } } : {}),
  });
  const metadata = await cas.getVaultMetadata();

  return buildVaultInitOutcome({
    commitOid,
    encrypted: Boolean(metadata?.encryption),
    kdfAlgorithm: metadata?.encryption?.kdf?.algorithm,
  });
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function vaultRemoveCommand(args, stdin, session) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      slug: { type: 'string' },
      cwd: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);

  if (!values.slug) {
    throw invalidInput('Provide --slug <slug>');
  }
  writeAgentStart(session, selectStartInput(values, ['cwd', 'slug']));

  const cas = createCas(values.cwd || '.');
  const { commitOid, removedTreeOid } = await cas.removeFromVault({ slug: values.slug });

  return buildVaultRemoveOutcome({
    slug: values.slug,
    commitOid,
    removedTreeOid,
  });
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function vaultRotateCommand(args, stdin, session) {
  const input = await parseVaultRotateInput(args, stdin);
  validateVaultRotateInput(input);
  writeAgentStart(
    session,
    selectStartInput(input, [
      'cwd',
      'algorithm',
      'oldPassphrase',
      'oldPassphraseFile',
      'oldOsKeychainTarget',
      'oldOsKeychainAccount',
      'newPassphrase',
      'newPassphraseFile',
      'newOsKeychainTarget',
      'newOsKeychainAccount',
      'requestSource',
    ])
  );

  const { oldPassphrase, newPassphrase } = await resolveVaultRotatePassphrases(
    input,
    input.requestSource,
    {
      stdin,
      onWarning: (warning) => session.writeWarning(warning),
    }
  );
  const cas = createCas(input.cwd || '.');
  const { commitOid, rotatedSlugs, skippedSlugs } = await cas.rotateVaultPassphrase({
    oldPassphrase,
    newPassphrase,
    ...(input.algorithm ? { kdfOptions: { algorithm: parseKdfAlgorithm(input.algorithm) } } : {}),
  });
  const metadata = await cas.getVaultMetadata();

  return buildVaultRotateOutcome({
    commitOid,
    rotatedSlugs,
    skippedSlugs,
    kdfAlgorithm: metadata?.encryption?.kdf?.algorithm,
  });
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function vaultListCommand(args, stdin, session) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
      filter: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  writeAgentStart(session, selectStartInput(values, ['cwd', 'filter']));

  const cas = createCas(values.cwd || '.');
  const all = await cas.listVault();
  const entries = filterEntries(all, values.filter);

  return {
    data: { entries },
  };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function vaultInfoCommand(args, stdin, session) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
      encryption: { type: 'boolean' },
    },
    stdin
  );
  const input = { ...values, ...assignPositionals(positionals, ['slug']) };

  if (!input.slug) {
    throw invalidInput('Provide a vault slug');
  }
  writeAgentStart(session, selectStartInput(input, ['cwd', 'slug', 'encryption']));

  const cas = createCas(input.cwd || '.');
  const treeOid = await cas.resolveVaultEntry({ slug: input.slug });
  /** @type {Record<string, any>} */
  const result = {
    slug: input.slug,
    treeOid,
  };

  if (input.encryption) {
    const metadata = await cas.getVaultMetadata();
    if (metadata?.encryption) {
      result.encryption = metadata.encryption;
    }
  }

  return { data: result };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function vaultHistoryCommand(args, stdin, session) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
      'max-count': { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  const plumbing = createGitPlumbing({ cwd: values.cwd || '.' });
  const argsForGit = ['log', '--oneline', ContentAddressableStore.VAULT_REF];
  const maxCount = parsePositiveInteger(values['max-count']);
  writeAgentStart(
    session,
    selectStartInput({
      cwd: values.cwd,
      maxCount,
    }, ['cwd', 'maxCount'])
  );
  if (maxCount !== undefined) {
    argsForGit.push(`-${maxCount}`);
  }

  const output = await plumbing.execute({ args: argsForGit });
  const history = output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [commitOid, ...messageParts] = line.trim().split(/\s+/);
      return { commitOid, message: messageParts.join(' ') };
    });

  return { data: { history } };
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function vaultStatsCommand(args, stdin, session) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
      filter: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);
  writeAgentStart(session, selectStartInput(values, ['cwd', 'filter']));

  const cas = createCas(values.cwd || '.');
  const all = await cas.listVault();
  const entries = filterEntries(all, values.filter);
  const records = [];
  for (const entry of entries) {
    const manifest = await cas.readManifest({ treeOid: entry.treeOid });
    records.push({ ...entry, manifest });
  }

  return {
    data: {
      stats: buildVaultStats(records),
    },
  };
}
