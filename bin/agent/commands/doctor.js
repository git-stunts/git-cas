import { inspectVaultHealth } from '../../ui/vault-report.js';
import { resolveAgentPassphraseSource } from '../passphrase-source.js';
import { resolveAgentStoreEncryptionKey } from '../../credentials.js';
import {
  assignPositionals,
  createCas,
  invalidInput,
  normalizeInputAliases,
  parseAgentInput,
  readAgentPassphraseFile,
  selectStartInput,
  writeAgentStart,
} from '../input.js';
import { AGENT_EXIT_CODES } from '../protocol.js';

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @param {ReturnType<typeof import('../protocol.js').createAgentSession>} session
 * @returns {Promise<{ exitCode: number, data: Record<string, any> }>}
 */
export default async function doctorCommand(args, stdin, session) {
  const { values, positionals, requestSource } = await parseAgentInput(
    args,
    {
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
  const input = normalizeInputAliases({ ...values, requestSource });
  writeAgentStart(session, selectStartInput(input, [
    'cwd',
    'keyFile',
    'vaultPassphrase',
    'vaultPassphraseFile',
    'osKeychainTarget',
    'osKeychainAccount',
  ]));

  const cas = await createCas(input.cwd || '.');
  const encryptionKey = await resolveAgentStoreEncryptionKey(cas, input, {
    stdin,
    onWarning: (warning) => session.writeWarning?.(warning),
    resolveVaultPassphrase,
    errorFactory: invalidInput,
  });
  const report = await inspectVaultHealth(cas, { encryptionKey });
  const exitCode =
    report.status === 'ok' ? AGENT_EXIT_CODES.SUCCESS : AGENT_EXIT_CODES.VERIFICATION_FAILED;

  return {
    exitCode,
    data: { report },
  };
}

/**
 * @param {Record<string, any>} input
 * @param {string | undefined} requestSource
 * @param {{ stdin?: NodeJS.ReadStream, onWarning?: (warning: Record<string, any>) => void }} [options]
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
