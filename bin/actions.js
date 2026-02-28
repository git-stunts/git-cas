/**
 * CLI error handler — wraps command actions with structured error output.
 */

/** @typedef {{ code?: string, message?: string }} ErrorLike */

const HINTS = {
  MISSING_KEY: 'Provide --key-file or --vault-passphrase',
  MANIFEST_NOT_FOUND: 'Verify the tree OID contains a manifest',
  VAULT_ENTRY_NOT_FOUND: "Run 'git cas vault list' to see available entries",
  VAULT_ENTRY_EXISTS: 'Use --force to overwrite',
  INTEGRITY_ERROR: 'Check that the correct key or passphrase was used',
  NO_MATCHING_RECIPIENT: 'The provided key does not match any recipient in the manifest',
  DEK_UNWRAP_FAILED: 'The existing key does not match any recipient — cannot unwrap DEK',
  RECIPIENT_NOT_FOUND: 'No recipient with that label exists in the manifest',
  RECIPIENT_ALREADY_EXISTS: 'A recipient with that label already exists',
  CANNOT_REMOVE_LAST_RECIPIENT: 'At least one recipient must remain in the manifest',
  ROTATION_NOT_SUPPORTED: 'Key rotation requires envelope encryption — store with --recipient first',
};

/**
 * Format and write an error to stderr.
 *
 * @param {ErrorLike} err
 * @param {boolean} json - Whether to output JSON.
 */
function writeError(err, json) {
  const message = err?.message ?? String(err);
  const code = typeof err?.code === 'string' ? err.code : undefined;
  if (json) {
    /** @type {{ error: string, code?: string }} */
    const obj = { error: message };
    if (code) { obj.code = code; }
    process.stderr.write(`${JSON.stringify(obj)}\n`);
  } else {
    const prefix = code ? `error [${code}]: ` : 'error: ';
    process.stderr.write(`${prefix}${message}\n`);
    const hint = code ? HINTS[/** @type {keyof HINTS} */ (code)] : undefined;
    if (hint) {
      process.stderr.write(`hint: ${hint}\n`);
    }
  }
}

/**
 * Wrap a command action with structured error handling.
 *
 * @param {(...args: any[]) => Promise<void>} fn - The async action function.
 * @param {() => boolean} getJson - Lazy getter for --json flag value.
 * @returns {(...args: any[]) => Promise<void>} Wrapped action.
 */
export function runAction(fn, getJson) {
  return async (/** @type {any[]} */ ...args) => {
    try {
      await fn(...args);
    } catch (/** @type {any} */ err) {
      writeError(err, getJson());
      process.exitCode = 1;
    }
  };
}

export { writeError, HINTS };
