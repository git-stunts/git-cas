import { describe, expect, it, vi } from 'vitest';
import PageService from '../../../../src/domain/services/PageService.js';
import StagingWorkspaceRegistry from '../../../../src/domain/services/StagingWorkspaceRegistry.js';
import RetentionWitness from '../../../../src/domain/value-objects/RetentionWitness.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import MemoryRefAdapter from '../../../helpers/MemoryRefAdapter.js';

const NOW = '2026-07-17T20:00:00.000Z';
const CACHE_REF = 'refs/cas/caches/git-warp/materializations';
const PUBLICATION_REF = 'refs/warp/materializations/main';

function destinationWitness({ staged, kind, ref, generation, policy = 'evictable' }) {
  return new RetentionWitness({
    handle: staged.handle,
    policy,
    reachability: 'anchored',
    root: { kind, namespace: 'git-warp/materializations', ref, generation, path: '/' },
    observedAt: NOW,
  });
}

function cacheDestination(staged, overrides = {}) {
  const generation = 'd'.repeat(40);
  return {
    changed: true,
    accepted: true,
    hit: null,
    previous: null,
    generation,
    policy: null,
    witness: destinationWitness({
      staged,
      kind: 'cache-set',
      ref: CACHE_REF,
      generation,
    }),
    ...overrides,
  };
}

function publicationDestination(staged) {
  const commitId = 'e'.repeat(40);
  return {
    operation: 'publication',
    commitId,
    ref: PUBLICATION_REF,
    root: staged.handle,
    witness: destinationWitness({
      staged,
      kind: 'publication',
      ref: PUBLICATION_REF,
      generation: commitId,
      policy: 'pinned',
    }),
  };
}

function makeFixture() {
  const persistence = new MemoryPersistenceAdapter();
  const ref = new MemoryRefAdapter();
  const clock = { now: () => new Date(NOW) };
  const pages = new PageService({ persistence, clock });
  const publications = { commit: vi.fn() };
  const registry = new StagingWorkspaceRegistry({
    persistence,
    ref,
    pages,
    assets: { put: vi.fn(), adopt: vi.fn() },
    bundles: { put: vi.fn(), putOrdered: vi.fn() },
    publications,
    resolveHandle: (handle) => pages.resolveRoot(handle),
    crypto: { randomBytes: (length) => new Uint8Array(length) },
    clock,
  });
  return { persistence, ref, registry, publications };
}

async function openWithPage(fixture) {
  const workspace = await fixture.registry.open({
    namespace: 'git-warp/materializations',
    ttlMs: 60_000,
  });
  const staged = await workspace.pages.put({ source: Buffer.from('promoted') });
  return { workspace, staged };
}

describe('StagingWorkspace cache promotion ordering', () => {
  it('establishes cache retention before releasing the temporary generation', async () => {
    const fixture = makeFixture();
    const { workspace, staged } = await openWithPage(fixture);
    const destination = cacheDestination(staged);
    const cache = {
      ref: CACHE_REF,
      put: vi.fn(async () => {
        await expect(fixture.ref.resolveRef(staged.witness.root.ref)).resolves.toBe(
          staged.witness.root.generation,
        );
        return destination;
      }),
    };

    const result = await workspace.promoteToCache({
      cache,
      key: 'materialization-key',
      handle: staged.handle,
      options: { retention: 'evictable' },
    });

    expect(cache.put).toHaveBeenCalledWith(
      'materialization-key',
      staged.handle,
      { retention: 'evictable' },
    );
    expect(result).toEqual({ destination, release: expect.objectContaining({ changed: true }) });
    await expect(fixture.ref.resolveRef(staged.witness.root.ref)).rejects.toMatchObject({
      code: 'GIT_REF_NOT_FOUND',
    });
  });

  it('leaves workspace reachability intact when destination retention fails', async () => {
    const fixture = makeFixture();
    const { workspace, staged } = await openWithPage(fixture);
    const cache = {
      ref: CACHE_REF,
      put: vi.fn().mockRejectedValue(new Error('destination failed')),
    };

    await expect(workspace.promoteToCache({
      cache,
      key: 'materialization-key',
      handle: staged.handle,
    })).rejects.toThrow('destination failed');
    await expect(fixture.ref.resolveRef(staged.witness.root.ref)).resolves.toBeTruthy();
  });
});

describe('StagingWorkspace cache promotion evidence', () => {
  it.each([
    ['rejects the write', (staged) => cacheDestination(staged, { accepted: false })],
    ['omits its witness', (staged) => cacheDestination(staged, { witness: null })],
  ])('keeps workspace reachability when the destination %s', async (_label, resultFor) => {
    const fixture = makeFixture();
    const { workspace, staged } = await openWithPage(fixture);
    const cache = { ref: CACHE_REF, put: vi.fn().mockResolvedValue(resultFor(staged)) };

    await expect(workspace.promoteToCache({
      cache,
      key: 'materialization-key',
      handle: staged.handle,
    })).rejects.toMatchObject({ code: 'WORKSPACE_PROMOTION_NOT_RETAINED' });
    await expect(fixture.ref.resolveRef(staged.witness.root.ref)).resolves.toBeTruthy();
  });
});

describe('StagingWorkspace cache promotion cleanup', () => {
  it('reports cleanup debt without rolling back a successful destination', async () => {
    const fixture = makeFixture();
    const { workspace, staged } = await openWithPage(fixture);
    const destination = cacheDestination(staged);
    let replacement;
    const cache = {
      ref: CACHE_REF,
      put: vi.fn(async () => {
        const current = await fixture.ref.resolveRef(staged.witness.root.ref);
        const treeOid = await fixture.ref.resolveTree(current);
        replacement = await fixture.ref.createCommit({
          treeOid,
          parentOid: null,
          message: 'workspace: raced promotion cleanup',
        });
        await fixture.ref.updateRef({
          ref: staged.witness.root.ref,
          newOid: replacement,
          expectedOldOid: current,
        });
        return destination;
      }),
    };

    await expect(workspace.promoteToCache({
      cache,
      key: 'materialization-key',
      handle: staged.handle,
    })).rejects.toMatchObject({
      code: 'WORKSPACE_PROMOTION_CLEANUP_PENDING',
      meta: { destination },
    });
    await expect(fixture.ref.resolveRef(staged.witness.root.ref)).resolves.toBe(replacement);
  });
});

describe('StagingWorkspace publication promotion', () => {
  it('publishes before releasing and rejects handles outside the workspace', async () => {
    const fixture = makeFixture();
    const { workspace, staged } = await openWithPage(fixture);
    const destination = publicationDestination(staged);
    fixture.publications.commit.mockResolvedValue(destination);

    const result = await workspace.promoteToPublication({
      handle: staged.handle,
      commit: { message: 'publish materialization' },
      ref: { name: PUBLICATION_REF, expected: null },
    });

    expect(fixture.publications.commit).toHaveBeenCalledWith({
      root: staged.handle,
      commit: { message: 'publish materialization' },
      ref: { name: PUBLICATION_REF, expected: null },
    });
    expect(result.destination).toBe(destination);
    await expect(workspace.promoteToPublication({
      handle: staged.handle,
      commit: { message: 'again' },
      ref: { name: PUBLICATION_REF, expected: 'commit' },
    })).rejects.toMatchObject({ code: 'WORKSPACE_RELEASED' });
  });
});
