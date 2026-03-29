import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ContentAddressableStore from '../../index.js';
import Manifest from '../../src/domain/value-objects/Manifest.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';
import { readPassphraseFile } from '../ui/passphrase-prompt.js';
import { buildVaultStats, inspectVaultHealth } from '../ui/vault-report.js';
import { filterEntries } from '../ui/vault-list.js';
import { AGENT_EXIT_CODES, createAgentSession, getAgentExitCode } from './protocol.js';

const AVAILABLE_COMMANDS = Object.freeze([
  'store',
  'tree',
  'restore',
  'inspect',
  'verify',
  'doctor',
  'vault list',
  'vault info',
  'vault history',
  'vault stats',
]);

const REQUEST_OPTION = { request: { type: 'string' } };

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
    raw = readFileSync(path.resolve(request.slice(1)), 'utf8');
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
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        ...options,
        ...REQUEST_OPTION,
      },
    });
  } catch (err) {
    throw invalidInput(err instanceof Error ? err.message : String(err));
  }

  const request = await readRequestPayload(parsed.values.request, stdin);
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
  return {
    ...input,
    keyFile: input.keyFile ?? input['key-file'],
    vaultPassphrase: input.vaultPassphrase ?? input['vault-passphrase'],
    vaultPassphraseFile: input.vaultPassphraseFile ?? input['vault-passphrase-file'],
  };
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
  const key = readFileSync(keyFilePath);
  if (key.length !== 32) {
    throw invalidInput(`Invalid key length: expected 32 bytes, got ${key.length} (${keyFilePath})`);
  }
  return key;
}

/**
 * @param {Record<string, any>} input
 * @returns {boolean}
 */
function hasVaultPassphraseSource(input) {
  return Boolean(input.vaultPassphraseFile || input.vaultPassphrase);
}

/**
 * @param {Record<string, any>} input
 */
function validateCredentialSources(input) {
  if (input.keyFile && hasVaultPassphraseSource(input)) {
    throw invalidInput('Provide --key-file or a vault passphrase source, not both');
  }
}

/**
 * @param {Record<string, any>} input
 * @param {string | undefined} requestSource
 * @returns {Promise<string | undefined>}
 */
async function resolveVaultPassphrase(input, requestSource) {
  if (input.vaultPassphraseFile === '-' && requestSource === '-') {
    throw invalidInput('Cannot read both request payload and vault passphrase from stdin');
  }
  if (input.vaultPassphraseFile) {
    return await readPassphraseFile(input.vaultPassphraseFile);
  }
  if (input.vaultPassphrase !== undefined) {
    if (!String(input.vaultPassphrase).trim()) {
      throw invalidInput('Passphrase must not be empty');
    }
    return input.vaultPassphrase;
  }
  return undefined;
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
  return key;
}

/**
 * @param {import('../../index.js').default} cas
 * @param {Record<string, any>} input
 * @param {string | undefined} requestSource
 * @returns {Promise<Buffer | undefined>}
 */
async function resolveStoreEncryptionKey(cas, input, requestSource) {
  validateCredentialSources(input);
  if (input.keyFile) {
    return readKeyFile(input.keyFile);
  }
  const passphrase = await resolveVaultPassphrase(input, requestSource);
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
    return ['keyFile', 'vaultPassphrase', 'vaultPassphraseFile'];
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
  const passphrase = await resolveVaultPassphrase(input, requestSource);

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
    const raw = readFileSync(path.resolve(input.manifest), 'utf8');
    return new Manifest(JSON.parse(raw));
  }

  if (input.manifest && typeof input.manifest === 'object' && !Array.isArray(input.manifest)) {
    return new Manifest(input.manifest);
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

  if (argv[0] === 'vault') {
    if (!argv[1]) {
      return { command: 'vault', args: [] };
    }
    return { command: `vault.${argv[1]}`, args: argv.slice(2) };
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
  session.writeStart({ argv });

  try {
    const outcome = await executeAgentCommand(command, args, stdin);
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
  inspect: inspectCommand,
  verify: verifyCommand,
  doctor: doctorCommand,
  'vault.list': vaultListCommand,
  'vault.info': vaultInfoCommand,
  'vault.history': vaultHistoryCommand,
  'vault.stats': vaultStatsCommand,
});

/**
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ exitCode?: number, data: Record<string, any> }>}
 */
async function executeAgentCommand(command, args, stdin) {
  const handler = COMMAND_HANDLERS[command];

  if (!handler) {
    throw invalidInput('Unknown agent command', {
      command,
      availableCommands: AVAILABLE_COMMANDS,
    });
  }

  return handler(args, stdin);
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function storeCommand(args, stdin) {
  const input = await parseStoreInput(args, stdin);
  validateStoreInput(input);

  const cas = createCas(input.cwd || '.');
  const encryptionKey = await resolveStoreEncryptionKey(cas, input, input.requestSource);
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
    }));
  }

  return buildStoreOutcome({ input, manifest, treeOid, commitOid });
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function treeCommand(args, stdin) {
  const input = await parseTreeInput(args, stdin);
  const manifest = resolveManifestInput(input);
  const cas = createCas(input.cwd || '.');
  const treeOid = await cas.createTree({ manifest });

  return buildTreeOutcome(manifest, treeOid);
}

/**
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ data: Record<string, any> }>}
 */
async function restoreCommand(args, stdin) {
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
    },
    stdin
  );
  assignPositionals(positionals, []);

  const input = normalizeInputAliases(values);
  if (!input.out) {
    throw invalidInput('Provide --out <path>');
  }

  const target = resolveTarget(input);
  const { cas, treeOid } = await resolveTree(target);
  const manifest = await cas.readManifest({ treeOid });
  const encryptionKey = await resolveRestoreEncryptionKey({
    cas,
    manifest,
    input,
    requestSource,
    treeOid,
  });
  const { bytesWritten } = await cas.restoreFile({
    manifest,
    ...(encryptionKey ? { encryptionKey } : {}),
    outputPath: input.out,
  });

  return {
    data: {
      slug: manifest.slug,
      treeOid,
      outputPath: input.out,
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
async function inspectCommand(args, stdin) {
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
async function verifyCommand(args, stdin) {
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
async function doctorCommand(args, stdin) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);

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
async function vaultListCommand(args, stdin) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
      filter: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);

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
async function vaultInfoCommand(args, stdin) {
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
async function vaultHistoryCommand(args, stdin) {
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
async function vaultStatsCommand(args, stdin) {
  const { values, positionals } = await parseAgentInput(
    args,
    {
      cwd: { type: 'string' },
      filter: { type: 'string' },
    },
    stdin
  );
  assignPositionals(positionals, []);

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
