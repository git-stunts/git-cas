/**
 * Integration tests — store → createTree → readTree → restore round trip.
 *
 * These tests run against a real Git bare repo and exercise the full stack:
 * GitPlumbing → GitPersistenceAdapter → CasService → Facade.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '../../index.js';
import CborCodec from '../../src/infrastructure/codecs/CborCodec.js';
import Manifest from '../../src/domain/value-objects/Manifest.js';
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
let casCbor;

beforeAll(() => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-integ-'));
  execSync('git init --bare', { cwd: repoDir, stdio: 'ignore' });

  const plumbing = GitPlumbing.createDefault({ cwd: repoDir });
  cas = new ContentAddressableStore({ plumbing });
  casCbor = new ContentAddressableStore({ plumbing, codec: new CborCodec() });
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
// Plaintext round trip — JSON codec
// ---------------------------------------------------------------------------
describe('plaintext round trip (JSON)', () => {
  it('10 KB file', async () => {
    const original = randomBytes(10 * 1024);
    const { filePath, dir } = tempFile(original);

    const manifest = await cas.storeFile({ filePath, slug: 'plain-10k' });
    const treeOid = await cas.createTree({ manifest });

    // Read tree back
    const entries = await cas.service.persistence.readTree(treeOid);
    const manifestEntry = entries.find((e) => e.name === 'manifest.json');
    expect(manifestEntry).toBeDefined();

    const manifestBlob = await cas.service.persistence.readBlob(manifestEntry.oid);
    const restored = new Manifest(cas.service.codec.decode(manifestBlob));

    const { buffer, bytesWritten } = await cas.restore({ manifest: restored });
    expect(buffer.equals(original)).toBe(true);
    expect(bytesWritten).toBe(original.length);

    rmSync(dir, { recursive: true, force: true });
  });

  it('0-byte file', async () => {
    const original = Buffer.alloc(0);
    const { filePath, dir } = tempFile(original);

    const manifest = await cas.storeFile({ filePath, slug: 'plain-empty' });
    const treeOid = await cas.createTree({ manifest });

    const entries = await cas.service.persistence.readTree(treeOid);
    const manifestEntry = entries.find((e) => e.name === 'manifest.json');
    const manifestBlob = await cas.service.persistence.readBlob(manifestEntry.oid);
    const restored = new Manifest(cas.service.codec.decode(manifestBlob));

    const { buffer, bytesWritten } = await cas.restore({ manifest: restored });
    expect(buffer.length).toBe(0);
    expect(bytesWritten).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it('exact chunkSize file (256 KiB)', async () => {
    const original = randomBytes(256 * 1024);
    const { filePath, dir } = tempFile(original);

    const manifest = await cas.storeFile({ filePath, slug: 'plain-exact' });
    expect(manifest.chunks.length).toBe(1);

    const { buffer } = await cas.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('3x chunkSize file', async () => {
    const original = randomBytes(3 * 256 * 1024);
    const { filePath, dir } = tempFile(original);

    const manifest = await cas.storeFile({ filePath, slug: 'plain-3x' });
    expect(manifest.chunks.length).toBe(3);

    const { buffer } = await cas.restore({ manifest });
    expect(buffer.equals(original)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Encrypted round trip — JSON codec
// ---------------------------------------------------------------------------
describe('encrypted round trip (JSON)', () => {
  const key = randomBytes(32);

  it('10 KB encrypted file', async () => {
    const original = randomBytes(10 * 1024);
    const { filePath, dir } = tempFile(original);

    const manifest = await cas.storeFile({
      filePath,
      slug: 'enc-10k',
      encryptionKey: key,
    });
    expect(manifest.encryption).toBeDefined();
    expect(manifest.encryption.encrypted).toBe(true);

    const treeOid = await cas.createTree({ manifest });
    const entries = await cas.service.persistence.readTree(treeOid);
    const manifestEntry = entries.find((e) => e.name === 'manifest.json');
    const manifestBlob = await cas.service.persistence.readBlob(manifestEntry.oid);
    const restored = new Manifest(cas.service.codec.decode(manifestBlob));

    const { buffer } = await cas.restore({ manifest: restored, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('wrong key throws INTEGRITY_ERROR', async () => {
    const original = randomBytes(1024);
    const { filePath, dir } = tempFile(original);

    const manifest = await cas.storeFile({
      filePath,
      slug: 'enc-wrong-key',
      encryptionKey: key,
    });

    const wrongKey = randomBytes(32);
    await expect(
      cas.restore({ manifest, encryptionKey: wrongKey }),
    ).rejects.toThrow(CasError);

    try {
      await cas.restore({ manifest, encryptionKey: wrongKey });
    } catch (err) {
      expect(err.code).toBe('INTEGRITY_ERROR');
    }

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// CBOR codec round trip
// ---------------------------------------------------------------------------
describe('CBOR codec round trip', () => {
  it('10 KB plaintext via CBOR', async () => {
    const original = randomBytes(10 * 1024);
    const { filePath, dir } = tempFile(original);

    const manifest = await casCbor.storeFile({ filePath, slug: 'cbor-10k' });
    const treeOid = await casCbor.createTree({ manifest });

    const entries = await casCbor.service.persistence.readTree(treeOid);
    const manifestEntry = entries.find((e) => e.name === 'manifest.cbor');
    expect(manifestEntry).toBeDefined();

    const manifestBlob = await casCbor.service.persistence.readBlob(manifestEntry.oid);
    const restored = new Manifest(casCbor.service.codec.decode(manifestBlob));

    const { buffer } = await casCbor.restore({ manifest: restored });
    expect(buffer.equals(original)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('encrypted via CBOR', async () => {
    const key = randomBytes(32);
    const original = randomBytes(5 * 1024);
    const { filePath, dir } = tempFile(original);

    const manifest = await casCbor.storeFile({
      filePath,
      slug: 'cbor-enc',
      encryptionKey: key,
    });

    const { buffer } = await casCbor.restore({ manifest, encryptionKey: key });
    expect(buffer.equals(original)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// restoreFile — write to disk
// ---------------------------------------------------------------------------
describe('restoreFile (write to disk)', () => {
  it('restores to a file on disk', async () => {
    const original = randomBytes(4096);
    const { filePath, dir } = tempFile(original);

    const manifest = await cas.storeFile({ filePath, slug: 'disk-restore' });

    const outDir = mkdtempSync(path.join(os.tmpdir(), 'cas-out-'));
    const outPath = path.join(outDir, 'restored.bin');

    const { bytesWritten } = await cas.restoreFile({
      manifest,
      outputPath: outPath,
    });

    expect(bytesWritten).toBe(original.length);
    const restored = readFileSync(outPath);
    expect(restored.equals(original)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Fuzz: 50 file sizes around chunk boundaries
// ---------------------------------------------------------------------------
describe('fuzz: 50 file sizes around chunk boundaries', () => {
  const chunkSize = 256 * 1024;

  for (let i = 0; i < 50; i++) {
    // Spread sizes: 0, near chunkSize, 2x, 3x, with ±1 offsets
    const base = Math.floor((i / 49) * 3 * chunkSize);
    const offset = (i % 3) - 1; // -1, 0, +1
    const size = Math.max(0, base + offset);

    it(`round-trips ${size} bytes (iteration ${i})`, async () => {
      const original = Buffer.alloc(size);
      for (let b = 0; b < size; b++) original[b] = (i + b) & 0xff;

      const { filePath, dir } = tempFile(original);
      const manifest = await cas.storeFile({ filePath, slug: `fuzz-${i}` });
      const { buffer } = await cas.restore({ manifest });

      expect(buffer.equals(original)).toBe(true);

      rmSync(dir, { recursive: true, force: true });
    });
  }
});
