/**
 * Integration tests — agent CLI protocol workflow via bin/git-cas.js.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 * Uses the current runtime (node/bun/deno) to invoke the CLI.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

vi.setConfig({
  testTimeout: 30000,
  hookTimeout: 60000,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../bin/git-cas.js');
const RUNTIME_CMD = globalThis.Bun
  ? ['bun', 'run', BIN]
  : globalThis.Deno
    ? ['deno', 'run', '-A', BIN]
    : ['node', BIN];
// Deno uses WebCryptoAdapter, which intentionally supports PBKDF2 but not scrypt.
const REQUEST_PAYLOAD_KDF_ALGORITHM = RUNTIME_CMD[0] === 'deno' ? 'pbkdf2' : 'scrypt';

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
let encRepoDir;
let encInputDir;
let encTreeOid;
let recipientRepoDir;
let recipientInputDir;
let recipientTreeOid;
const original = randomBytes(4096);
const encryptedOriginal = randomBytes(3072);
const envelopeOriginal = randomBytes(2048);
const vaultRotateEnvelopeOriginal = randomBytes(1536);
const vaultRotateDirectOriginal = randomBytes(1024);
const vaultPassphrase = 'relay-agent-passphrase';

beforeAll(async () => {
  ({ repoDir, inputDir, treeOid } = await setupPlainRepo());
  ({
    repoDir: encRepoDir,
    inputDir: encInputDir,
    treeOid: encTreeOid,
  } = await setupEncryptedRepo());
  ({
    repoDir: recipientRepoDir,
    inputDir: recipientInputDir,
    treeOid: recipientTreeOid,
  } = await setupRecipientRepo());
  requestDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-request-'));
});

afterAll(() => {
  if (repoDir) {
    rmSync(repoDir, { recursive: true, force: true });
  }
  if (encRepoDir) {
    rmSync(encRepoDir, { recursive: true, force: true });
  }
  if (recipientRepoDir) {
    rmSync(recipientRepoDir, { recursive: true, force: true });
  }
  if (inputDir) {
    rmSync(inputDir, { recursive: true, force: true });
  }
  if (encInputDir) {
    rmSync(encInputDir, { recursive: true, force: true });
  }
  if (recipientInputDir) {
    rmSync(recipientInputDir, { recursive: true, force: true });
  }
  if (requestDir) {
    rmSync(requestDir, { recursive: true, force: true });
  }
});

async function setupPlainRepo() {
  const plainRepoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-integ-'));
  initBareRepo(plainRepoDir);

  const cas = createCas(plainRepoDir);
  await cas.initVault();

  const input = tempFile(original);
  const manifest = await cas.storeFile({
    filePath: input.filePath,
    slug: 'demo/hello',
  });
  const plainTreeOid = await cas.createTree({ manifest });
  await cas.addToVault({ slug: 'demo/hello', treeOid: plainTreeOid });

  return { repoDir: plainRepoDir, inputDir: input.dir, treeOid: plainTreeOid };
}

async function setupEncryptedRepo() {
  const encryptedRepoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-enc-integ-'));
  initBareRepo(encryptedRepoDir);

  const cas = createCas(encryptedRepoDir);
  await cas.initVault({ passphrase: vaultPassphrase });

  const input = tempFile(encryptedOriginal);
  const manifest = await cas.storeFile({
    filePath: input.filePath,
    slug: 'enc/hello',
    encryptionKey: await deriveVaultKey(cas, vaultPassphrase),
  });
  const encryptedTreeOid = await cas.createTree({ manifest });
  await cas.addToVault({ slug: 'enc/hello', treeOid: encryptedTreeOid });

  return {
    repoDir: encryptedRepoDir,
    inputDir: input.dir,
    treeOid: encryptedTreeOid,
  };
}

async function setupRecipientRepo() {
  const envelopeRepoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-recipient-integ-'));
  initBareRepo(envelopeRepoDir);

  const cas = createCas(envelopeRepoDir);
  await cas.initVault();

  const input = tempFile(envelopeOriginal);
  const manifest = await cas.storeFile({
    filePath: input.filePath,
    slug: 'env/hello',
    recipients: [
      { label: 'alice', key: randomBytes(32) },
      { label: 'bob', key: randomBytes(32) },
    ],
  });
  const envelopeTreeOid = await cas.createTree({ manifest });
  await cas.addToVault({ slug: 'env/hello', treeOid: envelopeTreeOid });

  return {
    repoDir: envelopeRepoDir,
    inputDir: input.dir,
    treeOid: envelopeTreeOid,
  };
}

async function createEnvelopeVaultEntry(
  repoPath,
  { slug, recipients, content = envelopeOriginal }
) {
  const cas = createCas(repoPath);
  const input = tempFile(content);
  const manifest = await cas.storeFile({
    filePath: input.filePath,
    slug,
    recipients,
  });
  const createdTreeOid = await cas.createTree({ manifest });
  await cas.addToVault({ slug, treeOid: createdTreeOid });

  return { treeOid: createdTreeOid, inputDir: input.dir };
}

async function deriveVaultKey(cas, passphrase) {
  const metadata = await cas.getVaultMetadata();
  if (!metadata?.encryption?.kdf) {
    throw new Error('Encrypted vault metadata missing KDF configuration');
  }
  const { key } = await cas.deriveKey({
    passphrase,
    salt: Buffer.from(metadata.encryption.kdf.salt, 'base64'),
    algorithm: metadata.encryption.kdf.algorithm,
    iterations: metadata.encryption.kdf.iterations,
    cost: metadata.encryption.kdf.cost,
    blockSize: metadata.encryption.kdf.blockSize,
    parallelization: metadata.encryption.kdf.parallelization,
    keyLength: metadata.encryption.kdf.keyLength,
  });
  return key;
}

async function setupVaultRotateRepo() {
  const rotateRepoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-vault-rotate-'));
  initBareRepo(rotateRepoDir);

  const oldPassphrase = 'relay-old-passphrase';
  const newPassphrase = 'relay-new-passphrase';
  const cas = createCas(rotateRepoDir);
  await cas.initVault({ passphrase: oldPassphrase });

  const oldKek = await deriveVaultKey(cas, oldPassphrase);
  const oldKeyFile = tempFile(oldKek);

  const envelopeInput = tempFile(vaultRotateEnvelopeOriginal);
  const envelopeManifest = await cas.storeFile({
    filePath: envelopeInput.filePath,
    slug: 'vault/env',
    recipients: [{ label: 'vault', key: oldKek }],
  });
  const envelopeTreeOid = await cas.createTree({ manifest: envelopeManifest });
  await cas.addToVault({ slug: 'vault/env', treeOid: envelopeTreeOid });

  const directInput = tempFile(vaultRotateDirectOriginal);
  const directManifest = await cas.storeFile({
    filePath: directInput.filePath,
    slug: 'vault/direct',
    encryptionKey: oldKek,
  });
  const directTreeOid = await cas.createTree({ manifest: directManifest });
  await cas.addToVault({ slug: 'vault/direct', treeOid: directTreeOid });

  return {
    repoDir: rotateRepoDir,
    oldPassphrase,
    newPassphrase,
    oldKeyFile,
    envelopeInput,
    directInput,
  };
}

function createEmptyAgentRepo() {
  const vaultRepoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-empty-vault-'));
  initBareRepo(vaultRepoDir);
  return vaultRepoDir;
}

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
    assertStartRow(rows, {
      cwd: '.',
      slug: 'demo/hello',
    });
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

function defineRecipientListSlugTest() {
  it('recipient list returns structured recipient rows for an envelope asset', () => {
    const result = runAgentCli(['recipient', 'list', '--slug', 'env/hello'], recipientRepoDir);
    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows.map((row) => row.type)).toEqual(['start', 'result', 'end']);
    expect(rows[1].data).toEqual({
      slug: 'env/hello',
      treeOid: recipientTreeOid,
      envelope: true,
      recipientCount: 2,
      recipients: [{ label: 'alice' }, { label: 'bob' }],
    });
  });
}

function defineRecipientListRequestPayloadTest() {
  it('recipient list accepts request payloads that target an asset by oid', () => {
    const requestPath = path.join(requestDir, 'recipient-list.json');
    writeFileSync(requestPath, JSON.stringify({ oid: recipientTreeOid }));

    const result = runAgentCli(
      ['recipient', 'list', '--request', `@${requestPath}`],
      recipientRepoDir
    );
    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows[1].data).toEqual({
      slug: 'env/hello',
      treeOid: recipientTreeOid,
      envelope: true,
      recipientCount: 2,
      recipients: [{ label: 'alice' }, { label: 'bob' }],
    });
  });
}

function defineRecipientListPlaintextTest() {
  it('recipient list returns a non-envelope result for plaintext assets', () => {
    const result = runAgentCli(['recipient', 'list', '--slug', 'demo/hello'], repoDir);
    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows[1].data).toEqual({
      slug: 'demo/hello',
      treeOid,
      envelope: false,
      recipientCount: 0,
      recipients: [],
    });
  });
}

function defineRecipientListValidationTest() {
  it('recipient list emits structured invalid-input errors when no target is provided', () => {
    const result = runAgentCli(['recipient', 'list'], recipientRepoDir);
    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'recipient.list',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide --slug <slug> or --oid <tree-oid>',
      },
    });
  });
}

async function prepareRecipientAddRequestFixture() {
  const alice = randomBytes(32);
  const bob = randomBytes(32);
  const carol = randomBytes(32);
  const slug = 'env/add-target';
  const { treeOid: previousTreeOid, inputDir: fixtureInputDir } = await createEnvelopeVaultEntry(
    recipientRepoDir,
    {
      slug,
      recipients: [
        { label: 'alice', key: alice },
        { label: 'bob', key: bob },
      ],
    }
  );
  const existingKeyFile = tempFile(alice);
  const newKeyFile = tempFile(carol);
  const requestPath = path.join(requestDir, 'recipient-add.json');
  writeFileSync(
    requestPath,
    JSON.stringify({
      slug,
      label: 'carol',
      existingKeyFile: existingKeyFile.filePath,
      keyFile: newKeyFile.filePath,
    })
  );

  return {
    slug,
    previousTreeOid,
    fixtureInputDir,
    existingKeyFile,
    newKeyFile,
    requestPath,
  };
}

function defineRecipientAddRequestPayloadTest() {
  it('recipient add supports request payloads and reports vault side effects', async () => {
    const { slug, previousTreeOid, fixtureInputDir, existingKeyFile, newKeyFile, requestPath } =
      await prepareRecipientAddRequestFixture();

    const result = runAgentCli(
      ['recipient', 'add', '--request', `@${requestPath}`],
      recipientRepoDir
    );
    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows.map((row) => row.type)).toEqual(['start', 'result', 'end']);
    expect(rows[1].data).toMatchObject({
      action: 'add',
      slug,
      label: 'carol',
      previousTreeOid,
      recipientCount: 3,
      recipients: [{ label: 'alice' }, { label: 'bob' }, { label: 'carol' }],
    });
    expect(rows[1].data.treeOid).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[1].data.treeOid).not.toBe(previousTreeOid);
    expect(rows[1].data.commitOid).toMatch(/^[0-9a-f]{40}$/);

    rmSync(fixtureInputDir, { recursive: true, force: true });
    rmSync(existingKeyFile.dir, { recursive: true, force: true });
    rmSync(newKeyFile.dir, { recursive: true, force: true });
  });
}

function defineRecipientRemoveSuccessTest() {
  it('recipient remove reports the new tree, commit, and remaining recipients', async () => {
    const alice = randomBytes(32);
    const bob = randomBytes(32);
    const slug = 'env/remove-target';
    const { treeOid: previousTreeOid, inputDir: fixtureInputDir } = await createEnvelopeVaultEntry(
      recipientRepoDir,
      {
        slug,
        recipients: [
          { label: 'alice', key: alice },
          { label: 'bob', key: bob },
        ],
      }
    );

    const result = runAgentCli(
      ['recipient', 'remove', '--slug', slug, '--label', 'bob'],
      recipientRepoDir
    );
    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows[1].data).toMatchObject({
      action: 'remove',
      slug,
      label: 'bob',
      previousTreeOid,
      recipientCount: 1,
      recipients: [{ label: 'alice' }],
    });
    expect(rows[1].data.treeOid).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[1].data.treeOid).not.toBe(previousTreeOid);
    expect(rows[1].data.commitOid).toMatch(/^[0-9a-f]{40}$/);

    rmSync(fixtureInputDir, { recursive: true, force: true });
  });
}

function defineRecipientAddDuplicateLabelTest() {
  it('recipient add surfaces duplicate-label failures as structured protocol errors', async () => {
    const alice = randomBytes(32);
    const slug = 'env/add-duplicate';
    const { inputDir: fixtureInputDir } = await createEnvelopeVaultEntry(recipientRepoDir, {
      slug,
      recipients: [{ label: 'alice', key: alice }],
    });
    const existingKeyFile = tempFile(alice);
    const newKeyFile = tempFile(randomBytes(32));

    const result = runAgentCli(
      [
        'recipient',
        'add',
        '--slug',
        slug,
        '--label',
        'alice',
        '--existing-key-file',
        existingKeyFile.filePath,
        '--key-file',
        newKeyFile.filePath,
      ],
      recipientRepoDir
    );
    expect(result.status).toBe(1);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'recipient.add',
      type: 'error',
      data: {
        code: 'RECIPIENT_ALREADY_EXISTS',
        message: 'Recipient "alice" already exists',
      },
    });

    rmSync(fixtureInputDir, { recursive: true, force: true });
    rmSync(existingKeyFile.dir, { recursive: true, force: true });
    rmSync(newKeyFile.dir, { recursive: true, force: true });
  });
}

function defineRecipientRemoveLastRecipientTest() {
  it('recipient remove surfaces last-recipient protection as a structured protocol error', async () => {
    const alice = randomBytes(32);
    const slug = 'env/remove-last';
    const { inputDir: fixtureInputDir } = await createEnvelopeVaultEntry(recipientRepoDir, {
      slug,
      recipients: [{ label: 'alice', key: alice }],
    });

    const result = runAgentCli(
      ['recipient', 'remove', '--slug', slug, '--label', 'alice'],
      recipientRepoDir
    );
    expect(result.status).toBe(1);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'recipient.remove',
      type: 'error',
      data: {
        code: 'CANNOT_REMOVE_LAST_RECIPIENT',
        message: 'Cannot remove the last recipient',
      },
    });

    rmSync(fixtureInputDir, { recursive: true, force: true });
  });
}

async function prepareRotateSlugFixture() {
  const alice = randomBytes(32);
  const bob = randomBytes(32);
  const aliceNew = randomBytes(32);
  const slug = 'env/rotate-target';
  const { treeOid: previousTreeOid, inputDir: fixtureInputDir } = await createEnvelopeVaultEntry(
    recipientRepoDir,
    {
      slug,
      recipients: [
        { label: 'alice', key: alice },
        { label: 'bob', key: bob },
      ],
    }
  );
  const oldKeyFile = tempFile(alice);
  const newKeyFile = tempFile(aliceNew);

  return {
    slug,
    previousTreeOid,
    fixtureInputDir,
    oldKeyFile,
    newKeyFile,
  };
}

async function prepareRotateRequestFixture() {
  const alice = randomBytes(32);
  const aliceNew = randomBytes(32);
  const slug = 'env/rotate-detached';
  const { treeOid: previousTreeOid, inputDir: fixtureInputDir } = await createEnvelopeVaultEntry(
    recipientRepoDir,
    {
      slug,
      recipients: [{ label: 'alice', key: alice }],
    }
  );
  const oldKeyFile = tempFile(alice);
  const newKeyFile = tempFile(aliceNew);
  const requestPath = path.join(requestDir, 'rotate-request.json');
  writeFileSync(
    requestPath,
    JSON.stringify({
      oid: previousTreeOid,
      oldKeyFile: oldKeyFile.filePath,
      newKeyFile: newKeyFile.filePath,
    })
  );

  return {
    slug,
    previousTreeOid,
    fixtureInputDir,
    oldKeyFile,
    newKeyFile,
    requestPath,
  };
}

function assertRotateResult(data, expected) {
  expect(data).toMatchObject(expected);
  expect(data.treeOid).toMatch(/^[0-9a-f]{40}$/);
  expect(data.treeOid).not.toBe(expected.previousTreeOid);
}

function assertRestoreResult(result, outputPath, expectedBuffer) {
  expect(result.status).toBe(0);
  expect(readFileSync(outputPath).equals(expectedBuffer)).toBe(true);
}

function cleanupTempDirs(...dirs) {
  dirs.forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
}

function assertStartRow(rows, expectedInput) {
  expect(rows[0]).toMatchObject({
    type: 'start',
    data: {
      input: expectedInput,
    },
  });
  expect(rows[0].data).not.toHaveProperty('argv');
}

function assertExactStartRow(rows, expectedInput) {
  assertStartRow(rows, expectedInput);
  expect(rows[0].data.input).toEqual(expectedInput);
}

function assertRotateOldKeyFailure(result) {
  expect(result.status).toBe(1);

  const oldKeyErrors = parseJsonl(result.stderr);
  expect(oldKeyErrors[0]).toMatchObject({
    command: 'restore',
    type: 'error',
    data: {
      code: 'NO_MATCHING_RECIPIENT',
    },
  });
}

function assertVaultRotateResult(data, expected) {
  expect(data).toMatchObject(expected);
  expect(data.commitOid).toMatch(/^[0-9a-f]{40}$/);
}

function assertVaultInitResult(data, expected) {
  expect(data).toMatchObject(expected);
  expect(data.commitOid).toMatch(/^[0-9a-f]{40}$/);
}

function assertVaultRemoveResult(data, expected) {
  expect(data).toMatchObject(expected);
  expect(data.commitOid).toMatch(/^[0-9a-f]{40}$/);
}

function assertSlugRotateRestore(slug, newKeyFilePath, oldKeyFilePath) {
  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-rotate-restore-'));
  const outputPath = path.join(outputDir, 'restored.bin');
  const restoreNew = runAgentCli(
    ['restore', '--slug', slug, '--out', outputPath, '--key-file', newKeyFilePath],
    recipientRepoDir
  );
  assertRestoreResult(restoreNew, outputPath, envelopeOriginal);

  const failedOutputPath = path.join(outputDir, 'restored-old.bin');
  const restoreOld = runAgentCli(
    ['restore', '--slug', slug, '--out', failedOutputPath, '--key-file', oldKeyFilePath],
    recipientRepoDir
  );
  assertRotateOldKeyFailure(restoreOld);
  cleanupTempDirs(outputDir);
}

async function assertVaultRotateRestore(repoPath, newPassphrase, oldKeyFilePath) {
  const newKeyFile = tempFile(await deriveVaultKey(createCas(repoPath), newPassphrase));
  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-vault-rotate-restore-'));
  const outputPath = path.join(outputDir, 'restored.bin');
  const restoreNew = runAgentCli(
    ['restore', '--slug', 'vault/env', '--out', outputPath, '--key-file', newKeyFile.filePath],
    repoPath
  );
  assertRestoreResult(restoreNew, outputPath, vaultRotateEnvelopeOriginal);

  const failedOutputPath = path.join(outputDir, 'restored-old.bin');
  const restoreOld = runAgentCli(
    ['restore', '--slug', 'vault/env', '--out', failedOutputPath, '--key-file', oldKeyFilePath],
    repoPath
  );
  assertRotateOldKeyFailure(restoreOld);
  cleanupTempDirs(outputDir, newKeyFile.dir);
}

function defineRotateSlugSuccessTest() {
  it('rotate updates a slug-targeted vault entry and reports explicit side effects', async () => {
    const { slug, previousTreeOid, fixtureInputDir, oldKeyFile, newKeyFile } =
      await prepareRotateSlugFixture();
    const rotateResult = runAgentCli(
      [
        'rotate',
        '--slug',
        slug,
        '--label',
        'alice',
        '--old-key-file',
        oldKeyFile.filePath,
        '--new-key-file',
        newKeyFile.filePath,
      ],
      recipientRepoDir
    );

    expect(rotateResult.status).toBe(0);
    expect(`${rotateResult.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(rotateResult.stdout);
    expect(rows.map((row) => row.type)).toEqual(['start', 'result', 'end']);
    assertRotateResult(rows[1].data, {
      action: 'rotate',
      slug,
      label: 'alice',
      previousTreeOid,
      updatedVault: true,
      keyVersion: 1,
      recipientCount: 2,
      recipients: [{ label: 'alice', keyVersion: 1 }, { label: 'bob' }],
    });
    expect(rows[1].data.commitOid).toMatch(/^[0-9a-f]{40}$/);

    assertSlugRotateRestore(slug, newKeyFile.filePath, oldKeyFile.filePath);
    cleanupTempDirs(fixtureInputDir, oldKeyFile.dir, newKeyFile.dir);
  });
}

function defineRotateRequestPayloadTest() {
  it('rotate accepts request payloads for detached-tree rotation without updating the vault', async () => {
    const { slug, previousTreeOid, fixtureInputDir, oldKeyFile, newKeyFile, requestPath } =
      await prepareRotateRequestFixture();
    const result = runAgentCli(['rotate', '--request', `@${requestPath}`], recipientRepoDir);

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    assertRotateResult(rows[1].data, {
      action: 'rotate',
      slug,
      previousTreeOid,
      updatedVault: false,
      keyVersion: 1,
      recipientCount: 1,
      recipients: [{ label: 'alice', keyVersion: 1 }],
    });
    expect(rows[1].data).not.toHaveProperty('commitOid');

    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-rotate-detached-'));
    const outputPath = path.join(outputDir, 'restored.bin');
    const restoreResult = runAgentCli(
      [
        'restore',
        '--oid',
        rows[1].data.treeOid,
        '--out',
        outputPath,
        '--key-file',
        newKeyFile.filePath,
      ],
      recipientRepoDir
    );
    assertRestoreResult(restoreResult, outputPath, envelopeOriginal);

    const infoResult = runAgentCli(['vault', 'info', slug], recipientRepoDir);
    expect(infoResult.status).toBe(0);

    const infoRows = parseJsonl(infoResult.stdout);
    expect(infoRows[1].data).toEqual({ slug, treeOid: previousTreeOid });

    cleanupTempDirs(outputDir, fixtureInputDir, oldKeyFile.dir, newKeyFile.dir);
  });
}

function defineRotateValidationTest() {
  it('rotate emits structured invalid-input errors when no target is provided', () => {
    const oldKeyFile = tempFile(randomBytes(32));
    const newKeyFile = tempFile(randomBytes(32));
    const result = runAgentCli(
      ['rotate', '--old-key-file', oldKeyFile.filePath, '--new-key-file', newKeyFile.filePath],
      recipientRepoDir
    );
    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'rotate',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide --slug <slug> or --oid <tree-oid>',
      },
    });

    cleanupTempDirs(oldKeyFile.dir, newKeyFile.dir);
  });
}

function defineRotateWrongOldKeyTest() {
  it('rotate surfaces wrong-key failures as structured protocol errors', async () => {
    const alice = randomBytes(32);
    const slug = 'env/rotate-wrong-key';
    const { inputDir: fixtureInputDir } = await createEnvelopeVaultEntry(recipientRepoDir, {
      slug,
      recipients: [{ label: 'alice', key: alice }],
    });
    const oldKeyFile = tempFile(randomBytes(32));
    const newKeyFile = tempFile(randomBytes(32));

    const result = runAgentCli(
      [
        'rotate',
        '--slug',
        slug,
        '--label',
        'alice',
        '--old-key-file',
        oldKeyFile.filePath,
        '--new-key-file',
        newKeyFile.filePath,
      ],
      recipientRepoDir
    );
    expect(result.status).toBe(1);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'rotate',
      type: 'error',
      data: {
        code: 'DEK_UNWRAP_FAILED',
        message: 'Failed to unwrap DEK: authentication failed',
      },
    });

    cleanupTempDirs(fixtureInputDir, oldKeyFile.dir, newKeyFile.dir);
  });
}

function defineVaultRotateSuccessTest() {
  it('vault rotate reports commit, rotated entries, and resulting KDF state', async () => {
    const fixture = await setupVaultRotateRepo();
    const result = runAgentCli(
      [
        'vault',
        'rotate',
        '--old-passphrase',
        fixture.oldPassphrase,
        '--new-passphrase',
        fixture.newPassphrase,
      ],
      fixture.repoDir
    );

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows.map((row) => row.type)).toEqual(['start', 'result', 'end']);
    assertVaultRotateResult(rows[1].data, {
      updatedVault: true,
      rotatedSlugs: ['vault/env'],
      skippedSlugs: ['vault/direct'],
      rotatedCount: 1,
      skippedCount: 1,
      entryCount: 2,
      kdfAlgorithm: 'pbkdf2',
    });

    await assertVaultRotateRestore(
      fixture.repoDir,
      fixture.newPassphrase,
      fixture.oldKeyFile.filePath
    );
    cleanupTempDirs(
      fixture.repoDir,
      fixture.oldKeyFile.dir,
      fixture.envelopeInput.dir,
      fixture.directInput.dir
    );
  });
}

function defineVaultRotateRequestPayloadTest() {
  it('vault rotate accepts request payload file sources and algorithm override', async () => {
    const fixture = await setupVaultRotateRepo();
    const oldPassphraseFile = tempFile(Buffer.from(fixture.oldPassphrase));
    const newPassphraseFile = tempFile(Buffer.from(fixture.newPassphrase));
    const requestPath = path.join(requestDir, 'vault-rotate-request.json');
    writeFileSync(
      requestPath,
      JSON.stringify({
        oldPassphraseFile: oldPassphraseFile.filePath,
        newPassphraseFile: newPassphraseFile.filePath,
        algorithm: REQUEST_PAYLOAD_KDF_ALGORITHM,
      })
    );

    const result = runAgentCli(
      ['vault', 'rotate', '--request', `@${requestPath}`],
      fixture.repoDir
    );

    expect(result.status).toBe(0);

    const rows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);
    assertVaultRotateResult(rows[1].data, {
      updatedVault: true,
      rotatedCount: 1,
      skippedCount: 1,
      kdfAlgorithm: REQUEST_PAYLOAD_KDF_ALGORITHM,
    });
    expect(stderrRows).toHaveLength(2);
    expect(stderrRows.every((row) => row.type === 'warning')).toBe(true);
    expect(stderrRows.every((row) => row.data.code === 'INSECURE_FILE_PERMISSIONS')).toBe(true);

    const metadata = await createCas(fixture.repoDir).getVaultMetadata();
    expect(metadata?.encryption?.kdf?.algorithm).toBe(REQUEST_PAYLOAD_KDF_ALGORITHM);

    cleanupTempDirs(
      fixture.repoDir,
      fixture.oldKeyFile.dir,
      fixture.envelopeInput.dir,
      fixture.directInput.dir,
      oldPassphraseFile.dir,
      newPassphraseFile.dir
    );
  });
}

function defineVaultRotateValidationTest() {
  it('vault rotate emits structured invalid-input errors when the old passphrase is missing', () => {
    const result = runAgentCli(['vault', 'rotate', '--new-passphrase', 'next'], encRepoDir);
    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'vault.rotate',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide --old-passphrase <pass>, --old-passphrase-file <path>, or --old-os-keychain-target <target>',
      },
    });
  });
}

function defineVaultRotateWrongPassphraseTest() {
  it('vault rotate surfaces wrong-passphrase failures as structured protocol errors', async () => {
    const fixture = await setupVaultRotateRepo();
    const result = runAgentCli(
      [
        'vault',
        'rotate',
        '--old-passphrase',
        'wrong-passphrase',
        '--new-passphrase',
        fixture.newPassphrase,
      ],
      fixture.repoDir
    );
    expect(result.status).toBe(1);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'vault.rotate',
      type: 'error',
      data: {
        code: 'NO_MATCHING_RECIPIENT',
        message: 'No recipient entry could be unwrapped with the provided key',
      },
    });

    cleanupTempDirs(
      fixture.repoDir,
      fixture.oldKeyFile.dir,
      fixture.envelopeInput.dir,
      fixture.directInput.dir
    );
  });
}

function defineVaultInitPlaintextTest() {
  it('vault init initializes a plaintext vault and reports commit side effects', async () => {
    const vaultRepoDir = createEmptyAgentRepo();
    const result = runAgentCli(['vault', 'init'], vaultRepoDir);

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows.map((row) => row.type)).toEqual(['start', 'result', 'end']);
    assertVaultInitResult(rows[1].data, {
      initializedVault: true,
      encrypted: false,
    });

    const metadata = await createCas(vaultRepoDir).getVaultMetadata();
    expect(metadata?.encryption).toBeUndefined();

    cleanupTempDirs(vaultRepoDir);
  });
}

function defineVaultInitEncryptedRequestPayloadTest() {
  it('vault init accepts encrypted request payload input and reports the resulting KDF algorithm', async () => {
    const vaultRepoDir = createEmptyAgentRepo();
    const passphraseFile = tempFile(Buffer.from('relay-init-passphrase'));
    const requestPath = path.join(requestDir, 'vault-init-request.json');
    writeFileSync(
      requestPath,
      JSON.stringify({
        passphraseFile: passphraseFile.filePath,
        algorithm: REQUEST_PAYLOAD_KDF_ALGORITHM,
      })
    );

    const result = runAgentCli(['vault', 'init', '--request', `@${requestPath}`], vaultRepoDir);

    expect(result.status).toBe(0);

    const rows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);
    assertVaultInitResult(rows[1].data, {
      initializedVault: true,
      encrypted: true,
      kdfAlgorithm: REQUEST_PAYLOAD_KDF_ALGORITHM,
    });
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'vault.init',
      type: 'warning',
      data: {
        code: 'INSECURE_FILE_PERMISSIONS',
      },
    });

    const metadata = await createCas(vaultRepoDir).getVaultMetadata();
    expect(metadata?.encryption?.kdf?.algorithm).toBe(REQUEST_PAYLOAD_KDF_ALGORITHM);

    cleanupTempDirs(vaultRepoDir, passphraseFile.dir);
  });
}

function defineVaultInitValidationTest() {
  it('vault init rejects algorithm selection without an encryption source', () => {
    const vaultRepoDir = createEmptyAgentRepo();
    const result = runAgentCli(['vault', 'init', '--algorithm', 'scrypt'], vaultRepoDir);
    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'vault.init',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide --passphrase <pass>, --passphrase-file <path>, or --os-keychain-target <target> when using --algorithm',
      },
    });

    cleanupTempDirs(vaultRepoDir);
  });
}

function defineVaultRemoveSuccessTest() {
  it('vault remove reports the removed tree and vault commit explicitly', async () => {
    const fixture = await setupPlainRepo();
    const result = runAgentCli(['vault', 'remove', '--slug', 'demo/hello'], fixture.repoDir);

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows.map((row) => row.type)).toEqual(['start', 'result', 'end']);
    assertVaultRemoveResult(rows[1].data, {
      slug: 'demo/hello',
      removedTreeOid: fixture.treeOid,
      updatedVault: true,
    });

    const entries = await createCas(fixture.repoDir).listVault();
    expect(entries).toEqual([]);

    cleanupTempDirs(fixture.repoDir, fixture.inputDir);
  });
}

function defineVaultRemoveMissingEntryTest() {
  it('vault remove surfaces missing-entry failures as structured protocol errors', async () => {
    const fixture = await setupPlainRepo();
    const result = runAgentCli(['vault', 'remove', '--slug', 'missing'], fixture.repoDir);
    expect(result.status).toBe(1);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'vault.remove',
      type: 'error',
      data: {
        code: 'VAULT_ENTRY_NOT_FOUND',
        message: 'Vault entry "missing" not found',
      },
    });

    cleanupTempDirs(fixture.repoDir, fixture.inputDir);
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
    assertStartRow(rows, {
      slug: 'demo/hello',
    });
    expect(rows[1].data).toMatchObject({
      treeOid,
      manifest: { slug: 'demo/hello' },
    });
    expect(result.stdout).not.toContain(requestPath);
  });

  it('inspect emits structured invalid-input errors without human help text', () => {
    const result = runAgentCli(['inspect'], repoDir);
    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
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

function definePlainWriteFlowTests() {
  it('store reports explicit side effects when creating a vault entry', () => {
    const input = tempFile(Buffer.from('relay plain store\n'));
    const result = runAgentCli(
      ['store', input.filePath, '--slug', 'demo/new-store', '--tree'],
      repoDir
    );

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows.map((row) => row.type)).toEqual(['start', 'result', 'end']);
    assertStartRow(rows, {
      file: input.filePath,
      slug: 'demo/new-store',
      tree: true,
    });
    expect(rows[1].data).toMatchObject({
      slug: 'demo/new-store',
      addedToVault: true,
      chunkCount: 1,
      encrypted: false,
      compressed: false,
    });
    expect(rows[1].data.treeOid).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[1].data.commitOid).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[1].data.manifest.slug).toBe('demo/new-store');

    rmSync(input.dir, { recursive: true, force: true });
  });
}

function defineTreeCommandFilePathTest() {
  it('tree creates a tree from a manifest file without human formatting', async () => {
    const manifestDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-manifest-'));
    const manifestPath = path.join(manifestDir, 'manifest.json');
    const manifest = await createCas(repoDir).readManifest({ treeOid });
    writeFileSync(manifestPath, JSON.stringify(manifest.toJSON()));

    const result = runAgentCli(['tree', '--manifest', manifestPath], repoDir);

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows.map((row) => row.type)).toEqual(['start', 'result', 'end']);
    assertStartRow(rows, {
      manifest: {
        provided: true,
        source: 'file',
      },
    });
    expect(rows[1].data).toEqual({
      treeOid,
      slug: 'demo/hello',
      chunkCount: 1,
      encrypted: false,
      compressed: false,
    });

    rmSync(manifestDir, { recursive: true, force: true });
  });
}

function defineTreeCommandRequestPayloadTest() {
  it('tree accepts an inline manifest object through the request payload', async () => {
    const manifest = await createCas(repoDir).readManifest({ treeOid });
    const requestPath = path.join(requestDir, 'tree-request.json');
    writeFileSync(requestPath, JSON.stringify({ manifest: manifest.toJSON() }));

    const result = runAgentCli(['tree', '--request', `@${requestPath}`], repoDir);

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    assertStartRow(rows, {
      manifest: {
        provided: true,
        source: 'inline',
      },
    });
    expect(rows[1].data).toEqual({
      treeOid,
      slug: 'demo/hello',
      chunkCount: 1,
      encrypted: false,
      compressed: false,
    });
  });
}

function defineTreeCommandValidationTest() {
  it('tree emits structured invalid-input errors when no manifest source is provided', () => {
    const result = runAgentCli(['tree'], repoDir);
    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'tree',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide --manifest <path> or request.manifest',
      },
    });
  });
}

function defineRestoreWriteFlowTests() {
  it('restore reports output path and bytes written without leaking file bytes', () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-restore-'));
    const outputPath = path.join(outputDir, 'restored.bin');
    const result = runAgentCli(['restore', '--slug', 'demo/hello', '--out', outputPath], repoDir);

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    expect(rows[1].data).toMatchObject({
      slug: 'demo/hello',
      treeOid,
      outputPath,
      bytesWritten: original.length,
      encrypted: false,
    });
    expect(rows[1].data.outputPath).not.toContain('hello world');

    rmSync(outputDir, { recursive: true, force: true });
  });
}

function storeEncryptedAsset() {
  const input = tempFile(Buffer.from('relay encrypted store\n'));
  const result = runAgentCli(
    [
      'store',
      input.filePath,
      '--slug',
      'enc/new-store',
      '--tree',
      '--vault-passphrase',
      vaultPassphrase,
    ],
    encRepoDir
  );

  return { result, inputDir: input.dir };
}

function restoreEncryptedAsset(outputPath) {
  return runAgentCli(
    [
      'restore',
      '--slug',
      'enc/new-store',
      '--out',
      outputPath,
      '--vault-passphrase',
      vaultPassphrase,
    ],
    encRepoDir
  );
}

function defineEncryptedStoreWithPassphraseTest() {
  it('encrypted store works with an explicit vault passphrase', () => {
    const { result, inputDir: storeInputDir } = storeEncryptedAsset();

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const storeRows = parseJsonl(result.stdout);
    assertStartRow(storeRows, {
      file: path.join(storeInputDir, 'input.bin'),
      slug: 'enc/new-store',
      tree: true,
      vaultPassphrase: true,
    });
    expect(storeRows[1].data).toMatchObject({
      slug: 'enc/new-store',
      addedToVault: true,
      encrypted: true,
    });
    expect(result.stdout).not.toContain(vaultPassphrase);

    rmSync(storeInputDir, { recursive: true, force: true });
  });
}

function defineEncryptedRestoreWithPassphraseTest() {
  it('encrypted restore works with an explicit vault passphrase', () => {
    const { inputDir: storeInputDir } = storeEncryptedAsset();
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-enc-restore-'));
    const outputPath = path.join(outputDir, 'restored.bin');
    const restoreResult = restoreEncryptedAsset(outputPath);

    expect(restoreResult.status).toBe(0);
    expect(`${restoreResult.stderr ?? ''}`).toBe('');

    const restoreRows = parseJsonl(restoreResult.stdout);
    assertStartRow(restoreRows, {
      out: outputPath,
      slug: 'enc/new-store',
      vaultPassphrase: true,
    });
    expect(restoreRows[1].data).toMatchObject({
      slug: 'enc/new-store',
      outputPath,
      encrypted: true,
    });

    rmSync(outputDir, { recursive: true, force: true });
    rmSync(storeInputDir, { recursive: true, force: true });
  });
}

function defineEncryptedStoreConflictingPassphraseSourcesTest() {
  it('encrypted store rejects conflicting vault passphrase sources', () => {
    const storeInput = tempFile(Buffer.from('conflicting passphrase sources\n'));
    const passphraseFile = tempFile(Buffer.from(`${vaultPassphrase}\n`));
    const result = runAgentCli(
      [
        'store',
        storeInput.filePath,
        '--slug',
        'enc/conflict',
        '--vault-passphrase',
        'wrong-passphrase',
        '--vault-passphrase-file',
        passphraseFile.filePath,
      ],
      encRepoDir
    );

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows[0]).toMatchObject({
      command: 'store',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide exactly one vault passphrase source: --vault-passphrase, --vault-passphrase-file, or --os-keychain-target',
      },
    });

    cleanupTempDirs(storeInput.dir, passphraseFile.dir);
  });
}

function defineStoreEmptyVaultPassphraseKeyConflictTest() {
  it('store rejects key-file plus an explicitly empty vault passphrase', () => {
    const storeInput = tempFile(Buffer.from('empty vault passphrase conflict\n'));
    const keyFile = tempFile(randomBytes(32));
    const result = runAgentCli(
      [
        'store',
        storeInput.filePath,
        '--slug',
        'demo/empty-passphrase-conflict',
        '--key-file',
        keyFile.filePath,
        '--vault-passphrase',
        '',
      ],
      repoDir
    );

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows[0]).toMatchObject({
      command: 'store',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide --key-file or a vault passphrase source, not both',
      },
    });

    cleanupTempDirs(storeInput.dir, keyFile.dir);
  });
}

function defineStoreRequestBooleanTypeValidationTest() {
  it('store rejects string boolean fields in request payloads', () => {
    const storeInput = tempFile(Buffer.from('request boolean validation\n'));
    const result = runAgentCli(
      [
        'store',
        '--request',
        JSON.stringify({
          file: storeInput.filePath,
          slug: 'demo/request-boolean-validation',
          tree: 'false',
          force: 'false',
        }),
      ],
      repoDir
    );

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows[0]).toMatchObject({
      command: 'store',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Request field "tree" must be a boolean',
      },
    });

    cleanupTempDirs(storeInput.dir);
  });
}

function defineStoreRequestFileTypeValidationTest() {
  it('store rejects non-string file fields in request payloads', () => {
    const result = runAgentCli(
      [
        'store',
        '--request',
        JSON.stringify({
          file: 123,
          slug: 'demo/request-file-validation',
        }),
      ],
      repoDir
    );

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows[0]).toMatchObject({
      command: 'store',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Request field "file" must be a string',
      },
    });
  });
}

function defineVaultInitInlinePassphraseRedactionTest() {
  it('vault init redacts inline passphrases in the start row', () => {
    const vaultRepoDir = createEmptyAgentRepo();
    const result = runAgentCli(
      ['vault', 'init', '--cwd', vaultRepoDir, '--passphrase', 'supersecret'],
      vaultRepoDir
    );

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    assertStartRow(rows, {
      cwd: vaultRepoDir,
      passphrase: true,
    });
    expect(result.stdout).not.toContain('supersecret');

    cleanupTempDirs(vaultRepoDir);
  });
}

function defineVaultInitInlineRequestWhitelistTest() {
  it('vault init omits unknown request fields from the start row', () => {
    const vaultRepoDir = createEmptyAgentRepo();
    const result = runAgentCli(
      [
        'vault',
        'init',
        '--cwd',
        vaultRepoDir,
        '--request',
        '{"passphrase":"supersecret","token":"supersecret-token"}',
      ],
      vaultRepoDir
    );

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    assertExactStartRow(rows, {
      cwd: vaultRepoDir,
      passphrase: true,
      requestSource: 'inline',
    });
    expect(result.stdout).not.toContain('supersecret');
    expect(result.stdout).not.toContain('supersecret-token');

    cleanupTempDirs(vaultRepoDir);
  });
}

function defineVaultInitPermissionWarningTest() {
  it('vault init emits structured warnings for insecure passphrase files', () => {
    const vaultRepoDir = createEmptyAgentRepo();
    const passphraseFile = tempFile(Buffer.from('relay-warning-passphrase\n'));
    chmodSync(passphraseFile.filePath, 0o644);

    const result = runAgentCli(
      ['vault', 'init', '--cwd', vaultRepoDir, '--passphrase-file', passphraseFile.filePath],
      vaultRepoDir
    );

    expect(result.status).toBe(0);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    assertStartRow(stdoutRows, {
      cwd: vaultRepoDir,
      passphraseFile: true,
    });
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'vault.init',
      type: 'warning',
      data: {
        code: 'INSECURE_FILE_PERMISSIONS',
        filePath: path.resolve(passphraseFile.filePath),
        recommendation: 'chmod 600',
      },
    });

    cleanupTempDirs(vaultRepoDir, passphraseFile.dir);
  });
}

function defineVaultInitEmptyInlineAndFileConflictTest() {
  it('vault init rejects an explicitly empty inline passphrase plus a passphrase file', () => {
    const vaultRepoDir = createEmptyAgentRepo();
    const passphraseFile = tempFile(Buffer.from('relay-init-passphrase\n'));
    const result = runAgentCli(
      [
        'vault',
        'init',
        '--cwd',
        vaultRepoDir,
        '--passphrase',
        '',
        '--passphrase-file',
        passphraseFile.filePath,
      ],
      vaultRepoDir
    );

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows[0]).toMatchObject({
      command: 'vault.init',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide exactly one passphrase source: --passphrase, --passphrase-file, or --os-keychain-target',
      },
    });

    cleanupTempDirs(vaultRepoDir, passphraseFile.dir);
  });
}

function defineVaultInitEmptyStdinPassphraseTest() {
  it('vault init classifies empty stdin passphrase sources as invalid input', () => {
    const vaultRepoDir = createEmptyAgentRepo();
    const result = runAgentCli(
      ['vault', 'init', '--cwd', vaultRepoDir, '--passphrase-file', '-'],
      vaultRepoDir,
      { input: '' }
    );

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
    assertStartRow(stdoutRows, {
      cwd: vaultRepoDir,
      passphraseFile: true,
    });
    expect(stderrRows[0]).toMatchObject({
      command: 'vault.init',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Passphrase must not be empty',
      },
    });

    cleanupTempDirs(vaultRepoDir);
  });
}

function defineVaultInitMissingPassphraseFileTest() {
  it('vault init classifies a missing passphrase file as invalid input', () => {
    const vaultRepoDir = createEmptyAgentRepo();
    const missingPath = path.join(vaultRepoDir, 'missing-passphrase.txt');
    const result = runAgentCli(
      ['vault', 'init', '--cwd', vaultRepoDir, '--passphrase-file', missingPath],
      vaultRepoDir
    );

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
    expect(stderrRows[0]).toMatchObject({
      command: 'vault.init',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
      },
    });
    expect(stderrRows[0].data.message).toContain('passphrase file');
    expect(stderrRows[0].data.message).toContain('missing-passphrase.txt');

    cleanupTempDirs(vaultRepoDir);
  });
}

function defineVaultInitInlineRequestRedactionTest() {
  it('vault init redacts inline request payload secrets in the start row', () => {
    const vaultRepoDir = createEmptyAgentRepo();
    const result = runAgentCli(
      ['vault', 'init', '--cwd', vaultRepoDir, '--request', '{"passphrase":"supersecret"}'],
      vaultRepoDir
    );

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const rows = parseJsonl(result.stdout);
    assertStartRow(rows, {
      cwd: vaultRepoDir,
      passphrase: true,
      requestSource: 'inline',
    });
    expect(result.stdout).not.toContain('supersecret');

    cleanupTempDirs(vaultRepoDir);
  });
}

function defineVaultRotateEmptyInlineAndFileConflictTest() {
  it('vault rotate rejects an explicitly empty old passphrase plus a file source', async () => {
    const fixture = await setupVaultRotateRepo();
    const oldPassphraseFile = tempFile(Buffer.from(`${fixture.oldPassphrase}\n`));
    const result = runAgentCli(
      [
        'vault',
        'rotate',
        '--old-passphrase',
        '',
        '--old-passphrase-file',
        oldPassphraseFile.filePath,
        '--new-passphrase',
        fixture.newPassphrase,
      ],
      fixture.repoDir
    );

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows[0]).toMatchObject({
      command: 'vault.rotate',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
        message: 'Provide exactly one old passphrase source: --old-passphrase, --old-passphrase-file, or --old-os-keychain-target',
      },
    });

    cleanupTempDirs(
      fixture.repoDir,
      fixture.oldKeyFile.dir,
      fixture.envelopeInput.dir,
      fixture.directInput.dir,
      oldPassphraseFile.dir
    );
  });
}

function defineRestoreMissingKeyFileTest() {
  it('restore classifies a missing key file as invalid input', () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-missing-key-'));
    const outputPath = path.join(outputDir, 'restored.bin');
    const missingKeyPath = path.join(outputDir, 'missing.key');
    const result = runAgentCli(
      ['restore', '--slug', 'demo/hello', '--out', outputPath, '--key-file', missingKeyPath],
      repoDir
    );

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
    expect(stderrRows[0]).toMatchObject({
      command: 'restore',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
      },
    });
    expect(stderrRows[0].data.message).toContain('key file');
    expect(stderrRows[0].data.message).toContain('missing.key');

    cleanupTempDirs(outputDir);
  });
}

function defineTreeMissingManifestFileTest() {
  it('tree classifies a missing manifest file as invalid input', () => {
    const missingManifestPath = path.join(repoDir, 'missing-manifest.json');
    const result = runAgentCli(['tree', '--manifest', missingManifestPath], repoDir);

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['end']);
    expect(stderrRows[0]).toMatchObject({
      command: 'tree',
      type: 'error',
      data: {
        code: 'INVALID_INPUT',
      },
    });
    expect(stderrRows[0].data.message).toContain('manifest file');
    expect(stderrRows[0].data.message).toContain('missing-manifest.json');
  });
}

function defineNeedsInputTests() {
  it('encrypted restore emits needs-input when no key source is provided', () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-needs-input-'));
    const outputPath = path.join(outputDir, 'restored.bin');
    const result = runAgentCli(['restore', '--slug', 'enc/hello', '--out', outputPath], encRepoDir);

    expect(result.status).toBe(2);

    const stdoutRows = parseJsonl(result.stdout);
    const stderrRows = parseJsonl(result.stderr);

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
    expect(stderrRows).toHaveLength(1);
    expect(stderrRows[0]).toMatchObject({
      command: 'restore',
      type: 'needs-input',
      data: {
        code: 'NEEDS_INPUT',
        message: 'Encrypted restore requires --key-file or a vault passphrase source',
        requiredInputs: ['keyFile', 'vaultPassphrase', 'vaultPassphraseFile', 'osKeychainTarget'],
        slug: 'enc/hello',
        treeOid: encTreeOid,
      },
    });

    rmSync(outputDir, { recursive: true, force: true });
  });
}

describe('agent CLI protocol — read commands', defineReadOnlyProtocolTests);
describe('agent CLI protocol — vault commands', defineVaultProtocolTests);
describe('agent CLI protocol — recipient list (slug)', defineRecipientListSlugTest);
describe(
  'agent CLI protocol — recipient list (request payload)',
  defineRecipientListRequestPayloadTest
);
describe('agent CLI protocol — recipient list (plaintext)', defineRecipientListPlaintextTest);
describe('agent CLI protocol — recipient list (validation)', defineRecipientListValidationTest);
describe(
  'agent CLI protocol — recipient add (request payload)',
  defineRecipientAddRequestPayloadTest
);
describe('agent CLI protocol — recipient remove (success)', defineRecipientRemoveSuccessTest);
describe(
  'agent CLI protocol — recipient add (duplicate label)',
  defineRecipientAddDuplicateLabelTest
);
describe(
  'agent CLI protocol — recipient remove (last recipient)',
  defineRecipientRemoveLastRecipientTest
);
describe('agent CLI protocol — rotate (slug)', defineRotateSlugSuccessTest);
describe('agent CLI protocol — rotate (request payload)', defineRotateRequestPayloadTest);
describe('agent CLI protocol — rotate (validation)', defineRotateValidationTest);
describe('agent CLI protocol — rotate (wrong old key)', defineRotateWrongOldKeyTest);
describe('agent CLI protocol — vault rotate (success)', defineVaultRotateSuccessTest);
describe(
  'agent CLI protocol — vault rotate (request payload)',
  defineVaultRotateRequestPayloadTest
);
describe('agent CLI protocol — vault rotate (validation)', defineVaultRotateValidationTest);
describe(
  'agent CLI protocol — vault rotate (wrong passphrase)',
  defineVaultRotateWrongPassphraseTest
);
describe('agent CLI protocol — vault init (plaintext)', defineVaultInitPlaintextTest);
describe(
  'agent CLI protocol — vault init (encrypted request payload)',
  defineVaultInitEncryptedRequestPayloadTest
);
describe('agent CLI protocol — vault init (validation)', defineVaultInitValidationTest);
describe(
  'agent CLI protocol — vault init (inline passphrase redaction)',
  defineVaultInitInlinePassphraseRedactionTest
);
describe(
  'agent CLI protocol — vault init (inline request whitelist)',
  defineVaultInitInlineRequestWhitelistTest
);
describe(
  'agent CLI protocol — vault init (permission warning)',
  defineVaultInitPermissionWarningTest
);
describe(
  'agent CLI protocol — vault init (empty inline and file conflict)',
  defineVaultInitEmptyInlineAndFileConflictTest
);
describe(
  'agent CLI protocol — vault init (empty stdin passphrase)',
  defineVaultInitEmptyStdinPassphraseTest
);
describe(
  'agent CLI protocol — vault init (missing passphrase file)',
  defineVaultInitMissingPassphraseFileTest
);
describe(
  'agent CLI protocol — vault init (inline request redaction)',
  defineVaultInitInlineRequestRedactionTest
);
describe('agent CLI protocol — vault remove (success)', defineVaultRemoveSuccessTest);
describe('agent CLI protocol — vault remove (missing entry)', defineVaultRemoveMissingEntryTest);
describe('agent CLI protocol — request and validation', defineRequestAndValidationTests);
describe('agent CLI protocol — store write flow', definePlainWriteFlowTests);
describe('agent CLI protocol — tree command (file path)', defineTreeCommandFilePathTest);
describe(
  'agent CLI protocol — tree command (request payload)',
  defineTreeCommandRequestPayloadTest
);
describe('agent CLI protocol — tree command (validation)', defineTreeCommandValidationTest);
describe('agent CLI protocol — restore write flow', defineRestoreWriteFlowTests);
describe(
  'agent CLI protocol — encrypted store (vault passphrase)',
  defineEncryptedStoreWithPassphraseTest
);
describe(
  'agent CLI protocol — encrypted restore (vault passphrase)',
  defineEncryptedRestoreWithPassphraseTest
);
describe(
  'agent CLI protocol — encrypted store (conflicting vault passphrase sources)',
  defineEncryptedStoreConflictingPassphraseSourcesTest
);
describe(
  'agent CLI protocol — store (empty vault passphrase plus key conflict)',
  defineStoreEmptyVaultPassphraseKeyConflictTest
);
describe(
  'agent CLI protocol — store (request boolean type validation)',
  defineStoreRequestBooleanTypeValidationTest
);
describe(
  'agent CLI protocol — store (request file type validation)',
  defineStoreRequestFileTypeValidationTest
);
describe(
  'agent CLI protocol — vault rotate (empty inline and file conflict)',
  defineVaultRotateEmptyInlineAndFileConflictTest
);
describe(
  'agent CLI protocol — restore (missing key file)',
  defineRestoreMissingKeyFileTest
);
describe(
  'agent CLI protocol — tree command (missing manifest file)',
  defineTreeMissingManifestFileTest
);
describe('agent CLI protocol — needs-input', defineNeedsInputTests);
