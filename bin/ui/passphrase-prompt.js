import { createInterface } from 'node:readline';
import { readFile, stat } from 'node:fs/promises';

/**
 * Prompts for a passphrase on stderr with echo disabled.
 *
 * @param {Object} [options]
 * @param {boolean} [options.confirm=false] - Require confirmation (ask twice).
 * @returns {Promise<string>}
 */
export async function promptPassphrase({ confirm = false } = {}) {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Cannot prompt for passphrase: stdin is not a TTY. ' +
      'Use --vault-passphrase-file or GIT_CAS_PASSPHRASE.',
    );
  }
  const pass = await readHidden('Passphrase: ');
  if (!pass) {
    throw new Error('Passphrase must not be empty');
  }
  if (confirm) {
    const pass2 = await readHidden('Confirm passphrase: ');
    if (pass !== pass2) {
      throw new Error('Passphrases do not match');
    }
  }
  return pass;
}

/**
 * Warns to stderr if the file at `filePath` is group- or world-readable.
 *
 * @param {string} filePath
 */
async function warnInsecurePermissions(filePath) {
  try {
    const st = await stat(filePath);
    if (st.mode & 0o077) {
      process.stderr.write(
        `warning: ${filePath} has insecure permissions — consider chmod 600\n`,
      );
    }
  } catch {
    // stat may fail on non-Unix or non-existent paths; silently skip.
  }
}

/**
 * Reads a passphrase from a file path, or from stdin when path is '-'.
 *
 * @param {string} filePath - File path, or '-' for stdin.
 * @returns {Promise<string>}
 */
export async function readPassphraseFile(filePath) {
  if (filePath === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const stdinResult = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
    if (!stdinResult) { throw new Error('Passphrase must not be empty'); }
    return stdinResult;
  }
  await warnInsecurePermissions(filePath);
  const content = await readFile(filePath, 'utf8');
  const trimmed = content.replace(/\r?\n$/, '');
  if (!trimmed) { throw new Error('Passphrase must not be empty'); }
  return trimmed;
}

/**
 * Reads a line with echo disabled.
 *
 * Uses Node.js private API `rl._writeToOutput` to suppress echo —
 * this is an intentional access to an undocumented API for password
 * input, as there is no public readline API for hidden input.
 *
 * @param {string} prompt - Prompt text.
 * @returns {Promise<string>}
 */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    process.stderr.write(prompt);
    rl.on('error', reject);
    rl.on('close', () => reject(new Error('readline closed without input')));
    rl.question('', (answer) => {
      rl.removeAllListeners('close');
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
    rl._writeToOutput = () => {};
  });
}
