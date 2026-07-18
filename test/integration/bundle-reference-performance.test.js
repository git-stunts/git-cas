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

function operationOf(args) {
  if (args[0] === 'cat-file' && args.some((arg) => arg.startsWith('--batch-check='))) {
    return 'cat-file:batch-check';
  }
  return args[0];
}

async function countingReader() {
  const plumbing = await createGitPlumbing({ cwd: repoDir });
  const counts = new Map();
  const record = (options) => {
    const operation = operationOf(options.args);
    counts.set(operation, (counts.get(operation) ?? 0) + 1);
  };
  const counted = {
    execute(options) {
      record(options);
      return plumbing.execute(options);
    },
    executeStream(options) {
      record(options);
      return plumbing.executeStream(options);
    },
  };
  return {
    cas: new ContentAddressableStore({ plumbing: counted }),
    snapshot() {
      return new Map(counts);
    },
  };
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

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('real-Git immutable page payload reads', () => {
  it('performs zero additional Git commands for an identical warm page read', async () => {
    const reader = await countingReader();
    const page = await writer.pages.put({ source: Buffer.from('warm page payload') });

    await expect(reader.cas.pages.get({ handle: page.handle })).resolves.toEqual(
      new Uint8Array(Buffer.from('warm page payload')),
    );
    const cold = reader.snapshot();
    await reader.cas.pages.get({ handle: page.handle });
    const warm = delta(reader.snapshot(), cold);

    expect(count(cold, 'cat-file')).toBeGreaterThan(0);
    expect(total(warm)).toBe(0);
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
  });
});
