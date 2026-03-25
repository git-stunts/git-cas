import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ContentAddressableStore from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';
import { buildVaultStats, inspectVaultHealth } from '../ui/vault-report.js';
import { filterEntries } from '../ui/vault-list.js';
import { AGENT_EXIT_CODES, createAgentSession, getAgentExitCode } from './protocol.js';

const AVAILABLE_COMMANDS = Object.freeze([
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
 * @returns {Promise<{ values: Record<string, any>, positionals: string[] }>}
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

  return { values, positionals: parsed.positionals };
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
    session.writeError(err);
    session.writeEnd({ ok: false, exitCode });
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ReadStream} stdin
 * @returns {Promise<{ exitCode?: number, data: Record<string, any> }>}
 */
async function executeAgentCommand(command, args, stdin) {
  switch (command) {
    case 'inspect':
      return inspectCommand(args, stdin);
    case 'verify':
      return verifyCommand(args, stdin);
    case 'doctor':
      return doctorCommand(args, stdin);
    case 'vault.list':
      return vaultListCommand(args, stdin);
    case 'vault.info':
      return vaultInfoCommand(args, stdin);
    case 'vault.history':
      return vaultHistoryCommand(args, stdin);
    case 'vault.stats':
      return vaultStatsCommand(args, stdin);
    default:
      throw invalidInput('Unknown agent command', {
        command,
        availableCommands: AVAILABLE_COMMANDS,
      });
  }
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
