/**
 * Real-Git proof for compound workspace admission and immediate-prune safety.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ContentAddressableStore from '../../index.js';
import { createCountingGitPlumbing } from '../../scripts/diagnostics/createCountingGitPlumbing.js';
import { ErrorCodes } from '../../src/domain/errors/index.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: npm run test:integration:node'
  );
}

vi.setConfig({ testTimeout: 30_000 });

describe.each(['sha1', 'sha256'])('real-Git %s compound workspace admission', (objectFormat) => {
  it('retains dependent waves through one checked ref publication', async () => {
    await proveCompoundAdmission(objectFormat);
  });

  it('publishes no generation when a dependent wave fails', async () => {
    await proveFailureContainment(objectFormat);
  });
});

async function proveCompoundAdmission(objectFormat) {
  const repo = mkdtempSync(path.join(os.tmpdir(), `cas-compound-${objectFormat}-`));
  initializeRepository(repo, objectFormat);
  const counted = await createCountingGitPlumbing({ cwd: repo, sessions: true });
  const cas = new ContentAddressableStore({ plumbing: counted.plumbing });
  try {
    const workspace = await cas.workspaces.open({
      namespace: `integration/compound-${objectFormat}`,
      ttlMs: 60_000,
    });
    const admitted = await admitGraph(workspace);
    await assertAdmission({ admitted, cas, counted, repo, workspace });
  } finally {
    await cas.close();
    rmSync(repo, { recursive: true, force: true });
  }
}

async function proveFailureContainment(objectFormat) {
  const repo = mkdtempSync(path.join(os.tmpdir(), `cas-compound-failure-${objectFormat}-`));
  initializeRepository(repo, objectFormat);
  const cas = new ContentAddressableStore({
    plumbing: (await createCountingGitPlumbing({ cwd: repo })).plumbing,
  });
  try {
    const namespace = `integration/compound-failure-${objectFormat}`;
    const workspace = await cas.workspaces.open({ namespace, ttlMs: 60_000 });
    let provisional;
    await expect(workspace.batch({
      operation: async (scope) => {
        [provisional] = await scope.pages.putBatch({
          pages: [{ source: Buffer.from('unretained after failure') }],
        });
        await scope.bundles.putOrderedBatch({
          bundles: [{ members: [['invalid', 'not-an-application-handle']] }],
        });
      },
    })).rejects.toMatchObject({ code: ErrorCodes.HANDLE_KIND_MISMATCH });
    await expect(cas.workspaces.inspect({ namespace, limit: 10 })).resolves.toMatchObject({
      returned: 0,
    });
    git(repo, ['prune', '--expire=now']);
    expect(objectExists(repo, provisional.oid)).toBe(false);
  } finally {
    await cas.close();
    rmSync(repo, { recursive: true, force: true });
  }
}

async function admitGraph(workspace) {
  return await workspace.batch({
    maxOperations: 3,
    operation: async (scope) => await stageGraph(scope),
  });
}

async function stageGraph(scope) {
  const pages = await scope.pages.putBatch({
    pages: Array.from({ length: 8 }, (_, index) => ({
      source: Buffer.from(`compound-page-${index}`),
    })),
  });
  const leaves = await scope.bundles.putOrderedBatch({
    bundles: pages.map((page, index) => ({
      members: [[`payload/${index}`, page]],
    })),
  });
  return (
    await scope.bundles.putOrderedBatch({
      bundles: [
        {
          members: leaves.map((leaf, index) => [`leaves/${index}`, leaf]),
        },
      ],
    })
  )[0];
}

async function assertAdmission({ admitted, cas, counted, repo, workspace }) {
  const retainedOids = admitted.retention.handles.map((handle) => handle.oid);
  const counts = counted.snapshot();
  expect(count(counts, 'update-ref') + count(counts, 'session:update-ref')).toBe(1);
  expect(count(counts, 'session:fast-import')).toBe(1);
  expect(count(counted.activeSessions(), 'fast-import')).toBe(0);
  expect(git(repo, ['rev-parse', admitted.retention.ref])).toBe(admitted.retention.generation);
  expect(reachableOids(repo, admitted.retention.ref)).toEqual(
    expect.arrayContaining(admitted.retention.handles.map((handle) => handle.oid))
  );

  git(repo, ['prune', '--expire=now']);
  const firstLeaf = await cas.bundles.getMember({
    handle: admitted.value,
    path: 'leaves/0',
  });
  await expect(
    cas.bundles.getMember({
      handle: firstLeaf.handle,
      path: 'payload/0',
    })
  ).resolves.toMatchObject({ handle: admitted.retention.handles[0] });

  await workspace.release();
  git(repo, ['reflog', 'expire', '--expire=now', '--all']);
  git(repo, ['gc', '--prune=now']);
  expect(retainedOids.every((oid) => !objectExists(repo, oid))).toBe(true);
}

function initializeRepository(repo, objectFormat) {
  git(repo, ['init', '--bare', `--object-format=${objectFormat}`]);
  git(repo, ['config', 'fastimport.unpackLimit', '100']);
}

function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'git failed').trim());
  }
  return result.stdout.trim();
}

function reachableOids(repo, ref) {
  return git(repo, ['rev-list', '--objects', ref])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' ')[0]);
}

function objectExists(repo, oid) {
  return spawnSync('git', ['cat-file', '-e', oid], { cwd: repo }).status === 0;
}

function count(counts, operation) {
  return counts.get(operation) ?? 0;
}
