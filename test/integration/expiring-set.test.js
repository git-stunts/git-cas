/** Real-Git proof for ExpiringSet atomicity, restart, and expiry-only release. */

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

vi.setConfig({ testTimeout: 20_000, hookTimeout: 30_000 });

let cas;
let plumbing;
let repoDir;
let time = Date.parse('2026-07-13T12:00:00.000Z');
const PRESSURE_MARKERS = 4;

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

function prunableOids() {
  return new Set(
    git(['prune', '-n', '--expire=now'])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ')[0]),
  );
}

function expiry(milliseconds = 60_000) {
  return new Date(time + milliseconds);
}

beforeAll(async () => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-expiring-set-integ-'));
  git(['init', '--bare']);
  plumbing = await createGitPlumbing({ cwd: repoDir });
  cas = new ContentAddressableStore({
    plumbing,
    clock: { now: () => new Date(time) },
  });
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('ExpiringSet Git retention', () => {
  it('anchors no plaintext, survives restart, and uses a parentless generation', async () => {
    const set = await cas.expiringSets.open({ namespace: 'git-warp/restart-proof' });
    const result = await set.addIfAbsent('nonce:restart-secret', {
      expiresAt: expiry(),
    });
    const head = git(['rev-parse', set.ref]);
    const marker = git(['cat-file', '-p', result.marker.evidence.handle.oid]);
    const witnessEdge = git(['ls-tree', head, result.marker.evidence.root.path]);
    const reachable = git(['rev-list', '--objects', head]);

    expect(result).toMatchObject({ admitted: true, changed: true, generation: head });
    expect(marker).not.toContain('nonce:restart-secret');
    expect(witnessEdge).toContain('tree');
    expect(reachable).toContain(result.marker.evidence.handle.oid);
    expect(prunableOids()).not.toContain(result.marker.evidence.handle.oid);
    expect(git(['cat-file', '-p', set.ref])).not.toMatch(/^parent /m);
    await expect(set.contains('nonce:restart-secret')).resolves.toBe(true);
    expect(git(['rev-parse', set.ref])).toBe(head);

    const restarted = new ContentAddressableStore({
      plumbing: await createGitPlumbing({ cwd: repoDir }),
      clock: { now: () => new Date(time) },
    });
    const reopened = await restarted.expiringSets.open({ namespace: 'git-warp/restart-proof' });
    await expect(reopened.contains('nonce:restart-secret')).resolves.toBe(true);
    await expect(reopened.doctor()).resolves.toMatchObject({ healthy: true });
  });

  it('releases an expired marker only after explicit sweep', async () => {
    const set = await cas.expiringSets.open({ namespace: 'git-warp/expiry-proof' });
    const added = await set.addIfAbsent('nonce:expiring', { expiresAt: expiry(1000) });
    time += 1001;
    const beforeSweep = git(['rev-parse', set.ref]);

    await expect(set.contains('nonce:expiring')).resolves.toBe(false);
    expect(git(['rev-parse', set.ref])).toBe(beforeSweep);
    expect(prunableOids()).not.toContain(added.marker.evidence.handle.oid);

    const swept = await set.sweep();
    expect(swept).toMatchObject({ changed: true, removed: 1 });
    expect(prunableOids()).toContain(added.marker.evidence.handle.oid);
    expect(prunableOids()).not.toContain(swept.witness.handle.oid);
  });
});

describe('ExpiringSet concurrent safety', () => {
  it('admits one duplicate winner and preserves every live marker under pressure', async () => {
    const left = await cas.expiringSets.open({ namespace: 'git-warp/concurrency-proof' });
    const right = await cas.expiringSets.open({ namespace: 'git-warp/concurrency-proof' });
    const results = await Promise.all([
      left.addIfAbsent('nonce:shared', { expiresAt: expiry() }),
      right.addIfAbsent('nonce:shared', { expiresAt: expiry() }),
    ]);

    expect(results.filter((result) => result.admitted)).toHaveLength(1);
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    for (let index = 0; index < PRESSURE_MARKERS; index++) {
      await left.addIfAbsent(`nonce:pressure:${index}`, { expiresAt: expiry() });
    }

    await expect(left.sweep()).resolves.toMatchObject({ changed: false, removed: 0 });
    await expect(left.contains('nonce:shared')).resolves.toBe(true);
    for (let index = 0; index < PRESSURE_MARKERS; index++) {
      await expect(left.contains(`nonce:pressure:${index}`)).resolves.toBe(true);
    }
  });
});
