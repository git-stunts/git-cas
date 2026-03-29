/**
 * Integration tests — agent CLI protocol workflow via bin/git-cas.js.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 * Uses the current runtime (node/bun/deno) to invoke the CLI.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
let encRepoDir;
let encInputDir;
let encTreeOid;
let recipientRepoDir;
let recipientInputDir;
let recipientTreeOid;
const original = randomBytes(4096);
const encryptedOriginal = randomBytes(3072);
const envelopeOriginal = randomBytes(2048);
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

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
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

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
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

    expect(stdoutRows.map((row) => row.type)).toEqual(['start', 'end']);
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

function defineEncryptedWriteFlowTests() {
  it('encrypted store works with an explicit vault passphrase', () => {
    const { result, inputDir: storeInputDir } = storeEncryptedAsset();

    expect(result.status).toBe(0);
    expect(`${result.stderr ?? ''}`).toBe('');

    const storeRows = parseJsonl(result.stdout);
    expect(storeRows[1].data).toMatchObject({
      slug: 'enc/new-store',
      addedToVault: true,
      encrypted: true,
    });

    rmSync(storeInputDir, { recursive: true, force: true });
  });

  it('encrypted restore works with an explicit vault passphrase', () => {
    const { inputDir: storeInputDir } = storeEncryptedAsset();
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'cas-agent-enc-restore-'));
    const outputPath = path.join(outputDir, 'restored.bin');
    const restoreResult = restoreEncryptedAsset(outputPath);

    expect(restoreResult.status).toBe(0);
    expect(`${restoreResult.stderr ?? ''}`).toBe('');

    const restoreRows = parseJsonl(restoreResult.stdout);
    expect(restoreRows[1].data).toMatchObject({
      slug: 'enc/new-store',
      outputPath,
      encrypted: true,
    });

    rmSync(outputDir, { recursive: true, force: true });
    rmSync(storeInputDir, { recursive: true, force: true });
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
        requiredInputs: ['keyFile', 'vaultPassphrase', 'vaultPassphraseFile'],
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
describe('agent CLI protocol — request and validation', defineRequestAndValidationTests);
describe('agent CLI protocol — store write flow', definePlainWriteFlowTests);
describe('agent CLI protocol — tree command (file path)', defineTreeCommandFilePathTest);
describe(
  'agent CLI protocol — tree command (request payload)',
  defineTreeCommandRequestPayloadTest
);
describe('agent CLI protocol — tree command (validation)', defineTreeCommandValidationTest);
describe('agent CLI protocol — restore write flow', defineRestoreWriteFlowTests);
describe('agent CLI protocol — encrypted write flows', defineEncryptedWriteFlowTests);
describe('agent CLI protocol — needs-input', defineNeedsInputTests);
