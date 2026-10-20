/**
 * Integration proof that root-set admission validates more targets than one
 * cat-file metadata request may carry.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ContentAddressableStore from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: npm run test:integration:node',
  );
}

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT_SET_REF = 'refs/cas/rootsets/integration/metadata-windows';
const HASH_CHUNK = 500;
const scratchDirs = [];
const openStores = [];

function gitAt(cwd, args, input) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', input });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr || result.stdout || 'git failed'}`.trim());
  }
  return result.stdout.trim();
}

function scratch(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function writeBlobs(repo, count) {
  const payloadDir = scratch('cas-root-set-window-payloads-');
  const paths = [];
  for (let index = 0; index < count; index += 1) {
    const payloadPath = path.join(payloadDir, `payload-${index}`);
    writeFileSync(payloadPath, `retained payload ${index}\n`);
    paths.push(payloadPath);
  }
  const oids = [];
  // Small chunks keep each synchronous child's stdout below Deno's spawnSync limits.
  for (let start = 0; start < paths.length; start += HASH_CHUNK) {
    const chunk = paths.slice(start, start + HASH_CHUNK);
    oids.push(...gitAt(repo, ['hash-object', '-w', '--stdin-paths'], `${chunk.join('\n')}\n`).split('\n'));
  }
  return oids;
}

async function openRootSet(objectFormat) {
  const repo = scratch(`cas-root-set-window-${objectFormat}-`);
  gitAt(repo, ['init', '--bare', `--object-format=${objectFormat}`]);
  const plumbing = await createGitPlumbing({ cwd: repo });
  const cas = new ContentAddressableStore({ plumbing });
  openStores.push(cas);
  return { repo, rootSet: await cas.rootSets.open({ ref: ROOT_SET_REF }) };
}

function entriesFor(oids) {
  return oids.map((oid, index) => ({
    name: `payload-${String(index).padStart(5, '0')}`,
    oid,
    type: 'blob',
    retention: 'pinned',
  }));
}

afterEach(async () => {
  for (const cas of openStores.splice(0)) {
    await cas.close();
  }
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.each(['sha1', 'sha256'])('real-Git %s root-set metadata windows', (objectFormat) => {
  it.each([999, 1000, 1001, 2500])('admits %i targets across bounded requests', async (count) => {
    const { repo, rootSet } = await openRootSet(objectFormat);
    const entries = entriesFor(writeBlobs(repo, count));

    await rootSet.replace({ entries });

    const listed = await rootSet.list();
    expect(listed).toHaveLength(count);
    expect(listed.map((entry) => entry.oid).sort()).toEqual(
      entries.map((entry) => entry.oid).sort(),
    );
  });

  it('rejects a missing target beyond the first request without publishing', async () => {
    const { repo, rootSet } = await openRootSet(objectFormat);
    const oids = writeBlobs(repo, 1500);
    await rootSet.replace({ entries: entriesFor(oids.slice(0, 10)) });
    const headBefore = gitAt(repo, ['rev-parse', ROOT_SET_REF]);
    const missingOid = (objectFormat === 'sha256' ? 'f'.repeat(64) : 'f'.repeat(40));

    await expect(rootSet.replace({
      entries: entriesFor([...oids.slice(0, 1200), missingOid, ...oids.slice(1200)]),
    })).rejects.toMatchObject({ code: 'ROOT_SET_TARGET_MISSING' });

    expect(gitAt(repo, ['rev-parse', ROOT_SET_REF])).toBe(headBefore);
  });

  it('rejects a type mismatch beyond the first request without publishing', async () => {
    const { repo, rootSet } = await openRootSet(objectFormat);
    const oids = writeBlobs(repo, 1500);
    await rootSet.replace({ entries: entriesFor(oids.slice(0, 10)) });
    const headBefore = gitAt(repo, ['rev-parse', ROOT_SET_REF]);
    const entries = entriesFor(oids);
    entries[1400] = { ...entries[1400], type: 'tree' };

    await expect(rootSet.replace({ entries })).rejects.toMatchObject({
      code: 'ROOT_SET_TARGET_TYPE_MISMATCH',
      meta: expect.objectContaining({ oid: oids[1400] }),
    });

    expect(gitAt(repo, ['rev-parse', ROOT_SET_REF])).toBe(headBefore);
  });
});
