/**
 * Integration tests — vault CLI workflow via bin/git-cas.js.
 *
 * Exercises every vault subcommand through the CLI entrypoint, including
 * slash-encoded slugs and encrypted vault round trips.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 * Skipped under Bun — the CLI is a #!/usr/bin/env node tool; library-level
 * vault tests (vault.test.js) already validate Bun compatibility.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Hard gate: refuse to run outside Docker
if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
    'Use: npm run test:integration:node',
  );
}

// The CLI is a #!/usr/bin/env node tool. Bun's execSync hangs when spawning
// nested Bun subprocesses in Docker. Library-level vault tests (vault.test.js)
// already validate Bun compatibility.
const IS_BUN = !!globalThis.Bun;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../bin/git-cas.js');

/**
 * Run a CLI command, returning trimmed stdout.
 */
function cli(args, cwd) {
  return execSync(`node ${BIN} ${args} --cwd ${cwd}`, {
    encoding: 'utf8',
    timeout: 30_000,
  }).trim();
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

// Shared state for the plaintext workflow describes
let repoDir;
const original = randomBytes(4096);
let inputFile;
let inputDir;
let storeOid;

if (!IS_BUN) {
  beforeAll(() => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-integ-'));
    execSync('git init --bare', { cwd: repoDir, stdio: 'ignore' });
    ({ filePath: inputFile, dir: inputDir } = tempFile(original));
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(inputDir, { recursive: true, force: true });
  });
}

// ---------------------------------------------------------------------------
// vault init + store + query
// ---------------------------------------------------------------------------
describe.skipIf(IS_BUN)('vault CLI — init, store, query', () => {
  it('vault init prints commit OID', () => {
    const out = cli('vault init', repoDir);
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });

  it('store --tree --slug demo/hello prints tree OID', () => {
    storeOid = cli(`store ${inputFile} --tree --slug demo/hello`, repoDir);
    expect(storeOid).toMatch(/^[0-9a-f]{40}$/);
  });

  it('vault list contains demo/hello', () => {
    const out = cli('vault list', repoDir);
    expect(out).toContain('demo/hello');
    expect(out).toContain(storeOid);
  });

  it('vault info demo/hello shows slug and tree', () => {
    const out = cli('vault info demo/hello', repoDir);
    expect(out).toContain(`slug\tdemo/hello`);
    expect(out).toContain(`tree\t${storeOid}`);
  });

  it('vault history contains init and add commits', () => {
    const out = cli('vault history', repoDir);
    expect(out).toContain('vault: init');
    expect(out).toContain('vault: add');
  });
});

// ---------------------------------------------------------------------------
// vault restore + remove + re-add
// ---------------------------------------------------------------------------
describe.skipIf(IS_BUN)('vault CLI — restore, remove, re-add', () => {
  it('restore --slug demo/hello matches original', () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-out-'));
    const outPath = path.join(outDir, 'restored.bin');
    cli(`restore --slug demo/hello --out ${outPath}`, repoDir);
    const restored = readFileSync(outPath);
    expect(restored.equals(original)).toBe(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('vault remove demo/hello prints removed tree OID', () => {
    const out = cli('vault remove demo/hello', repoDir);
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });

  it('vault list is empty after remove', () => {
    const out = cli('vault list', repoDir);
    expect(out).toBe('');
  });

  it('store --tree --slug demo/hello works after remove (re-add)', () => {
    const oid = cli(`store ${inputFile} --tree --slug demo/hello`, repoDir);
    expect(oid).toMatch(/^[0-9a-f]{40}$/);
  });
});

// ---------------------------------------------------------------------------
// Encrypted vault CLI workflow
// ---------------------------------------------------------------------------
describe.skipIf(IS_BUN)('vault CLI — encrypted workflow', () => {
  let encRepoDir;
  const encOriginal = randomBytes(2048);
  let encInputFile;
  let encInputDir;
  const passphrase = 'test-vault-passphrase';

  beforeAll(() => {
    encRepoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-enc-integ-'));
    execSync('git init --bare', { cwd: encRepoDir, stdio: 'ignore' });
    ({ filePath: encInputFile, dir: encInputDir } = tempFile(encOriginal));
  });

  afterAll(() => {
    rmSync(encRepoDir, { recursive: true, force: true });
    rmSync(encInputDir, { recursive: true, force: true });
  });

  it('vault init --vault-passphrase prints commit OID', () => {
    const out = cli(`vault init --vault-passphrase ${passphrase}`, encRepoDir);
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });

  it('encrypted store --tree --vault-passphrase prints tree OID', () => {
    const out = cli(
      `store ${encInputFile} --tree --slug enc/asset --vault-passphrase ${passphrase}`,
      encRepoDir,
    );
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });

  it('encrypted restore --slug --vault-passphrase matches original', () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'cas-cli-enc-out-'));
    const outPath = path.join(outDir, 'restored.bin');
    cli(
      `restore --slug enc/asset --out ${outPath} --vault-passphrase ${passphrase}`,
      encRepoDir,
    );
    const restored = readFileSync(outPath);
    expect(restored.equals(encOriginal)).toBe(true);
    rmSync(outDir, { recursive: true, force: true });
  });
});
