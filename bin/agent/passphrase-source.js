import { resolveOsKeychainPassphrase } from '../passphrase-source.js';

/**
 * @param {{
 *   inlineValue?: unknown,
 *   fileValue?: string,
 *   osKeychainTarget?: string,
 * }} options
 * @returns {boolean}
 */
export function hasAgentPassphraseSource({ inlineValue, fileValue, osKeychainTarget }) {
  return inlineValue !== undefined || fileValue !== undefined || osKeychainTarget !== undefined;
}

/**
 * @param {{
 *   inlineValue?: unknown,
 *   fileValue?: string,
 *   osKeychainTarget?: string,
 *   osKeychainAccount?: string,
 *   inlineFlag: string,
 *   fileFlag: string,
 *   keychainTargetFlag: string,
 *   keychainAccountFlag: string,
 *   label: string,
 *   errorFactory?: (message: string) => Error,
 * }} options
 */
export function validateAgentPassphraseSource({
  inlineValue,
  fileValue,
  osKeychainTarget,
  osKeychainAccount,
  inlineFlag,
  fileFlag,
  keychainTargetFlag,
  keychainAccountFlag,
  label,
  errorFactory = (message) => new Error(message),
}) {
  const explicitSources = [
    inlineValue !== undefined,
    fileValue !== undefined,
    osKeychainTarget !== undefined,
  ].filter(Boolean).length;

  if (explicitSources > 1) {
    throw errorFactory(
      `Provide exactly one ${label}: ${inlineFlag}, ${fileFlag}, or ${keychainTargetFlag}`
    );
  }

  if (osKeychainAccount !== undefined && osKeychainTarget === undefined) {
    throw errorFactory(`Provide ${keychainTargetFlag} when using ${keychainAccountFlag}`);
  }

  if (osKeychainTarget !== undefined && !String(osKeychainTarget).trim()) {
    throw errorFactory('OS keychain target must not be empty');
  }

  if (osKeychainAccount !== undefined && !String(osKeychainAccount).trim()) {
    throw errorFactory('OS keychain account must not be empty');
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function lowerFirst(value) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

/**
 * @param {{
 *   label: string,
 *   inlineValue?: unknown,
 *   fileValue?: string,
 *   osKeychainTarget?: string,
 *   osKeychainAccount?: string,
 *   requestSource?: string,
 *   readPassphraseFile: (filePath: string) => Promise<string>,
 *   resolveInlinePassphrase: (label: string, value: unknown) => string | undefined,
 *   resolveOsKeychainPassphrase?: (options: { target: string, account?: string }) => Promise<string>,
 *   errorFactory?: (message: string) => Error,
 * }} options
 * @returns {Promise<string | undefined>}
 */
export async function resolveAgentPassphraseSource({
  label,
  inlineValue,
  fileValue,
  osKeychainTarget,
  osKeychainAccount,
  requestSource,
  readPassphraseFile,
  resolveInlinePassphrase,
  resolveOsKeychainPassphrase: resolveOsKeychainPassphraseFn = resolveOsKeychainPassphrase,
  errorFactory = (message) => new Error(message),
}) {
  if (fileValue === '-' && requestSource === '-') {
    throw errorFactory(
      `Cannot read both request payload and ${lowerFirst(label)} from stdin`
    );
  }

  if (fileValue) {
    return await readPassphraseFile(fileValue);
  }

  if (inlineValue !== undefined) {
    return resolveInlinePassphrase(label, inlineValue);
  }

  if (osKeychainTarget !== undefined) {
    return await resolveOsKeychainPassphraseFn({
      target: osKeychainTarget,
      account: osKeychainAccount,
    });
  }

  return undefined;
}
