/**
 * Real-Git command-count proof for direct bundle references and immutable
 * metadata coalescing.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ContentAddressableStore from '../../index.js';
import { createCountingGitPlumbing } from '../../scripts/diagnostics/createCountingGitPlumbing.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: npm run test:integration:node'
  );
}

vi.setConfig({ testTimeout: 20_000, hookTimeout: 30_000 });

let repoDir;
let writer;
let outer;

function git(args) {
  const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr || result.stdout || 'git failed'}`.trim());
  }
  return result.stdout.trim();
}

async function countingReader({ sessions = false } = {}) {
  const counted = await createCountingGitPlumbing({ cwd: repoDir, sessions });
  return {
    cas: new ContentAddressableStore({ plumbing: counted.plumbing }),
    snapshot: counted.snapshot,
  };
}

async function closeAll(...stores) {
  const results = await Promise.allSettled(stores.map((store) => store.close()));
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Multiple stores failed to close');
  }
}

function count(snapshot, operation) {
  return snapshot.get(operation) ?? 0;
}

function total(snapshot) {
  return [...snapshot.values()].reduce((sum, value) => sum + value, 0);
}

function delta(after, before) {
  const result = new Map();
  for (const [operation, value] of after) {
    result.set(operation, value - count(before, operation));
  }
  return result;
}

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

beforeAll(async () => {
  repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-bundle-reference-perf-'));
  git(['init', '--bare']);
  writer = new ContentAddressableStore({
    plumbing: await createGitPlumbing({ cwd: repoDir }),
  });
  const child = await writer.pages.put({ source: Buffer.from('child') });
  const nested = await writer.bundles.put({ members: { child: child.handle } });
  outer = await writer.bundles.put({ members: { nested: nested.handle } });
});

afterAll(async () => {
  await writer.close();
  rmSync(repoDir, { recursive: true, force: true });
});

describe('real-Git immutable page payload reads', () => {
  it('performs zero additional Git commands for an identical warm page read', async () => {
    const reader = await countingReader();
    const page = await writer.pages.put({ source: Buffer.from('warm page payload') });

    await expect(reader.cas.pages.get({ handle: page.handle })).resolves.toEqual(
      new Uint8Array(Buffer.from('warm page payload'))
    );
    const cold = reader.snapshot();
    await reader.cas.pages.get({ handle: page.handle });
    const warm = delta(reader.snapshot(), cold);

    expect(count(cold, 'cat-file')).toBeGreaterThan(0);
    expect(total(warm)).toBe(0);
    await reader.cas.close();
  });
});

describe('real-Git direct bundle reference reads', () => {
  it('coalesces immutable Git metadata across repeated targeted reads', async () => {
    const reader = await countingReader();
    await expect(
      reader.cas.bundles.getMemberReference({
        handle: outer.handle,
        path: 'nested',
      })
    ).resolves.toMatchObject({ path: 'nested', type: 'tree' });
    const cold = reader.snapshot();

    await reader.cas.bundles.getMemberReference({ handle: outer.handle, path: 'nested' });
    const warm = delta(reader.snapshot(), cold);

    expect(count(cold, 'ls-tree')).toBeGreaterThan(0);
    expect(count(cold, 'cat-file:batch-check')).toBeGreaterThan(0);
    expect(count(warm, 'ls-tree')).toBe(0);
    expect(count(warm, 'cat-file:batch-check')).toBe(0);
    expect(total(warm)).toBe(0);
    await reader.cas.close();
  });

  it('does less Git work than complete recursive member validation', async () => {
    const direct = await countingReader();
    const references = await collect(
      direct.cas.bundles.iterateMemberReferences({
        handle: outer.handle,
      })
    );
    const directCounts = direct.snapshot();

    const complete = await countingReader();
    const members = await collect(complete.cas.bundles.iterateMembers({ handle: outer.handle }));
    const completeCounts = complete.snapshot();

    expect(references).toHaveLength(1);
    expect(members).toHaveLength(1);
    expect(total(directCounts)).toBeLessThan(total(completeCounts));
    expect(count(directCounts, 'cat-file:batch-check')).toBeLessThan(
      count(completeCounts, 'cat-file:batch-check')
    );
    await direct.cas.close();
    await complete.cas.close();
  });
});

describe('real-Git persistent object session process count', () => {
  it('uses fewer Git child processes through persistent object sessions', async () => {
    const fallback = await countingReader();
    const persistent = await countingReader({ sessions: true });

    try {
      const fallbackResult = await fallback.cas.bundles.getMemberReference({
        handle: outer.handle,
        path: 'nested',
      });
      const persistentResult = await persistent.cas.bundles.getMemberReference({
        handle: outer.handle,
        path: 'nested',
      });
      const fallbackCounts = fallback.snapshot();
      const persistentCounts = persistent.snapshot();

      expect(persistentResult).toEqual(fallbackResult);
      expect(count(persistentCounts, 'session:cat-file')).toBe(1);
      expect(count(persistentCounts, 'ls-tree')).toBe(0);
      expect(total(persistentCounts)).toBeLessThan(total(fallbackCounts));
    } finally {
      await closeAll(fallback.cas, persistent.cas);
    }
  });
});

describe('real-Git scoped bulk write process count', () => {
  it('stores a bounded page batch through one scoped fast-import process', async () => {
    const individual = await countingReader({ sessions: true });
    const batched = await countingReader({ sessions: true });
    const inputs = Array.from({ length: 8 }, (_, index) => Buffer.from(`page-${index}`));
    try {
      const individualPages = [];
      for (const source of inputs) {
        individualPages.push(await individual.cas.pages.put({ source }));
      }
      const batchPages = await batched.cas.pages.putBatch({
        pages: inputs.map((source) => ({ source })),
      });
      const individualCounts = individual.snapshot();
      const batchCounts = batched.snapshot();

      expect(batchPages.map((page) => page.handle.toString())).toEqual(
        individualPages.map((page) => page.handle.toString())
      );
      expect(count(batchCounts, 'session:fast-import')).toBe(1);
      expect(total(batchCounts)).toBeLessThan(total(individualCounts));
    } finally {
      await closeAll(individual.cas, batched.cas);
    }
  });
});

describe('real-Git individual blob rewrite after pruning', () => {
  it('recreates an individually written blob after external pruning', async () => {
    const isolatedRepo = mkdtempSync(path.join(os.tmpdir(), 'cas-pruned-blob-rewrite-'));
    const isolatedGit = (args) => spawnSync('git', args, { cwd: isolatedRepo, encoding: 'utf8' });
    isolatedGit(['init', '--bare']);
    const cas = new ContentAddressableStore({
      plumbing: await createGitPlumbing({ cwd: isolatedRepo }),
    });

    try {
      const source = Buffer.from('rewrite me after prune');
      const first = await cas.pages.put({ source });
      expect(isolatedGit(['cat-file', '-e', first.handle.oid]).status).toBe(0);

      expect(isolatedGit(['prune', '--expire=now']).status).toBe(0);
      expect(isolatedGit(['cat-file', '-e', first.handle.oid]).status).not.toBe(0);

      const second = await cas.pages.put({ source });
      expect(second.handle.oid).toBe(first.handle.oid);
      expect(isolatedGit(['cat-file', '-e', second.handle.oid]).status).toBe(0);
      await expect(cas.pages.get({ handle: second.handle })).resolves.toEqual(
        new Uint8Array(source)
      );
    } finally {
      await cas.close();
      rmSync(isolatedRepo, { recursive: true, force: true });
    }
  });
});
