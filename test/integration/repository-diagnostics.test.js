/** Real-Git proof for bounded, non-mutating repository-wide diagnostics. */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ContentAddressableStore from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: npm run test:integration:node'
  );
}

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const EXPIRES_BEFORE = '2026-07-01T00:00:00.000Z';
let cas;
let oldLooseOid;
let recentLooseOid;
let reflogCommitOid;
let repoDir;

function git(args, input) {
  const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', input });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr || result.stdout || 'git failed'}`.trim());
  }
  return result.stdout.trim();
}

function objectIds() {
  return git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'])
    .split('\n')
    .filter(Boolean);
}

function refs() {
  return git(['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/'])
    .split('\n')
    .filter(Boolean);
}

function createCommit(content, message) {
  const blob = git(['hash-object', '-w', '--stdin'], content);
  const tree = git(['mktree'], `100644 blob ${blob}\tpayload.txt\n`);
  const commit = git(['commit-tree', tree, '-m', message]);
  return { blob, tree, commit };
}

function makeOld(oid) {
  const objectPath = path.join(repoDir, 'objects', oid.slice(0, 2), oid.slice(2));
  const old = new Date('2026-06-01T00:00:00.000Z');
  utimesSync(objectPath, old, old);
}

async function* bytes(value) {
  yield Buffer.from(value);
}

beforeAll(async () => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-repository-doctor-'));
  git(['init', '--bare']);
  git(['config', 'user.name', 'Repository Doctor']);
  git(['config', 'user.email', 'doctor@example.test']);
  git(['config', 'core.logAllRefUpdates', 'true']);

  const reflogRoot = createCommit('reflog-only', 'reflog root');
  const currentRoot = createCommit('current-branch', 'current root');
  reflogCommitOid = reflogRoot.commit;
  git(['update-ref', '--create-reflog', 'refs/heads/main', reflogRoot.commit]);
  git(['update-ref', 'refs/heads/main', currentRoot.commit, reflogRoot.commit]);
  git(['tag', '-a', 'v1', '-m', 'diagnostic tag', currentRoot.commit]);

  cas = new ContentAddressableStore({
    plumbing: await createGitPlumbing({ cwd: repoDir }),
    clock: { now: () => new Date('2026-07-13T12:00:00.000Z') },
  });
  const rootPage = await cas.pages.put({ source: Buffer.from('root-set target') });
  const rootSet = await cas.rootSets.open({ ref: 'refs/cas/rootsets/git-warp/live' });
  await rootSet.put({
    name: 'live',
    oid: rootPage.handle.oid,
    type: 'blob',
    retention: 'pinned',
  });
  const cachePage = await cas.pages.put({ source: Buffer.from('cache target') });
  const cache = await cas.caches.open({ namespace: 'git-warp/materializations' });
  await cache.put('coordinate:1', cachePage.handle, { retention: 'evictable' });
  const expiring = await cas.expiringSets.open({ namespace: 'git-warp/replay' });
  await expiring.addIfAbsent('request:1', { expiresAt: '2026-07-20T00:00:00.000Z' });
  const asset = await cas.assets.put({
    source: bytes('vault target'),
    slug: 'diagnostics/vault-target',
    filename: 'vault.txt',
  });
  await cas.initVault();
  await cas.addToVault({ slug: 'diagnostics/vault-target', treeOid: asset.handle.oid });

  recentLooseOid = git(['hash-object', '-w', '--stdin'], 'recent-unreachable');
  oldLooseOid = git(['hash-object', '-w', '--stdin'], 'past-grace-unreachable');
  makeOld(oldLooseOid);
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

// eslint-disable-next-line max-lines-per-function
describe('repository diagnostics', () => {
  // eslint-disable-next-line max-lines-per-function
  it('classifies refs, reflogs, recent orphans, and volatile loose objects without mutation', async () => {
    const objectsBefore = objectIds();
    const refsBefore = refs();
    const reachable = new Set(
      git(['rev-list', '--all', '--reflog', '--objects', '--no-object-names']).split('\n')
    );
    const prunable = new Set(
      git(['prune', '--dry-run', '--verbose', '--no-progress', `--expire=${EXPIRES_BEFORE}`])
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(' ')[0])
    );

    expect(reachable).toContain(reflogCommitOid);
    expect(reachable).not.toContain(recentLooseOid);
    expect(reachable).not.toContain(oldLooseOid);
    expect(prunable).not.toContain(recentLooseOid);
    expect(prunable).toContain(oldLooseOid);

    const report = await cas.diagnostics.doctor({ expiresBefore: EXPIRES_BEFORE });

    expect(report.healthy).toBe(true);
    expect(report.repository.objects.volatile.objectCount).toBeGreaterThanOrEqual(1);
    expect(report.repository.objects.orphaned.objectCount).toBeGreaterThanOrEqual(1);
    expect(report.repository.objects.total.objectCount).toBe(
      report.repository.objects.anchored.objectCount +
        report.repository.objects.orphaned.objectCount +
        report.repository.objects.volatile.objectCount
    );
    expect(report.repository.roots).toMatchObject({ reflogsIncluded: true });
    expect(report.usage.caches).toMatchObject({
      coverage: { observed: 1, inspected: 1, complete: true },
      totals: { entryCount: 1 },
    });
    expect(report.usage.rootSets).toMatchObject({
      coverage: { observed: 1, inspected: 1, complete: true },
      totals: { entryCount: 1, pinnedEntries: 1 },
    });
    expect(report.usage.expiringSets).toMatchObject({
      coverage: { observed: 1, inspected: 1, complete: true },
      totals: { entryCount: 1, liveEntries: 1 },
    });
    expect(report.usage.vault).toMatchObject({
      present: true,
      healthy: true,
      entryCount: 1,
      reachability: 'anchored',
    });
    expect(objectIds()).toEqual(objectsBefore);
    expect(refs()).toEqual(refsBefore);
  });
});
