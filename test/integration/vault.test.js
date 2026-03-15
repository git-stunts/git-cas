/**
 * Integration tests — vault operations against a real Git bare repo.
 *
 * Exercises the full vault stack:
 * GitPlumbing → GitPersistenceAdapter + GitRefAdapter → VaultService → Facade.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '../../index.js';
import VaultService from '../../src/domain/services/VaultService.js';
import CasError from '../../src/domain/errors/CasError.js';

// Hard gate: refuse to run outside Docker
if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
    'Use: npm run test:integration:node',
  );
}

let repoDir;
let cas;

function initBareRepo(cwd) {
  const result = spawnSync('git', ['init', '--bare'], { cwd, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? result.stdout ?? 'git init --bare failed'}`.trim());
  }
}

beforeAll(() => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-vault-integ-'));
  initBareRepo(repoDir);

  const plumbing = GitPlumbing.createDefault({ cwd: repoDir });
  cas = new ContentAddressableStore({ plumbing });
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

/**
 * Helper: write a temp file with the given content, return path.
 */
function tempFile(content) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cas-file-'));
  const fp = path.join(dir, 'input.bin');
  writeFileSync(fp, content);
  return { filePath: fp, dir };
}

// ---------------------------------------------------------------------------
// Vault init
// ---------------------------------------------------------------------------
describe('vault init', () => {
  it('initializes vault without encryption', async () => {
    const result = await cas.initVault();
    expect(result.commitOid).toBeTruthy();
    expect(typeof result.commitOid).toBe('string');
    expect(result.commitOid.length).toBeGreaterThan(5);
  });

  it('metadata has version 1', async () => {
    const metadata = await cas.getVaultMetadata();
    expect(metadata).toEqual({ version: 1 });
  });

  it('VAULT_REF matches VaultService', () => {
    expect(ContentAddressableStore.VAULT_REF).toBe(VaultService.VAULT_REF);
    expect(ContentAddressableStore.VAULT_REF).toBe('refs/cas/vault');
  });
});

// ---------------------------------------------------------------------------
// Vault store + add + resolve round trip
// ---------------------------------------------------------------------------
describe('vault store → add → resolve → restore round trip', () => {
  const original = randomBytes(4096);
  let treeOid;
  let tmpDir;

  it('stores a file and creates a tree', async () => {
    const { filePath, dir } = tempFile(original);
    tmpDir = dir;
    const manifest = await cas.storeFile({ filePath, slug: 'integ/asset-1' });
    treeOid = await cas.createTree({ manifest });
    expect(treeOid).toBeTruthy();
  });

  it('adds to vault', async () => {
    const result = await cas.addToVault({ slug: 'integ/asset-1', treeOid });
    expect(result.commitOid).toBeTruthy();
  });

  it('resolves vault entry', async () => {
    const resolved = await cas.resolveVaultEntry({ slug: 'integ/asset-1' });
    expect(resolved).toBe(treeOid);
  });

  it('restores via readManifest + restore', async () => {
    const manifest = await cas.readManifest({ treeOid });
    const { buffer } = await cas.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Vault list and multiple entries
// ---------------------------------------------------------------------------
describe('vault list with multiple entries', () => {
  it('lists all vault entries sorted', async () => {
    // Add a second entry
    const { filePath, dir } = tempFile(randomBytes(1024));
    const manifest = await cas.storeFile({ filePath, slug: 'integ/asset-2' });
    const treeOid = await cas.createTree({ manifest });
    await cas.addToVault({ slug: 'integ/asset-2', treeOid });
    rmSync(dir, { recursive: true, force: true });

    const entries = await cas.listVault();
    const slugs = entries.map((e) => e.slug);
    expect(slugs).toContain('integ/asset-1');
    expect(slugs).toContain('integ/asset-2');
    // Verify sorted
    expect(slugs).toEqual([...slugs].sort());
  });
});

// ---------------------------------------------------------------------------
// Vault remove
// ---------------------------------------------------------------------------
describe('vault remove', () => {
  it('removes an entry', async () => {
    const result = await cas.removeFromVault({ slug: 'integ/asset-2' });
    expect(result.removedTreeOid).toBeTruthy();

    const entries = await cas.listVault();
    expect(entries.map((e) => e.slug)).not.toContain('integ/asset-2');
  });

  it('throws VAULT_ENTRY_NOT_FOUND for missing slug', async () => {
    await expect(cas.removeFromVault({ slug: 'nonexistent' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENTRY_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// Vault overwrite with force
// ---------------------------------------------------------------------------
describe('vault add with force overwrite', () => {
  it('throws without force on duplicate', async () => {
    const { filePath, dir } = tempFile(randomBytes(512));
    const manifest = await cas.storeFile({ filePath, slug: 'integ/asset-1' });
    const newTree = await cas.createTree({ manifest });
    rmSync(dir, { recursive: true, force: true });

    await expect(
      cas.addToVault({ slug: 'integ/asset-1', treeOid: newTree }),
    ).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENTRY_EXISTS',
    );
  });

  it('overwrites with force', async () => {
    const { filePath, dir } = tempFile(randomBytes(512));
    const manifest = await cas.storeFile({ filePath, slug: 'integ/asset-1' });
    const newTree = await cas.createTree({ manifest });
    rmSync(dir, { recursive: true, force: true });

    const result = await cas.addToVault({ slug: 'integ/asset-1', treeOid: newTree, force: true });
    expect(result.commitOid).toBeTruthy();

    const resolved = await cas.resolveVaultEntry({ slug: 'integ/asset-1' });
    expect(resolved).toBe(newTree);
  });
});

// ---------------------------------------------------------------------------
// Encrypted vault round trip
// ---------------------------------------------------------------------------
describe('encrypted vault', () => {
  let encRepoDir;
  let encCas;

  beforeAll(() => {
    encRepoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-vault-enc-integ-'));
    initBareRepo(encRepoDir);
    const plumbing = GitPlumbing.createDefault({ cwd: encRepoDir });
    encCas = new ContentAddressableStore({ plumbing });
  });

  afterAll(() => {
    rmSync(encRepoDir, { recursive: true, force: true });
  });

  it('init vault with passphrase stores KDF metadata', async () => {
    await encCas.initVault({
      passphrase: 'integration-test-passphrase',
      kdfOptions: { algorithm: 'pbkdf2' },
    });

    const metadata = await encCas.getVaultMetadata();
    expect(metadata.version).toBe(1);
    expect(metadata.encryption.cipher).toBe('aes-256-gcm');
    expect(metadata.encryption.kdf.algorithm).toBe('pbkdf2');
    expect(metadata.encryption.kdf.salt).toBeTruthy();
    expect(metadata.encryption.kdf.keyLength).toBe(32);
  });

  it('throws VAULT_ENCRYPTION_ALREADY_CONFIGURED on re-init', async () => {
    await expect(
      encCas.initVault({ passphrase: 'different' }),
    ).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENCRYPTION_ALREADY_CONFIGURED',
    );
  });
});

// ---------------------------------------------------------------------------
// getVaultService exposes VaultService instance
// ---------------------------------------------------------------------------
describe('getVaultService', () => {
  it('returns a VaultService instance', async () => {
    const vault = await cas.getVaultService();
    expect(vault).toBeInstanceOf(VaultService);
  });
});
