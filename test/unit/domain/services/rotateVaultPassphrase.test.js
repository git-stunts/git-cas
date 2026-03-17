import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import CasService from '../../../../src/domain/services/CasService.js';
import VaultService from '../../../../src/domain/services/VaultService.js';
import GitPersistenceAdapter from '../../../../src/infrastructure/adapters/GitPersistenceAdapter.js';
import GitRefAdapter from '../../../../src/infrastructure/adapters/GitRefAdapter.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import { createGitPlumbing } from '../../../../src/infrastructure/createGitPlumbing.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';
import rotateVaultPassphrase from '../../../../src/domain/services/rotateVaultPassphrase.js';
import CasError from '../../../../src/domain/errors/CasError.js';

const LONG_TEST_TIMEOUT_MS = 60000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cas-rotator-'));
  execSync('git init --bare', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

async function createDeps(repoDir) {
  const plumbing = createGitPlumbing({ cwd: repoDir });
  const crypto = await getTestCryptoAdapter();
  const persistence = new GitPersistenceAdapter({ plumbing });
  const ref = new GitRefAdapter({ plumbing });
  const service = new CasService({
    persistence, codec: new JsonCodec(), crypto, observability: new SilentObserver(), chunkSize: 1024,
  });
  const vault = new VaultService({ persistence, ref, crypto, observability: new SilentObserver() });
  return { service, vault };
}

async function* bufferSource(buf) {
  yield buf;
}

async function storeEnvelope({ service, vault, slug, data, passphrase }) {
  const metadata = (await vault.readState()).metadata;
  const { key } = await service.deriveKey({
    passphrase,
    salt: Buffer.from(metadata.encryption.kdf.salt, 'base64'),
    algorithm: metadata.encryption.kdf.algorithm,
    iterations: metadata.encryption.kdf.iterations,
  });
  const manifest = await service.store({
    source: bufferSource(data), slug, filename: `${slug}.bin`,
    recipients: [{ label: 'vault', key }],
  });
  const treeOid = await service.createTree({ manifest });
  await vault.addToVault({ slug, treeOid, force: true });
  return treeOid;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('rotateVaultPassphrase – 3 envelope entries', () => {
  let repoDir;
  let service;
  let vault;

  beforeEach(async () => {
    repoDir = createRepo();
    ({ service, vault } = await createDeps(repoDir));
  });
  afterEach(() => { if (repoDir) { rmSync(repoDir, { recursive: true, force: true }); } });

  it('rotates all entries and returns correct slugs', async () => {
    const oldPass = 'old-pass';
    const newPass = 'new-pass';
    await vault.initVault({ passphrase: oldPass, kdfOptions: { iterations: 1 } });

    const originals = {};
    for (const name of ['alpha', 'beta', 'gamma']) {
      const data = randomBytes(256);
      originals[name] = data;
      await storeEnvelope({ service, vault, slug: name, data, passphrase: oldPass });
    }

    const { commitOid, rotatedSlugs, skippedSlugs } = await rotateVaultPassphrase(
      { service, vault },
      { oldPassphrase: oldPass, newPassphrase: newPass },
    );

    expect(commitOid).toMatch(/^[0-9a-f]{40}$/);
    expect(rotatedSlugs.sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(skippedSlugs).toEqual([]);

    // Verify all restorable with new passphrase
    const state = await vault.readState();
    const { key: newKey } = await service.deriveKey({
      passphrase: newPass,
      salt: Buffer.from(state.metadata.encryption.kdf.salt, 'base64'),
      algorithm: state.metadata.encryption.kdf.algorithm,
      iterations: state.metadata.encryption.kdf.iterations,
    });

    for (const name of ['alpha', 'beta', 'gamma']) {
      const treeOid = await vault.resolveVaultEntry({ slug: name });
      const manifest = await service.readManifest({ treeOid });
      const { buffer } = await service.restore({ manifest, encryptionKey: newKey });
      expect(buffer.equals(originals[name])).toBe(true);
    }
  }, LONG_TEST_TIMEOUT_MS);
});

describe('rotateVaultPassphrase – mixed entries', () => {
  let repoDir;
  let service;
  let vault;

  beforeEach(async () => {
    repoDir = createRepo();
    ({ service, vault } = await createDeps(repoDir));
  });
  afterEach(() => { if (repoDir) { rmSync(repoDir, { recursive: true, force: true }); } });

  it('2 envelope + 1 non-envelope → 2 rotated, 1 skipped', async () => {
    const oldPass = 'old-pass';
    const newPass = 'new-pass';
    await vault.initVault({ passphrase: oldPass, kdfOptions: { iterations: 1 } });

    await storeEnvelope({ service, vault, slug: 'env1', data: randomBytes(128), passphrase: oldPass });
    await storeEnvelope({ service, vault, slug: 'env2', data: randomBytes(128), passphrase: oldPass });

    // 1 non-envelope (direct key)
    const state = await vault.readState();
    const { key: directKey } = await service.deriveKey({
      passphrase: oldPass,
      salt: Buffer.from(state.metadata.encryption.kdf.salt, 'base64'),
      algorithm: state.metadata.encryption.kdf.algorithm,
      iterations: state.metadata.encryption.kdf.iterations,
    });
    const plainManifest = await service.store({
      source: bufferSource(randomBytes(128)), slug: 'direct', filename: 'direct.bin',
      encryptionKey: directKey,
    });
    const plainTree = await service.createTree({ manifest: plainManifest });
    await vault.addToVault({ slug: 'direct', treeOid: plainTree });

    const { rotatedSlugs, skippedSlugs } = await rotateVaultPassphrase(
      { service, vault },
      { oldPassphrase: oldPass, newPassphrase: newPass },
    );

    expect(rotatedSlugs.sort()).toEqual(['env1', 'env2']);
    expect(skippedSlugs).toEqual(['direct']);
  }, LONG_TEST_TIMEOUT_MS);
});

describe('rotateVaultPassphrase – error cases', () => {
  let repoDir;
  let service;
  let vault;

  beforeEach(async () => {
    repoDir = createRepo();
    ({ service, vault } = await createDeps(repoDir));
  });
  afterEach(() => { if (repoDir) { rmSync(repoDir, { recursive: true, force: true }); } });

  it('wrong old passphrase → error', async () => {
    const oldPass = 'old-pass';
    await vault.initVault({ passphrase: oldPass, kdfOptions: { iterations: 1 } });
    await storeEnvelope({ service, vault, slug: 'asset', data: randomBytes(128), passphrase: oldPass });

    await expect(
      rotateVaultPassphrase({ service, vault }, { oldPassphrase: 'wrong', newPassphrase: 'new' }),
    ).rejects.toThrow();
  }, LONG_TEST_TIMEOUT_MS);

  it('vault not encrypted → VAULT_METADATA_INVALID', async () => {
    await vault.initVault();
    const manifest = await service.store({
      source: bufferSource(randomBytes(64)), slug: 'plain', filename: 'plain.bin',
    });
    const tree = await service.createTree({ manifest });
    await vault.addToVault({ slug: 'plain', treeOid: tree });

    await expect(
      rotateVaultPassphrase({ service, vault }, { oldPassphrase: 'any', newPassphrase: 'new' }),
    ).rejects.toMatchObject({ code: 'VAULT_METADATA_INVALID' });
  }, LONG_TEST_TIMEOUT_MS);
});

describe('rotateVaultPassphrase – KDF options', () => {
  let repoDir;
  let service;
  let vault;

  beforeEach(async () => {
    repoDir = createRepo();
    ({ service, vault } = await createDeps(repoDir));
  });
  afterEach(() => { if (repoDir) { rmSync(repoDir, { recursive: true, force: true }); } });

  it('kdfOptions.algorithm overrides existing algorithm', async () => {
    const oldPass = 'old-pass';
    const newPass = 'new-pass';
    await vault.initVault({ passphrase: oldPass, kdfOptions: { iterations: 1 } });
    await storeEnvelope({ service, vault, slug: 'asset', data: randomBytes(128), passphrase: oldPass });

    const oldState = await vault.readState();
    expect(oldState.metadata.encryption.kdf.algorithm).toBe('pbkdf2');

    await rotateVaultPassphrase(
      { service, vault },
      { oldPassphrase: oldPass, newPassphrase: newPass, kdfOptions: { algorithm: 'scrypt' } },
    );

    const newState = await vault.readState();
    expect(newState.metadata.encryption.kdf.algorithm).toBe('scrypt');
  }, LONG_TEST_TIMEOUT_MS);

  it('metadata updated with new KDF salt', async () => {
    const oldPass = 'old-pass';
    const newPass = 'new-pass';
    await vault.initVault({ passphrase: oldPass, kdfOptions: { iterations: 1 } });
    await storeEnvelope({ service, vault, slug: 'asset', data: randomBytes(128), passphrase: oldPass });

    const oldState = await vault.readState();
    const oldSalt = oldState.metadata.encryption.kdf.salt;

    await rotateVaultPassphrase(
      { service, vault },
      { oldPassphrase: oldPass, newPassphrase: newPass },
    );

    const newState = await vault.readState();
    expect(newState.metadata.encryption.kdf.salt).not.toBe(oldSalt);
    expect(newState.metadata.encryption.kdf.algorithm).toBe(oldState.metadata.encryption.kdf.algorithm);
  }, LONG_TEST_TIMEOUT_MS);
});

describe('rotateVaultPassphrase – retry success', () => {
  let repoDir;
  let service;
  let vault;

  beforeEach(async () => {
    repoDir = createRepo();
    ({ service, vault } = await createDeps(repoDir));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (repoDir) { rmSync(repoDir, { recursive: true, force: true }); }
  });

  it('retries on VAULT_CONFLICT and succeeds within maxRetries', async () => {
    const oldPass = 'old-pass';
    const newPass = 'new-pass';
    await vault.initVault({ passphrase: oldPass, kdfOptions: { iterations: 1 } });
    await storeEnvelope({ service, vault, slug: 'a', data: randomBytes(128), passphrase: oldPass });

    let calls = 0;
    const original = vault.writeCommit.bind(vault);
    vi.spyOn(vault, 'writeCommit').mockImplementation(async (opts) => {
      calls++;
      if (calls === 1) { throw new CasError('conflict', 'VAULT_CONFLICT'); }
      return original(opts);
    });

    const result = await rotateVaultPassphrase(
      { service, vault },
      { oldPassphrase: oldPass, newPassphrase: newPass, maxRetries: 2, retryBaseMs: 1 },
    );
    expect(result.commitOid).toMatch(/^[0-9a-f]{40}$/);
    expect(calls).toBe(2);
  }, LONG_TEST_TIMEOUT_MS);
});

describe('rotateVaultPassphrase – maxRetries exhausted', () => {
  let repoDir;
  let service;
  let vault;

  beforeEach(async () => {
    repoDir = createRepo();
    ({ service, vault } = await createDeps(repoDir));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (repoDir) { rmSync(repoDir, { recursive: true, force: true }); }
  });

  it('fails after exactly maxRetries attempts', async () => {
    const oldPass = 'old-pass';
    await vault.initVault({ passphrase: oldPass, kdfOptions: { iterations: 1 } });
    await storeEnvelope({ service, vault, slug: 'a', data: randomBytes(128), passphrase: oldPass });

    let calls = 0;
    vi.spyOn(vault, 'writeCommit').mockImplementation(async () => {
      calls++;
      throw new CasError('conflict', 'VAULT_CONFLICT');
    });

    await expect(
      rotateVaultPassphrase(
        { service, vault },
        { oldPassphrase: oldPass, newPassphrase: 'new', maxRetries: 1, retryBaseMs: 1 },
      ),
    ).rejects.toMatchObject({ code: 'VAULT_CONFLICT' });
    expect(calls).toBe(1);
  }, LONG_TEST_TIMEOUT_MS);
});

describe('rotateVaultPassphrase – default retry count', () => {
  let repoDir;
  let service;
  let vault;

  beforeEach(async () => {
    repoDir = createRepo();
    ({ service, vault } = await createDeps(repoDir));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (repoDir) { rmSync(repoDir, { recursive: true, force: true }); }
  });

  it('maxRetries defaults to 3 when not specified', async () => {
    const oldPass = 'old-pass';
    await vault.initVault({ passphrase: oldPass, kdfOptions: { iterations: 1 } });
    await storeEnvelope({ service, vault, slug: 'a', data: randomBytes(128), passphrase: oldPass });

    let calls = 0;
    vi.spyOn(vault, 'writeCommit').mockImplementation(async () => {
      calls++;
      throw new CasError('conflict', 'VAULT_CONFLICT');
    });

    await expect(
      rotateVaultPassphrase(
        { service, vault },
        { oldPassphrase: oldPass, newPassphrase: 'new', retryBaseMs: 1 },
      ),
    ).rejects.toMatchObject({ code: 'VAULT_CONFLICT' });
    expect(calls).toBe(3);
  }, LONG_TEST_TIMEOUT_MS);
});
