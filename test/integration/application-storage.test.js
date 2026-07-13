/**
 * Real-Git proof for opaque assets, retention witnesses, and publication.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ContentAddressableStore, { AssetHandle, BundleHandle, PageHandle } from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: npm run test:integration:node'
  );
}

vi.setConfig({ testTimeout: 20_000, hookTimeout: 30_000 });

const ROOT_SET_REF = 'refs/cas/rootsets/integration/application-assets';
const OBSERVED_AT = '2026-07-13T10:00:00.000Z';
const tempDirs = [];
let repoDir;
let cas;

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

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

function git(args, input) {
  return gitAt(repoDir, args, input);
}

function prunableOids() {
  return new Set(
    git(['prune', '-n', '--expire=now'])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ')[0])
  );
}

async function* source(bytes) {
  const window = 333;
  for (let offset = 0; offset < bytes.length; offset += window) {
    yield bytes.subarray(offset, offset + window);
  }
}

async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail');
}

function describeError(error) {
  return JSON.stringify({
    name: error?.name,
    message: error?.message,
    code: error?.code,
    operation: error?.operation,
    details: error?.details,
    ownProperties: error !== null && typeof error === 'object'
      ? Object.getOwnPropertyNames(error)
      : [],
  }, null, 2);
}

async function stage(value, slug) {
  const payload = Buffer.from(value.repeat(1024));
  const staged = await cas.assets.put({
    source: source(payload),
    slug,
    filename: `${slug}.txt`,
  });
  return { payload, staged };
}

beforeAll(async () => {
  repoDir = tempDir('cas-application-storage-');
  git(['init', '--bare']);
  cas = new ContentAddressableStore({
    plumbing: await createGitPlumbing({ cwd: repoDir }),
    chunkSize: 1024,
    applicationRefPrefixes: ['refs/warp/'],
    clock: { now: () => new Date(OBSERVED_AT) },
  });
});

afterAll(() => {
  for (const dir of tempDirs.reverse()) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('application asset retention', () => {
  it('moves staged and replaced assets through real reachability states', async () => {
    const first = await stage('first', 'retained-first');
    expect(await collect(cas.assets.open({ handle: first.staged.handle }))).toEqual(first.payload);
    expect(prunableOids()).toContain(first.staged.handle.oid);

    const retained = await cas.retention.retain({
      handle: first.staged.handle,
      root: { ref: ROOT_SET_REF, name: 'current' },
      policy: 'evictable',
    });
    expect(prunableOids()).not.toContain(first.staged.handle.oid);
    expect(git(['rev-parse', ROOT_SET_REF])).toBe(retained.witness.root.generation);
    expect(
      git(['ls-tree', retained.witness.root.generation, retained.witness.root.path])
    ).toContain(first.staged.handle.oid);

    const second = await stage('second', 'retained-second');
    await cas.retention.retain({
      handle: second.staged.handle,
      root: { ref: ROOT_SET_REF, name: 'current' },
      policy: 'evictable',
    });
    expect(prunableOids()).toContain(first.staged.handle.oid);
    expect(prunableOids()).not.toContain(second.staged.handle.oid);
  });
});

describe('application publication', () => {
  it('atomically publishes ordered causal history and reports conflicts', async () => {
    const first = await stage('publication-one', 'publication-one');
    const initial = await cas.publications.commit({
      root: first.staged.handle,
      commit: { message: 'initial', parents: [] },
      ref: { name: 'refs/warp/events', expected: null },
    });
    expect(git(['rev-parse', 'refs/warp/events'])).toBe(initial.commitId);
    expect(git(['rev-parse', `${initial.commitId}^{tree}`])).toBe(first.staged.handle.oid);

    await expect(
      cas.publications.commit({
        root: first.staged.handle,
        commit: { message: 'invalid tree parent', parents: [first.staged.handle.oid] },
        ref: { name: 'refs/warp/invalid-parent', expected: null },
      })
    ).rejects.toMatchObject({ code: 'PUBLICATION_INVALID' });

    const second = await stage('publication-two', 'publication-two');
    const next = await cas.publications.commit({
      root: second.staged.handle,
      commit: { message: 'next', parents: [initial.commitId] },
      ref: { name: 'refs/warp/events', expected: initial.commitId },
    });
    expect(git(['rev-list', '--parents', '-n', '1', next.commitId]).split(/\s+/u)).toEqual([
      next.commitId,
      initial.commitId,
    ]);

    await expect(
      cas.publications.commit({
        root: first.staged.handle,
        commit: { message: 'stale', parents: [initial.commitId] },
        ref: { name: 'refs/warp/events', expected: initial.commitId },
      })
    ).rejects.toMatchObject({
      code: 'PUBLICATION_CONFLICT',
      meta: { expected: initial.commitId, observed: next.commitId },
    });
    expect(git(['rev-parse', 'refs/warp/events'])).toBe(next.commitId);
  });
});

describe('structured pages and bundles', () => {
  it('deduplicates pages and constructs deterministic targeted bundles', async () => {
    const alpha = Buffer.from('alpha-page'.repeat(256));
    const beta = Buffer.from('beta-page'.repeat(256));
    const firstAlpha = await cas.pages.put({ source: source(alpha) });
    const secondAlpha = await cas.pages.put({ source: source(alpha) });
    const betaPage = await cas.pages.put({ source: source(beta) });

    expect(secondAlpha.handle).toEqual(firstAlpha.handle);
    expect(await collect(cas.pages.open({ handle: firstAlpha.handle }))).toEqual(alpha);

    const first = await cas.bundles.put({
      members: {
        'pages/alpha': firstAlpha.handle,
        'pages/beta': betaPage.handle,
        'state/frontier': Buffer.from('frontier'),
      },
      limits: { maxFanoutEntries: 4 },
    });
    const second = await cas.bundles.put({
      members: new Map([
        ['state/frontier', Buffer.from('frontier')],
        ['pages/beta', betaPage.handle],
        ['pages/alpha', firstAlpha.handle],
      ]),
      limits: { maxFanoutEntries: 4 },
    });

    expect(second.handle).toEqual(first.handle);
    expect(await cas.bundles.getMember({ handle: first.handle, path: 'missing' })).toBeNull();
    expect(
      await cas.bundles.getMember({ handle: first.handle, path: 'pages/beta' })
    ).toMatchObject({ path: 'pages/beta', handle: betaPage.handle, type: 'blob' });
    expect(
      await collect(cas.bundles.openMember({ handle: first.handle, path: 'pages/beta' }))
    ).toEqual(beta);
  });
});

describe('structured retention and publication', () => {
  it('retains bundle graphs and publishes page and bundle roots', async () => {
    const page = await cas.pages.put({ source: source(Buffer.from('retained-page')) });
    const bundle = await cas.bundles.put({ members: { page: page.handle } });
    expect(prunableOids()).toContain(bundle.handle.oid);

    const retained = await cas.retention.retain({
      handle: bundle.handle,
      root: { ref: 'refs/cas/rootsets/integration/application-bundles', name: 'current' },
      policy: 'evictable',
    });
    expect(retained.witness.handle).toBeInstanceOf(BundleHandle);
    expect(prunableOids()).not.toContain(bundle.handle.oid);
    expect(prunableOids()).not.toContain(page.handle.oid);

    const bundlePublication = await cas.publications.commit({
      root: bundle.handle,
      commit: { message: 'bundle root', parents: [] },
      ref: { name: 'refs/warp/bundles', expected: null },
    });
    expect(git(['rev-parse', `${bundlePublication.commitId}^{tree}`])).toBe(bundle.handle.oid);

    const pagePublication = await cas.publications.commit({
      root: page.handle,
      commit: { message: 'page root', parents: [] },
      ref: { name: 'refs/warp/pages', expected: null },
    });
    const publicationTree = git(['rev-parse', `${pagePublication.commitId}^{tree}`]);
    expect(publicationTree).not.toBe(page.handle.oid);
    expect(git(['ls-tree', publicationTree, 'page'])).toContain(page.handle.oid);
    expect(pagePublication.root).toBeInstanceOf(PageHandle);
  });
});

describe('structured validation work', () => {
  it('validates a repeated member handle once per operation', async () => {
    const page = await cas.pages.put({ source: source(Buffer.from('shared-page')) });
    const readObjectSize = vi.spyOn(cas.service.persistence, 'readObjectSize');
    const bundle = await cas.bundles.put({
      members: { first: page.handle, second: page.handle, third: page.handle },
    });
    expect(readObjectSize).toHaveBeenCalledTimes(1);

    readObjectSize.mockClear();
    await cas.retention.retain({
      handle: bundle.handle,
      root: { ref: 'refs/cas/rootsets/integration/shared-page', name: 'current' },
    });
    expect(readObjectSize).toHaveBeenCalledTimes(1);
    readObjectSize.mockRestore();
  });
});

describe('structured handle transfer', () => {
  it('transfers structured handles and reports an absent target graph', async () => {
    const payload = Buffer.from('portable-page');
    const page = await cas.pages.put({ source: source(payload) });
    const bundle = await cas.bundles.put({ members: { payload: page.handle } });
    await cas.publications.commit({
      root: bundle.handle,
      commit: { message: 'portable bundle', parents: [] },
      ref: { name: 'refs/warp/portable-bundle', expected: null },
    });

    const mirrorDir = tempDir('cas-structured-mirror-');
    gitAt(path.dirname(mirrorDir), ['clone', '--mirror', repoDir, mirrorDir]);
    const mirror = new ContentAddressableStore({
      plumbing: await createGitPlumbing({ cwd: mirrorDir }),
    });
    const transferred = BundleHandle.from(bundle.handle.toString());
    expect(
      await collect(mirror.bundles.openMember({ handle: transferred, path: 'payload' }))
    ).toEqual(payload);

    const emptyDir = tempDir('cas-structured-empty-');
    gitAt(emptyDir, ['init', '--bare']);
    const empty = new ContentAddressableStore({
      plumbing: await createGitPlumbing({ cwd: emptyDir }),
    });
    await expect(
      empty.bundles.getMember({ handle: transferred, path: 'payload' })
    ).rejects.toMatchObject({ code: 'HANDLE_TARGET_MISSING' });
  });
});

describe('asset handle transfer', () => {
  it('opens the same token after a mirror and fails explicitly without its graph', async () => {
    const { payload, staged } = await stage('portable', 'portable');
    await cas.publications.commit({
      root: staged.handle,
      commit: { message: 'portable root', parents: [] },
      ref: { name: 'refs/warp/portable', expected: null },
    });

    const mirrorDir = tempDir('cas-application-mirror-');
    gitAt(path.dirname(mirrorDir), ['clone', '--mirror', repoDir, mirrorDir]);
    const mirror = new ContentAddressableStore({
      plumbing: await createGitPlumbing({ cwd: mirrorDir }),
    });
    const transferred = AssetHandle.from(staged.handle.toString());
    expect(await collect(mirror.assets.open({ handle: transferred }))).toEqual(payload);

    const emptyDir = tempDir('cas-application-empty-');
    gitAt(emptyDir, ['init', '--bare']);
    const empty = new ContentAddressableStore({
      plumbing: await createGitPlumbing({ cwd: emptyDir }),
    });
    const missingError = await captureError(collect(empty.assets.open({ handle: transferred })));
    expect(missingError, describeError(missingError)).toMatchObject({
      code: 'HANDLE_TARGET_MISSING',
    });
  });
});
