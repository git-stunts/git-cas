/**
 * CLI error handler — wraps command actions with structured error output.
 */

const HINTS = {
  MISSING_KEY: 'Provide --key-file or --vault-passphrase',
  MANIFEST_NOT_FOUND: 'Verify the tree OID contains a manifest',
  VAULT_ENTRY_NOT_FOUND: "Run 'git cas vault list' to see available entries",
  VAULT_ENTRY_EXISTS: 'Use --force to overwrite',
  INTEGRITY_ERROR: 'Check that the correct key or passphrase was used',
};

/**
 * Format and write an error to stderr.
 *
 * @param {Error} err
 * @param {boolean} json - Whether to output JSON.
 */
function writeError(err, json) {
  if (json) {
    const obj = { error: err.message };
    if (typeof err.code === 'string') {
      obj.code = err.code;
    }
    process.stderr.write(`${JSON.stringify(obj)}\n`);
  } else {
    const prefix = typeof err.code === 'string' ? `error [${err.code}]: ` : 'error: ';
    process.stderr.write(`${prefix}${err.message}\n`);
    const hint = typeof err.code === 'string' ? HINTS[err.code] : undefined;
    if (hint) {
      process.stderr.write(`hint: ${hint}\n`);
    }
  }
}

/**
 * Wrap a command action with structured error handling.
 *
 * @param {Function} fn - The async action function.
 * @param {Function} getJson - Lazy getter for --json flag value.
 * @returns {Function} Wrapped action.
 */
export function runAction(fn, getJson) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      writeError(err, getJson());
      process.exit(1);
    }
  };
}

export { writeError, HINTS };
