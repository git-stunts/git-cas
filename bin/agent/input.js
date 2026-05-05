import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ContentAddressableStore from '../../index.js';
import Slug from '../../src/domain/value-objects/Slug.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';
import {
  hasAgentVaultPassphraseSource,
  readKeyFile as readCredentialKeyFile,
  validateAgentCredentialSources,
} from '../credentials.js';

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
export function selectStartInput(input, fields) {
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
 * @param {ReturnType<typeof import('./protocol.js').createAgentSession>} session
 * @param {Record<string, any>} input
 */
export function writeAgentStart(session, input) {
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
export function readBinaryInputFile(filePath, label) {
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
export function readTextInputFile(filePath, label) {
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
export function createCas(cwd) {
  const plumbing = createGitPlumbing({ cwd });
  return new ContentAddressableStore({ plumbing });
}

/**
 * @param {string} message
 * @param {Record<string, any>} [meta]
 * @returns {Error & { code: string, meta?: Record<string, any> }}
 */
export function invalidInput(message, meta) {
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
export function needsInput(message, meta) {
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
export async function parseAgentInput(args, options, stdin) {
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
export function assignPositionals(positionals, names) {
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
export function normalizeInputAliases(input) {
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
export function resolveTarget(input) {
  if (input.slug && input.oid) {
    throw invalidInput('Provide --slug or --oid, not both');
  }
  if (!input.slug && !input.oid) {
    throw invalidInput('Provide --slug <slug> or --oid <tree-oid>');
  }
  const slug = input.slug ? Slug.from(input.slug).toString() : undefined;
  return {
    cwd: input.cwd || '.',
    ...(slug ? { slug } : {}),
    ...(input.oid ? { oid: input.oid } : {}),
  };
}

/**
 * @param {Record<string, any>} input
 * @returns {{ cwd: string, slug: string }}
 */
export function resolveSlugTarget(input) {
  if (!input.slug) {
    throw invalidInput('Provide --slug <slug>');
  }

  return {
    cwd: input.cwd || '.',
    slug: Slug.from(input.slug).toString(),
  };
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
export function parsePositiveInteger(value) {
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
export async function resolveTree(input) {
  const cas = createCas(input.cwd);
  const treeOid = input.oid || (await cas.resolveVaultEntry({ slug: input.slug }));
  return { cas, treeOid };
}

/**
 * @param {string} keyFilePath
 * @returns {Buffer}
 */
export function readKeyFile(keyFilePath) {
  return readCredentialKeyFile(keyFilePath, {
    readFile: (filePath) => readBinaryInputFile(filePath, 'key file'),
    errorFactory: invalidInput,
  });
}

/**
 * @param {string} filePath
 * @param {{ stdin?: NodeJS.ReadStream, onWarning?: (warning: Record<string, any>) => void }} [options]
 * @returns {Promise<string>}
 */
export async function readAgentPassphraseFile(filePath, { stdin, onWarning } = {}) {
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
export function hasVaultPassphraseSource(input) {
  return hasAgentVaultPassphraseSource(input);
}

/**
 * @param {Record<string, any>} input
 */
export function validateCredentialSources(input) {
  validateAgentCredentialSources(input, { errorFactory: invalidInput });
}
