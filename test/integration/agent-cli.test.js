/**
 * Integration tests — agent CLI protocol workflow via bin/git-cas.js.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 * Uses the current runtime (node/bun/deno) to invoke the CLI.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import ContentAddressableStore from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: docker compose run --build --rm test-<runtime>'
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../bin/git-cas.js');
const RUNTIME_CMD = globalThis.Bun
  ? ['bun', 'run', BIN]
  : globalThis.Deno
    ? ['deno', 'run', '-A', BIN]
    : ['node', BIN];

/**
 * @param {string} cwd
 * @returns {ContentAddressableStore}
 */
function createCas(cwd) {
  return new ContentAddressableStore({
    plumbing: createGitPlumbing({ cwd }),
  });
}

/**
 * @param {string} cwd
 */
function initBareRepo(cwd) {
  const result = spawnSync('git', ['init', '--bare'], { cwd, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? result.stdout ?? 'git init --bare failed'}`.trim());
  }
}

/**
 * @param {Buffer} content
 * @returns {{ filePath: string, dir: string }}
 */
function tempFile(content) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-cli-'));
  const filePath = path.join(dir, 'input.bin');
  writeFileSync(filePath, content);
  return { filePath, dir };
}

/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ input?: string }} [options]
 */
function runAgentCli(args, cwd, options = {}) {
  return spawnSync(RUNTIME_CMD[0], [...RUNTIME_CMD.slice(1), 'agent', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 90_000,
    ...(options.input !== undefined ? { input: options.input } : {}),
  });
}

/**
 * @param {string | undefined} output
 * @returns {Array<Record<string, any>>}
 */
function parseJsonl(output) {
  return `${output ?? ''}`
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

let repoDir;
let inputDir;
let requestDir;
let treeOid;
const original = randomBytes(4096);

beforeAll(async () => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-integ-'));
  initBareRepo(repoDir);

  const cas = createCas(repoDir);
  await cas.initVault();

  const input = tempFile(original);
  inputDir = input.dir;

  const manifest = await cas.storeFile({
    filePath: input.filePath,
    slug: 'demo/hello',
  });
  treeOid = await cas.createTree({ manifest });
  await cas.addToVault({ slug: 'demo/hello', treeOid });

  requestDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-request-'));
});

afterAll(() => {
  if (repoDir) {
    rmSync(repoDir, { recursive: true, force: true });
  }
  if (inputDir) {
    rmSync(inputDir, { recursive: true, force: true });
  }
  if (requestDir) {
    rmSync(requestDir, { recursive: true, force: true });
  }
});

function defineReadOnlyProtocolTests() {
  it('inspect emits start, result, and end rows on stdout', () => {
    const result = runAgentCli(['inspect', '--slug', 'demo/hello'], repoDir);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows.map((row) => row.type)).toEqual(['start', 'result', 'end']);
    expect(rows.map((row) => row.command)).toEqual(['inspect', 'inspect', 'inspect']);
    expect(rows[1].data).toMatchObject({
      treeOid,
      manifest: { slug: 'demo/hello' },
    });
    expect(rows[2].data).toEqual({ ok: true, exitCode: 0 });
  });

  it('verify reports success as protocol data', () => {
    const result = runAgentCli(['verify', '--slug', 'demo/hello'], repoDir);
    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows[1].data).toMatchObject({
      ok: true,
      slug: 'demo/hello',
      treeOid,
      chunks: 1,
    });
    expect(rows[2].data).toEqual({ ok: true, exitCode: 0 });
  });

  it('doctor reports health through the protocol', () => {
    const result = runAgentCli(['doctor'], repoDir);
    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows[1].data.report).toMatchObject({
      status: 'ok',
      hasVault: true,
      entryCount: 1,
    });
  });
}

function defineVaultProtocolTests() {
  it('vault list returns entries in a result row', () => {
    const result = runAgentCli(['vault', 'list'], repoDir);
    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows[1].data.entries).toEqual([{ slug: 'demo/hello', treeOid }]);
  });

  it('vault info, history, and stats expose structured data', () => {
    const info = runAgentCli(['vault', 'info', 'demo/hello'], repoDir);
    const history = runAgentCli(['vault', 'history', '--max-count', '1'], repoDir);
    const stats = runAgentCli(['vault', 'stats'], repoDir);

    expect(info.status).toBe(0);
    expect(history.status).toBe(0);
    expect(stats.status).toBe(0);

    const infoRows = parseJsonl(info.stdout);
    const historyRows = parseJsonl(history.stdout);
    const statsRows = parseJsonl(stats.stdout);

    expect(infoRows[1].data).toEqual({ slug: 'demo/hello', treeOid });
    expect(historyRows[1].data.history).toHaveLength(1);
    expect(historyRows[1].data.history[0].message).toContain('vault: add');
    expect(statsRows[1].data.stats).toMatchObject({
      entries: 1,
      totalLogicalSize: original.length,
      uniqueChunks: 1,
    });
  });
}

function defineRequestAndValidationTests() {
  it('inspect supports request payloads from a file', () => {
    const requestPath = path.join(requestDir, 'inspect.json');
    writeFileSync(requestPath, JSON.stringify({ slug: 'demo/hello' }));

    const result = runAgentCli(['inspect', '--request', `@${requestPath}`], repoDir);
    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows[1].data).toMatchObject({
      treeOid,
      manifest: { slug: 'demo/hello' },
    });
  });

  it('inspect emits structured invalid-input errors without human help text', () => {
    const result = runAgentCli(['inspect'], repoDir);
    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'inspect',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide --slug <slug> or --oid <tree-oid>',
      },
    });
    expect(`${result.stderr ?? ''}`).not.toContain('Usage:');
  });
}

describe('agent CLI protocol — read commands', defineReadOnlyProtocolTests);
describe('agent CLI protocol — vault commands', defineVaultProtocolTests);
describe('agent CLI protocol — request and validation', defineRequestAndValidationTests);
