import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import ContentAddressableStore from '../../../index.js';

function initBareRepo(cwd) {
  const result = spawnSync('git', ['init', '--bare'], { cwd, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? result.stdout ?? 'git init --bare failed'}`.trim());
  }
}

async function* source(bytes) {
  yield bytes;
}

function expectBytesEqual(actual, expected) {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBe(expected[index]);
  }
}

describe('ContentAddressableStore.open', () => {
  it('creates a default JSON facade from a working directory', async () => {
    const repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-open-'));
    const original = new Uint8Array([0x6f, 0x70, 0x65, 0x6e]);

    try {
      initBareRepo(repoDir);
      const cas = await ContentAddressableStore.open({ cwd: repoDir, chunkSize: 1024 });
      const manifest = await cas.store({
        source: source(original),
        slug: 'open/demo',
        filename: 'demo.bin',
      });
      const treeOid = await cas.createTree({ manifest });
      const readBack = await cas.readManifest({ treeOid });
      const { buffer } = await cas.restore({ manifest: readBack });

      expect(cas.chunkSize).toBe(1024);
      expectBytesEqual(buffer, original);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
