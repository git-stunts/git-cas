import { readPassphraseFile, promptPassphrase } from './ui/passphrase-prompt.js';

export const DEFAULT_OS_KEYCHAIN_ACCOUNT = 'git-cas';

const INLINE_PASSPHRASE_WARNINGS = Object.freeze({
  vaultPassphrase:
    'warning: --vault-passphrase exposes secrets through shell history and process listings; prefer --vault-passphrase-file -, GIT_CAS_PASSPHRASE, or --os-keychain-target',
  oldPassphrase:
    'warning: --old-passphrase exposes secrets through shell history and process listings; prefer --old-passphrase-file -',
  newPassphrase:
    'warning: --new-passphrase exposes secrets through shell history and process listings; prefer --new-passphrase-file -',
});

/**
 * @param {string} value
 * @returns {string}
 */
function requireNonEmptyPassphrase(value) {
  if (!value.trim()) {
    throw new Error('Passphrase must not be empty');
  }
  return value;
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function hasEnvPassphrase(value) {
  return Boolean(value);
}

/**
 * @param {Record<string, any>} opts
 * @param {(path: string) => Promise<string>} readPassphraseFileFn
 * @returns {Promise<string | undefined>}
 */
async function resolveFileOrInlinePassphrase(opts, readPassphraseFileFn) {
  if (opts.vaultPassphraseFile !== undefined) {
    return await readPassphraseFileFn(opts.vaultPassphraseFile);
  }
  if (opts.vaultPassphrase !== undefined) {
    return requireNonEmptyPassphrase(opts.vaultPassphrase);
  }
  return undefined;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string | undefined}
 */
function resolveEnvPassphrase(env) {
  if (hasEnvPassphrase(env.GIT_CAS_PASSPHRASE)) {
    return requireNonEmptyPassphrase(env.GIT_CAS_PASSPHRASE);
  }
  return undefined;
}

/**
 * @param {Record<string, any>} opts
 * @param {{
 *   readPassphraseFile: (path: string) => Promise<string>,
 *   resolveOsKeychainPassphrase: (options: { target: string, account?: string }) => Promise<string>,
 * }} deps
 * @returns {Promise<string | undefined>}
 */
async function resolveExplicitPassphraseSource(
  opts,
  { readPassphraseFile: readPassphraseFileFn, resolveOsKeychainPassphrase: resolveOsKeychainPassphraseFn }
) {
  const fileOrInline = await resolveFileOrInlinePassphrase(opts, readPassphraseFileFn);
  if (fileOrInline !== undefined) {
    return fileOrInline;
  }
  if (opts.osKeychainTarget !== undefined) {
    return await resolveOsKeychainPassphraseFn({
      target: opts.osKeychainTarget,
      account: opts.osKeychainAccount,
    });
  }
  return undefined;
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   stdin?: { isTTY?: boolean },
 *   readPassphraseFile?: (path: string) => Promise<string>,
 *   promptPassphrase?: ({ confirm?: boolean }) => Promise<string>,
 *   resolveOsKeychainPassphrase?: (options: { target: string, account?: string }) => Promise<string>,
 * }} deps
 */
function normalizeResolveDeps(deps) {
  return {
    env: deps.env || process.env,
    stdin: deps.stdin || process.stdin,
    readPassphraseFile: deps.readPassphraseFile || readPassphraseFile,
    promptPassphrase: deps.promptPassphrase || promptPassphrase,
    resolveOsKeychainPassphrase:
      deps.resolveOsKeychainPassphrase || resolveOsKeychainPassphrase,
  };
}

/**
 * @param {{ isTTY?: boolean }} stdin
 * @param {({ confirm?: boolean }) => Promise<string>} promptPassphraseFn
 * @param {{ confirm?: boolean }} extra
 * @returns {Promise<string | undefined>}
 */
async function resolvePromptPassphrase(stdin, promptPassphraseFn, extra) {
  if (!stdin.isTTY) {
    return undefined;
  }
  return await promptPassphraseFn({ confirm: extra.confirm || false });
}

/**
 * Returns true when a non-interactive passphrase source exists.
 * Does NOT trigger prompts or consume stdin.
 *
 * @param {Record<string, any>} opts
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function hasPassphraseSource(opts, env = process.env) {
  return Boolean(
    opts.vaultPassphraseFile ||
      opts.vaultPassphrase ||
      opts.osKeychainTarget ||
      env.GIT_CAS_PASSPHRASE
  );
}

/**
 * Returns true when an explicit non-interactive passphrase source exists on the CLI.
 * Does not consider ambient environment variables.
 *
 * @param {Record<string, any>} opts
 * @returns {boolean}
 */
export function hasExplicitPassphraseSource(opts) {
  return (
    opts.vaultPassphraseFile !== undefined ||
    opts.vaultPassphrase !== undefined ||
    opts.osKeychainTarget !== undefined
  );
}

/**
 * Validate human CLI passphrase sources so explicit-but-empty values still count as provided.
 *
 * @param {Record<string, any>} opts
 */
export function validatePassphraseSources(opts) {
  const explicitSources = [
    opts.vaultPassphrase !== undefined,
    opts.vaultPassphraseFile !== undefined,
    opts.osKeychainTarget !== undefined,
  ].filter(Boolean).length;

  if (explicitSources > 1) {
    throw new Error(
      'Provide exactly one vault passphrase source: --vault-passphrase, --vault-passphrase-file, or --os-keychain-target'
    );
  }
  if (opts.osKeychainAccount !== undefined && opts.osKeychainTarget === undefined) {
    throw new Error('Provide --os-keychain-target when using --os-keychain-account');
  }
  if (opts.osKeychainTarget !== undefined && !String(opts.osKeychainTarget).trim()) {
    throw new Error('OS keychain target must not be empty');
  }
  if (opts.osKeychainAccount !== undefined && !String(opts.osKeychainAccount).trim()) {
    throw new Error('OS keychain account must not be empty');
  }
}

/**
 * @param {Record<string, any>} opts
 * @returns {string[]}
 */
export function inlinePassphraseWarnings(opts) {
  return Object.entries(INLINE_PASSPHRASE_WARNINGS)
    .filter(([key]) => opts[key] !== undefined)
    .map(([, warning]) => warning);
}

/**
 * @param {Record<string, any>} opts
 * @param {(message: string) => void} [write]
 */
export function warnInlinePassphraseArgs(
  opts,
  write = (message) => process.stderr.write(message)
) {
  for (const warning of inlinePassphraseWarnings(opts)) {
    write(`${warning}\n`);
  }
}

/**
 * Resolve a vault passphrase from the OS keychain via @git-stunts/vault.
 *
 * @param {{ target: string, account?: string, importVault?: () => Promise<any> }} options
 * @returns {Promise<string>}
 */
export async function resolveOsKeychainPassphrase({
  target,
  account = DEFAULT_OS_KEYCHAIN_ACCOUNT,
  importVault = async () => (await import('@git-stunts/vault')).default,
}) {
  if (!target?.trim()) {
    throw new Error('OS keychain target must not be empty');
  }
  if (!account?.trim()) {
    throw new Error('OS keychain account must not be empty');
  }

  const Vault = await importVault();
  const vault = new Vault({ account });
  const secret = vault.getSecret({ target });

  if (secret === undefined) {
    throw new Error(`OS keychain secret not found for account "${account}" target "${target}"`);
  }
  if (!String(secret).trim()) {
    throw new Error(
      `OS keychain secret for account "${account}" target "${target}" must not be empty`
    );
  }
  return String(secret);
}

/**
 * Resolve passphrase from (in priority order):
 * 1. --vault-passphrase-file <path>
 * 2. --vault-passphrase <pass>
 * 3. --os-keychain-target <target>
 * 4. GIT_CAS_PASSPHRASE env var
 * 5. Interactive TTY prompt (if stdin is a TTY)
 *
 * @param {Record<string, any>} opts
 * @param {{ confirm?: boolean }} [extra]
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   stdin?: { isTTY?: boolean },
 *   readPassphraseFile?: (path: string) => Promise<string>,
 *   promptPassphrase?: ({ confirm?: boolean }) => Promise<string>,
 *   resolveOsKeychainPassphrase?: (options: { target: string, account?: string }) => Promise<string>,
 * }} [deps]
 * @returns {Promise<string | undefined>}
 */
export async function resolvePassphrase(opts, extra = {}, deps = {}) {
  const resolvedDeps = normalizeResolveDeps(deps);
  const explicitPassphrase = await resolveExplicitPassphraseSource(opts, {
    readPassphraseFile: resolvedDeps.readPassphraseFile,
    resolveOsKeychainPassphrase: resolvedDeps.resolveOsKeychainPassphrase,
  });
  if (explicitPassphrase !== undefined) {
    return explicitPassphrase;
  }
  const envPassphrase = resolveEnvPassphrase(resolvedDeps.env);
  if (envPassphrase !== undefined) {
    return envPassphrase;
  }
  return await resolvePromptPassphrase(resolvedDeps.stdin, resolvedDeps.promptPassphrase, extra);
}
