/**
 * Integration tests — vault CLI workflow via bin/git-cas.js.
 *
 * Exercises every vault subcommand through the CLI entrypoint, including
 * slash-encoded slugs and encrypted vault round trips.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 * Uses the current runtime (node/bun/deno) to invoke the CLI.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import ContentAddressableStore from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

// Hard gate: refuse to run outside Docker
if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
    'Use: docker compose run --build --rm test-<runtime>',
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../bin/git-cas.js');

/**
 * Detect the runtime command to invoke the CLI.
 * - Bun  → bun run <script>
 * - Deno → deno run -A <script>
 * - Node → node <script>
 */
const RUNTIME_CMD = globalThis.Bun
  ? ['bun', 'run', BIN]
  : globalThis.Deno
    ? ['deno', 'run', '-A', BIN]
    : ['node', BIN];

/**
 * Run a CLI command and capture stdout/stderr without routing through /bin/sh.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ env?: Record<string, string | undefined> }} [options]
 */
function runCli(args, cwd, options = {}) {
  return spawnSync(RUNTIME_CMD[0], [...RUNTIME_CMD.slice(1), ...args, '--cwd', cwd], {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: 90_000,
  });
}

/**
 * Run a CLI command, returning trimmed stdout.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ env?: Record<string, string | undefined> }} [options]
 */
function cli(args, cwd, options = {}) {
  const result = runCli(args, cwd, options);

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    throw new Error(`CLI terminated by signal: ${result.signal}`);
  }

  if (result.status !== 0) {
    const stderr = `${result.stderr ?? ''}`.trim();
    const error = new Error(stderr || `CLI exited with status ${result.status}`);
    Object.assign(error, { result });
    throw error;
  }

  return `${result.stdout ?? ''}`.trim();
}

/**
 * Initialize a real bare Git repo without going through a shell.
 *
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
 * Helper: write a temp file with the given content, return path.
 */
function tempFile(content) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-'));
  const fp = path.join(dir, 'input.bin');
  writeFileSync(fp, content);
  return { filePath: fp, dir };
}

/**
 * Helper: create a throwaway bare repo for isolated validation tests.
 */
function tempRepo(prefix = 'cas-cli-repo-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  initBareRepo(dir);
  return dir;
}

// Shared state for the plaintext workflow describes
let repoDir;
const original = randomBytes(4096);
let inputFile;
let inputDir;
let storeOid;

beforeAll(() => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-integ-'));
  initBareRepo(repoDir);
  ({ filePath: inputFile, dir: inputDir } = tempFile(original));
});

afterAll(() => {
  if (repoDir) { rmSync(repoDir, { recursive: true, force: true }); }
  if (inputDir) { rmSync(inputDir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// vault init + store + query
// ---------------------------------------------------------------------------
describe('vault CLI — init, store, query', () => {
  it('vault init prints commit OID', () => {
    const out = cli(['vault', 'init'], repoDir);
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });

  it('store --tree --slug demo/hello prints tree OID', () => {
    storeOid = cli(['store', inputFile, '--tree', '--slug', 'demo/hello'], repoDir);
    expect(storeOid).toMatch(/^[0-9a-f]{40}$/);
  });

  it('vault list contains demo/hello', () => {
    const out = cli(['vault', 'list'], repoDir);
    expect(out).toContain('demo/hello');
    expect(out).toContain(storeOid);
  });

  it('vault info demo/hello shows slug and tree', () => {
    const out = cli(['vault', 'info', 'demo/hello'], repoDir);
    expect(out).toContain(`slug\tdemo/hello`);
    expect(out).toContain(`tree\t${storeOid}`);
  });

  it('vault history contains init and add commits', () => {
    const out = cli(['vault', 'history'], repoDir);
    expect(out).toContain('vault: init');
    expect(out).toContain('vault: add');
  });
});

describe('vault CLI — diagnostics', () => {
  it('vault stats --json summarizes the current vault', () => {
    const out = cli(['vault', 'stats', '--json'], repoDir);
    const report = JSON.parse(out);

    expect(report).toMatchObject({
      entries: 1,
      totalLogicalSize: original.length,
      totalChunkRefs: 1,
      uniqueChunks: 1,
      duplicateChunkRefs: 0,
      encryptedEntries: 0,
      envelopeEntries: 0,
      compressedEntries: 0,
      chunkingStrategies: { fixed: 1 },
      largestEntry: { slug: 'demo/hello', size: original.length },
    });
    expect(report.dedupRatio).toBe(1);
  });

  it('doctor --json reports a healthy vault', () => {
    const out = cli(['doctor', '--json'], repoDir);
    const report = JSON.parse(out);

    expect(report.status).toBe('ok');
    expect(report.hasVault).toBe(true);
    expect(report.entryCount).toBe(1);
    expect(report.validEntries).toBe(1);
    expect(report.invalidEntries).toBe(0);
    expect(report.issues).toEqual([]);
    expect(report.stats).toMatchObject({
      entries: 1,
      totalChunkRefs: 1,
      uniqueChunks: 1,
    });
  });
});

describe('vault CLI — validation', () => { // eslint-disable-line max-lines-per-function
  it('vault init rejects --algorithm without a passphrase source', () => {
    const validationRepoDir = tempRepo('cas-cli-init-validation-');

    try {
      const result = runCli(
        ['vault', 'init', '--algorithm', 'scrypt'],
        validationRepoDir,
        { env: { GIT_CAS_PASSPHRASE: undefined } },
      );

      expect(result.status).toBe(1);
      expect(`${result.stderr ?? ''}`).toContain(
        'Provide --vault-passphrase, --vault-passphrase-file, or --os-keychain-target when using --algorithm',
      );
    } finally {
      rmSync(validationRepoDir, { recursive: true, force: true });
    }
  });

  it('vault init rejects an explicitly empty inline passphrase plus a passphrase file', () => {
    const validationRepoDir = tempRepo('cas-cli-init-passphrase-conflict-');
    const passphraseFile = tempFile(Buffer.from('passphrase-from-file\n'));

    try {
      const result = runCli(
        [
          'vault',
          'init',
          '--vault-passphrase',
          '',
          '--vault-passphrase-file',
          passphraseFile.filePath,
        ],
        validationRepoDir,
      );

      expect(result.status).toBe(1);
      expect(`${result.stderr ?? ''}`).toContain(
        'Provide exactly one vault passphrase source: --vault-passphrase, --vault-passphrase-file, or --os-keychain-target',
      );
    } finally {
      rmSync(validationRepoDir, { recursive: true, force: true });
      rmSync(passphraseFile.dir, { recursive: true, force: true });
    }
  });

  it('store rejects key-file plus an explicitly empty vault passphrase', () => {
    const validationRepoDir = tempRepo('cas-cli-store-validation-');
    const input = tempFile(Buffer.from('store validation payload\n'));
    const keyFile = tempFile(randomBytes(32));

    try {
      cli(['vault', 'init'], validationRepoDir);

      const result = runCli(
        [
          'store',
          input.filePath,
          '--tree',
          '--slug',
          'validation/store-conflict',
          '--key-file',
          keyFile.filePath,
          '--vault-passphrase',
          '',
        ],
        validationRepoDir,
      );

      expect(result.status).toBe(1);
      expect(`${result.stderr ?? ''}`).toContain(
        'Provide --key-file or a vault passphrase source, not both',
      );
    } finally {
      rmSync(validationRepoDir, { recursive: true, force: true });
      rmSync(input.dir, { recursive: true, force: true });
      rmSync(keyFile.dir, { recursive: true, force: true });
    }
  });

  it('restore rejects key-file plus an explicitly empty vault passphrase', () => {
    const validationRepoDir = tempRepo('cas-cli-restore-validation-');
    const input = tempFile(Buffer.from('restore validation payload\n'));
    const keyFile = tempFile(randomBytes(32));
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-restore-validation-out-'));
    const outPath = path.join(outDir, 'restored.bin');

    try {
      cli(['vault', 'init'], validationRepoDir);
      cli(
        [
          'store',
          input.filePath,
          '--tree',
          '--slug',
          'validation/restore-conflict',
          '--key-file',
          keyFile.filePath,
        ],
        validationRepoDir,
      );

      const result = runCli(
        [
          'restore',
          '--slug',
          'validation/restore-conflict',
          '--out',
          outPath,
          '--key-file',
          keyFile.filePath,
          '--vault-passphrase',
          '',
        ],
        validationRepoDir,
      );

      expect(result.status).toBe(1);
      expect(`${result.stderr ?? ''}`).toContain(
        'Provide --key-file or a vault passphrase source, not both',
      );
    } finally {
      rmSync(validationRepoDir, { recursive: true, force: true });
      rmSync(input.dir, { recursive: true, force: true });
      rmSync(keyFile.dir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// vault restore + remove + re-add
// ---------------------------------------------------------------------------
describe('vault CLI — restore, remove, re-add', () => {
  it('restore --slug demo/hello matches original', () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-out-'));
    const outPath = path.join(outDir, 'restored.bin');
    cli(['restore', '--slug', 'demo/hello', '--out', outPath], repoDir);
    const restored = readFileSync(outPath);
    expect(restored.equals(original)).toBe(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('vault remove demo/hello prints removed tree OID', () => {
    const out = cli(['vault', 'remove', 'demo/hello'], repoDir);
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });

  it('vault list is empty after remove', () => {
    const out = cli(['vault', 'list'], repoDir);
    expect(out).toBe('');
  });

  it('store --tree --slug demo/hello works after remove (re-add)', () => {
    const oid = cli(['store', inputFile, '--tree', '--slug', 'demo/hello'], repoDir);
    expect(oid).toMatch(/^[0-9a-f]{40}$/);
  });
});

// ---------------------------------------------------------------------------
// Encrypted vault CLI workflow
// ---------------------------------------------------------------------------
describe('vault CLI — encrypted workflow', () => { // eslint-disable-line max-lines-per-function
  let encRepoDir;
  const encOriginal = randomBytes(2048);
  let encInputFile;
  let encInputDir;
  const passphrase = 'test-vault-passphrase';

  beforeAll(() => {
    encRepoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-enc-integ-'));
    initBareRepo(encRepoDir);
    ({ filePath: encInputFile, dir: encInputDir } = tempFile(encOriginal));
  });

  afterAll(() => {
    if (encRepoDir) { rmSync(encRepoDir, { recursive: true, force: true }); }
    if (encInputDir) { rmSync(encInputDir, { recursive: true, force: true }); }
  });

  it('vault init --vault-passphrase prints commit OID', () => {
    const out = cli(['vault', 'init', '--vault-passphrase', passphrase], encRepoDir);
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });

  it('encrypted store rejects a wrong passphrase before adding an empty-vault entry', () => {
    const result = runCli(
      [
        'store',
        encInputFile,
        '--tree',
        '--slug',
        'enc/wrong-passphrase',
        '--vault-passphrase',
        'wrong-passphrase',
      ],
      encRepoDir,
    );

    expect(result.status).toBe(1);
    expect(`${result.stderr ?? ''}`).toContain('Vault passphrase verification failed');
  });

  it('vault rotate rejects whitespace-only old passphrases', () => {
    const result = runCli(
      ['vault', 'rotate', '--old-passphrase', '   ', '--new-passphrase', 'next-passphrase'],
      encRepoDir,
    );

    expect(result.status).toBe(1);
    expect(`${result.stderr ?? ''}`).toContain(
      'Old passphrase required (--old-passphrase or --old-passphrase-file)',
    );
  });

  it('vault rotate rejects whitespace-only new passphrases', () => {
    const result = runCli(
      ['vault', 'rotate', '--old-passphrase', passphrase, '--new-passphrase', '   '],
      encRepoDir,
    );

    expect(result.status).toBe(1);
    expect(`${result.stderr ?? ''}`).toContain(
      'New passphrase required (--new-passphrase or --new-passphrase-file)',
    );
  });

  it('encrypted store --tree --vault-passphrase prints tree OID', () => {
    const out = cli(
      ['store', encInputFile, '--tree', '--slug', 'enc/asset', '--vault-passphrase', passphrase],
      encRepoDir,
    );
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });

  it('encrypted restore --slug --vault-passphrase matches original', () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-enc-out-'));
    const outPath = path.join(outDir, 'restored.bin');
    cli(
      ['restore', '--slug', 'enc/asset', '--out', outPath, '--vault-passphrase', passphrase],
      encRepoDir,
    );
    const restored = readFileSync(outPath);
    expect(restored.equals(encOriginal)).toBe(true);
    rmSync(outDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// rotate CLI — envelope encryption key rotation
// ---------------------------------------------------------------------------
describe('vault CLI — rotate', () => { // eslint-disable-line max-lines-per-function
  let rotateRepoDir;
  let rotateInputFile;
  let rotateInputDir;
  const rotateOriginal = randomBytes(2048);
  let oldKeyFile;
  let newKeyFile;
  let keyDir;

  beforeAll(() => {
    rotateRepoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-rotate-integ-'));
    initBareRepo(rotateRepoDir);
    ({ filePath: rotateInputFile, dir: rotateInputDir } = tempFile(rotateOriginal));

    keyDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-keys-'));
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    oldKeyFile = path.join(keyDir, 'old.key');
    newKeyFile = path.join(keyDir, 'new.key');
    writeFileSync(oldKeyFile, oldKey);
    writeFileSync(newKeyFile, newKey);
  });

  afterAll(() => {
    if (rotateRepoDir) { rmSync(rotateRepoDir, { recursive: true, force: true }); }
    if (rotateInputDir) { rmSync(rotateInputDir, { recursive: true, force: true }); }
    if (keyDir) { rmSync(keyDir, { recursive: true, force: true }); }
  });

  it('vault init + store with recipient', () => {
    cli(['vault', 'init'], rotateRepoDir);
    const oid = cli(
      ['store', rotateInputFile, '--tree', '--slug', 'rotate/asset', '--recipient', `alice:${oldKeyFile}`],
      rotateRepoDir,
    );
    expect(oid).toMatch(/^[0-9a-f]{40}$/);
  });

  it('store --recipient ignores ambient vault passphrase env state', () => {
    const oid = cli(
      ['store', rotateInputFile, '--tree', '--slug', 'rotate/env-asset', '--recipient', `bob:${oldKeyFile}`],
      rotateRepoDir,
      { env: { GIT_CAS_PASSPHRASE: 'ambient-secret' } },
    );

    expect(oid).toMatch(/^[0-9a-f]{40}$/);
  });

  it('rotate --slug rotates key and updates vault', () => {
    const oid = cli(
      ['rotate', '--slug', 'rotate/asset', '--old-key-file', oldKeyFile, '--new-key-file', newKeyFile],
      rotateRepoDir,
    );
    expect(oid).toMatch(/^[0-9a-f]{40}$/);
  });

  it('restore with new key succeeds after rotation', () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-rotate-out-'));
    const outPath = path.join(outDir, 'restored.bin');
    cli(
      ['restore', '--slug', 'rotate/asset', '--out', outPath, '--key-file', newKeyFile],
      rotateRepoDir,
    );
    const restored = readFileSync(outPath);
    expect(restored.equals(rotateOriginal)).toBe(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('restore with old key fails after rotation', () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-rotate-fail-'));
    const outPath = path.join(outDir, 'restored.bin');
    const result = runCli(
      ['restore', '--slug', 'rotate/asset', '--out', outPath, '--key-file', oldKeyFile],
      rotateRepoDir,
    );
    expect(result.status).toBe(1);
    expect(`${result.stderr ?? ''}`).toContain('NO_MATCHING_RECIPIENT');
    rmSync(outDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// CLI restore --oid with Merkle manifests
// ---------------------------------------------------------------------------
describe('vault CLI — restore --oid with Merkle manifest', () => {
  let merkleRepoDir;
  let merkleInputFile;
  let merkleInputDir;
  let merkleTreeOid;
  const merkleOriginal = Buffer.alloc(6 * 1024);

  beforeAll(async () => {
    for (let i = 0; i < merkleOriginal.length; i++) {
      merkleOriginal[i] = i % 251;
    }

    merkleRepoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-merkle-integ-'));
    initBareRepo(merkleRepoDir);
    ({ filePath: merkleInputFile, dir: merkleInputDir } = tempFile(merkleOriginal));

    const plumbing = await createGitPlumbing({ cwd: merkleRepoDir });
    const cas = new ContentAddressableStore({
      plumbing,
      chunkSize: 1024,
      merkleThreshold: 2, // Force v2 Merkle manifests for this fixture.
    });

    const manifest = await cas.storeFile({
      filePath: merkleInputFile,
      slug: 'merkle/asset',
    });
    merkleTreeOid = await cas.createTree({ manifest });
  });

  afterAll(() => {
    if (merkleRepoDir) { rmSync(merkleRepoDir, { recursive: true, force: true }); }
    if (merkleInputDir) { rmSync(merkleInputDir, { recursive: true, force: true }); }
  });

  it('restores full content via --oid for v2 manifests', () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-merkle-out-'));
    const outPath = path.join(outDir, 'restored.bin');
    const bytesWritten = cli(['restore', '--oid', merkleTreeOid, '--out', outPath], merkleRepoDir);

    expect(bytesWritten).toBe(String(merkleOriginal.length));

    const restored = readFileSync(outPath);
    expect(restored.equals(merkleOriginal)).toBe(true);
    rmSync(outDir, { recursive: true, force: true });
  });
});
