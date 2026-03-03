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
  execSync('git config user.name "test"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test"', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function createCas(repoDir) {
  const plumbing = GitPlumbing.createDefault({ cwd: repoDir });
  return new ContentAddressableStore({ plumbing, chunkSize: 1024 });
}

async function* bufferSource(buf) {
  yield buf;
}

// ---------------------------------------------------------------------------
// Wiring test — verifies facade delegates to VaultPassphraseRotator
// ---------------------------------------------------------------------------
describe('ContentAddressableStore – rotateVaultPassphrase (wiring)', () => {
  let repoDir;
  let cas;

  beforeEach(() => {
    repoDir = createRepo();
    cas = createCas(repoDir);
  });

  afterEach(() => {
    if (repoDir) { rmSync(repoDir, { recursive: true, force: true }); }
  });

  it('delegates to rotateVaultPassphrase and returns result', async () => {
    const oldPass = 'old-pass';
    const newPass = 'new-pass';
    await cas.initVault({ passphrase: oldPass, kdfOptions: { iterations: 1 } });

    // Store one envelope entry through the facade
    const metadata = await cas.getVaultMetadata();
    const { key } = await cas.deriveKey({
      passphrase: oldPass,
      salt: Buffer.from(metadata.encryption.kdf.salt, 'base64'),
      algorithm: metadata.encryption.kdf.algorithm,
      iterations: metadata.encryption.kdf.iterations,
    });
    const manifest = await cas.store({
      source: bufferSource(randomBytes(128)),
      slug: 'asset',
      filename: 'asset.bin',
      recipients: [{ label: 'vault', key }],
    });
    const treeOid = await cas.createTree({ manifest });
    await cas.addToVault({ slug: 'asset', treeOid, force: true });

    const { commitOid, rotatedSlugs, skippedSlugs } = await cas.rotateVaultPassphrase({
      oldPassphrase: oldPass, newPassphrase: newPass,
    });

    expect(commitOid).toMatch(/^[0-9a-f]{40}$/);
    expect(rotatedSlugs).toEqual(['asset']);
    expect(skippedSlugs).toEqual([]);
  });
});
