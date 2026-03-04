import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';

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
  if (confirm) {
    const pass2 = await readHidden('Confirm passphrase: ');
    if (pass !== pass2) {
      throw new Error('Passphrases do not match');
    }
  }
  return pass;
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
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  const content = await readFile(filePath, 'utf8');
  return content.replace(/\r?\n$/, '');
}

/**
 * Reads a line with echo disabled.
 * @param {string} prompt - Prompt text.
 * @returns {Promise<string>}
 */
function readHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    process.stderr.write(prompt);
    rl.question('', (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
    rl._writeToOutput = () => {};
  });
}
