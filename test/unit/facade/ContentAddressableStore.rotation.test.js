import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '../../../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cas-rotation-'));
  execSync('git init --bare', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function createCas(repoDir) {
  const plumbing = GitPlumbing.createDefault({ cwd: repoDir });
  return new ContentAddressableStore({ plumbing, chunkSize: 1024 });
}

async function* bufferSource(buf) {
  yield buf;
}

async function storeEnvelope({ cas, slug, data, passphrase }) {
  const metadata = await cas.getVaultMetadata();
  const { key } = await cas.deriveKey({
    passphrase,
    salt: Buffer.from(metadata.encryption.kdf.salt, 'base64'),
    algorithm: metadata.encryption.kdf.algorithm,
    iterations: metadata.encryption.kdf.iterations,
  });
  const manifest = await cas.store({
    source: bufferSource(data),
    slug,
    filename: `${slug}.bin`,
    recipients: [{ label: 'vault', key }],
  });
  const treeOid = await cas.createTree({ manifest });
  await cas.addToVault({ slug, treeOid, force: true });
  return treeOid;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ContentAddressableStore – rotateVaultPassphrase', () => { // eslint-disable-line max-lines-per-function
  let repoDir;
  let cas;

  beforeEach(() => {
    repoDir = createRepo();
    cas = createCas(repoDir);
  });

  afterEach(() => {
    if (repoDir) { rmSync(repoDir, { recursive: true, force: true }); }
  });

  it('3 envelope entries → rotate → all restorable with new passphrase', { timeout: 15_000 }, async () => {
    const oldPass = 'old-pass';
    const newPass = 'new-pass';
    await cas.initVault({ passphrase: oldPass });

    const originals = {};
    for (const name of ['alpha', 'beta', 'gamma']) {
      const data = randomBytes(256);
      originals[name] = data;
      await storeEnvelope({ cas, slug: name, data, passphrase: oldPass });
    }

    const { commitOid, rotatedSlugs, skippedSlugs } = await cas.rotateVaultPassphrase({
      oldPassphrase: oldPass, newPassphrase: newPass,
    });

    expect(commitOid).toMatch(/^[0-9a-f]{40}$/);
    expect(rotatedSlugs.sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(skippedSlugs).toEqual([]);

    // Verify all restorable with new passphrase
    const newMeta = await cas.getVaultMetadata();
    const { key: newKey } = await cas.deriveKey({
      passphrase: newPass,
      salt: Buffer.from(newMeta.encryption.kdf.salt, 'base64'),
      algorithm: newMeta.encryption.kdf.algorithm,
      iterations: newMeta.encryption.kdf.iterations,
    });

    for (const name of ['alpha', 'beta', 'gamma']) {
      const treeOid = await cas.resolveVaultEntry({ slug: name });
      const manifest = await cas.readManifest({ treeOid });
      const { buffer } = await cas.restore({ manifest, encryptionKey: newKey });
      expect(buffer.equals(originals[name])).toBe(true);
    }
  });

  it('mixed: 2 envelope + 1 non-envelope → 2 rotated, 1 skipped', async () => {
    const oldPass = 'old-pass';
    const newPass = 'new-pass';
    await cas.initVault({ passphrase: oldPass });

    // 2 envelope entries
    await storeEnvelope({ cas, slug: 'env1', data: randomBytes(128), passphrase: oldPass });
    await storeEnvelope({ cas, slug: 'env2', data: randomBytes(128), passphrase: oldPass });

    // 1 non-envelope (direct key from vault passphrase)
    const metadata = await cas.getVaultMetadata();
    const { key: directKey } = await cas.deriveKey({
      passphrase: oldPass,
      salt: Buffer.from(metadata.encryption.kdf.salt, 'base64'),
      algorithm: metadata.encryption.kdf.algorithm,
      iterations: metadata.encryption.kdf.iterations,
    });
    const plainManifest = await cas.store({
      source: bufferSource(randomBytes(128)),
      slug: 'direct',
      filename: 'direct.bin',
      encryptionKey: directKey,
    });
    const plainTree = await cas.createTree({ manifest: plainManifest });
    await cas.addToVault({ slug: 'direct', treeOid: plainTree });

    const { rotatedSlugs, skippedSlugs } = await cas.rotateVaultPassphrase({
      oldPassphrase: oldPass, newPassphrase: newPass,
    });

    expect(rotatedSlugs.sort()).toEqual(['env1', 'env2']);
    expect(skippedSlugs).toEqual(['direct']);
  });

  it('wrong old passphrase → error', async () => {
    const oldPass = 'old-pass';
    await cas.initVault({ passphrase: oldPass });
    await storeEnvelope({ cas, slug: 'asset', data: randomBytes(128), passphrase: oldPass });

    await expect(
      cas.rotateVaultPassphrase({ oldPassphrase: 'wrong', newPassphrase: 'new' }),
    ).rejects.toThrow();
  });

  it('vault not encrypted → VAULT_METADATA_INVALID', async () => {
    await cas.initVault();
    // Store unencrypted entry
    const manifest = await cas.store({
      source: bufferSource(randomBytes(64)),
      slug: 'plain',
      filename: 'plain.bin',
    });
    const tree = await cas.createTree({ manifest });
    await cas.addToVault({ slug: 'plain', treeOid: tree });

    await expect(
      cas.rotateVaultPassphrase({ oldPassphrase: 'any', newPassphrase: 'new' }),
    ).rejects.toMatchObject({ code: 'VAULT_METADATA_INVALID' });
  });

  it('metadata updated with new KDF salt', async () => {
    const oldPass = 'old-pass';
    const newPass = 'new-pass';
    await cas.initVault({ passphrase: oldPass });
    await storeEnvelope({ cas, slug: 'asset', data: randomBytes(128), passphrase: oldPass });

    const oldMeta = await cas.getVaultMetadata();
    const oldSalt = oldMeta.encryption.kdf.salt;

    await cas.rotateVaultPassphrase({ oldPassphrase: oldPass, newPassphrase: newPass });

    const newMeta = await cas.getVaultMetadata();
    expect(newMeta.encryption.kdf.salt).not.toBe(oldSalt);
    expect(newMeta.encryption.kdf.algorithm).toBe(oldMeta.encryption.kdf.algorithm);
  });
});
