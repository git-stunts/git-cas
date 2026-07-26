/**
 * Integration proof for Git-backed RootSet reachability.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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

vi.setConfig({ testTimeout: 15_000, hookTimeout: 30_000 });

const ROOT_SET_REF = 'refs/cas/rootsets/integration/prune-proof';
let repoDir;
let rootSet;
let targetTreeOid;

function git(args, input) {
  const result = spawnSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    input,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr || result.stdout || 'git failed'}`.trim());
  }
  return result.stdout.trim();
}

function prunableOids() {
  return new Set(
    git(['prune', '-n', '--expire=now'])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ')[0]),
  );
}

beforeAll(async () => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-root-set-integ-'));
  git(['init', '--bare']);
  const blobOid = git(['hash-object', '-w', '--stdin'], 'retained payload');
  targetTreeOid = git(['mktree'], `100644 blob ${blobOid}\tpayload\n`);

  const plumbing = await createGitPlumbing({ cwd: repoDir });
  const cas = new ContentAddressableStore({ plumbing });
  rootSet = await cas.rootSets.open({ ref: ROOT_SET_REF });
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('RootSet Git reachability', () => {
  it('anchors a tree while present using a parentless current-generation commit', async () => {
    await rootSet.put({
      name: 'payload',
      oid: targetTreeOid,
      type: 'tree',
      retention: 'evictable',
    });

    expect(prunableOids()).not.toContain(targetTreeOid);
    expect(git(['cat-file', '-p', ROOT_SET_REF])).not.toMatch(/^parent /m);
    expect(git(['show', '-s', '--format=%an <%ae>%n%cn <%ce>', ROOT_SET_REF])).toBe(
      'git-cas <git-cas@example.invalid>\ngit-cas <git-cas@example.invalid>',
    );
  });

  it('makes a removed and otherwise-unreferenced tree prunable', async () => {
    await rootSet.remove({ name: 'payload' });

    expect(prunableOids()).toContain(targetTreeOid);
  });
});

describe('RootSet target validation', () => {
  it('rejects missing and mismatched targets before changing the ref', async () => {
    const headBefore = git(['rev-parse', ROOT_SET_REF]);

    await expect(rootSet.put({
      name: 'missing',
      oid: 'f'.repeat(40),
      type: 'tree',
    })).rejects.toMatchObject({ code: 'ROOT_SET_TARGET_MISSING' });
    await expect(rootSet.put({
      name: 'wrong-type',
      oid: targetTreeOid,
      type: 'blob',
    })).rejects.toMatchObject({ code: 'ROOT_SET_TARGET_TYPE_MISMATCH' });

    expect(git(['rev-parse', ROOT_SET_REF])).toBe(headBefore);
  });
});
