import { describe, expect, it, vi } from 'vitest';
import PublicationService from '../../../../src/domain/services/PublicationService.js';
import AssetHandle from '../../../../src/domain/value-objects/AssetHandle.js';
import RetentionWitness from '../../../../src/domain/value-objects/RetentionWitness.js';
import MemoryPersistenceAdapter from '../../../helpers/MemoryPersistenceAdapter.js';
import MemoryRefAdapter from '../../../helpers/MemoryRefAdapter.js';

const OBSERVED_AT = '2026-07-13T10:00:00.000Z';

function makeService({ applicationRefPrefixes = ['refs/warp/'] } = {}) {
  const persistence = new MemoryPersistenceAdapter();
  const ref = new MemoryRefAdapter();
  const resolveRoot = async (value) => {
    const handle = AssetHandle.from(value);
    const type = await persistence.readObjectType(handle.oid);
    return Object.freeze({ handle, oid: handle.oid, type });
  };
  const publications = new PublicationService({
    ref,
    resolveRoot,
    applicationRefPrefixes,
    clock: { now: () => new Date(OBSERVED_AT) },
  });
  return { persistence, publications, ref };
}

async function makeHandle(persistence, value) {
  const blobOid = await persistence.writeBlob(Buffer.from(value));
  const treeOid = await persistence.writeTree([`100644 blob ${blobOid}\tpayload`]);
  return new AssetHandle({ codec: 'json', oid: treeOid });
}

async function publish(publications, root, overrides = {}) {
  return await publications.commit({
    root,
    commit: {
      message: overrides.message ?? 'publish asset',
      parents: overrides.parents ?? [],
    },
    ref: {
      name: overrides.name ?? 'refs/warp/events',
      expected: Object.hasOwn(overrides, 'expected') ? overrides.expected : null,
    },
  });
}

describe('PublicationService publication evidence', () => {
  it('publishes a validated root with an immutable witness', async () => {
    const { persistence, publications, ref } = makeService();
    const handle = await makeHandle(persistence, 'first');

    const result = await publish(publications, handle);

    expect(await ref.resolveRef('refs/warp/events')).toBe(result.commitId);
    expect(await ref.resolveTree(result.commitId)).toBe(handle.oid);
    expect(result.root).toBe(handle);
    expect(result.witness).toBeInstanceOf(RetentionWitness);
    expect(result.witness).toMatchObject({
      handle,
      policy: 'pinned',
      reachability: 'anchored',
      root: {
        kind: 'publication',
        namespace: 'refs/warp/',
        ref: 'refs/warp/events',
        generation: result.commitId,
        path: '/',
      },
      observedAt: OBSERVED_AT,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('records the most specific configured namespace in the witness', async () => {
    const persistence = new MemoryPersistenceAdapter();
    const ref = new MemoryRefAdapter();
    const publications = new PublicationService({
      ref,
      resolveRoot: async (value) => {
        const handle = AssetHandle.from(value);
        return Object.freeze({
          handle,
          oid: handle.oid,
          type: await persistence.readObjectType(handle.oid),
        });
      },
      applicationRefPrefixes: ['refs/warp/', 'refs/warp/cache/'],
      clock: { now: () => new Date(OBSERVED_AT) },
    });
    const result = await publish(publications, await makeHandle(persistence, 'specific'), {
      name: 'refs/warp/cache/events',
    });

    expect(result.witness.root.namespace).toBe('refs/warp/cache/');
  });
});

describe('PublicationService causal parents', () => {
  it('preserves caller-controlled ordered parents', async () => {
    const { persistence, publications, ref } = makeService();
    const left = await publish(publications, await makeHandle(persistence, 'left'), {
      name: 'refs/warp/left',
    });
    const right = await publish(publications, await makeHandle(persistence, 'right'), {
      name: 'refs/warp/right',
    });
    const joined = await publish(publications, await makeHandle(persistence, 'joined'), {
      name: 'refs/warp/main',
      parents: [right.commitId, left.commitId],
    });

    expect(await ref.resolveParents(joined.commitId)).toEqual([right.commitId, left.commitId]);
  });
});

describe('PublicationService failures', () => {
  it('returns expected and observed heads for a compare-and-swap conflict', async () => {
    const { persistence, publications } = makeService();
    const first = await publish(publications, await makeHandle(persistence, 'first'));
    const replacement = await makeHandle(persistence, 'replacement');

    await expect(publish(publications, replacement, { expected: null })).rejects.toMatchObject({
      code: 'PUBLICATION_CONFLICT',
      meta: {
        ref: 'refs/warp/events',
        expected: null,
        observed: first.commitId,
      },
    });
  });

  it('rejects refs outside explicitly configured application namespaces', async () => {
    const { persistence, publications } = makeService();
    const handle = await makeHandle(persistence, 'forbidden');

    await expect(publish(publications, handle, { name: 'refs/heads/main' })).rejects.toMatchObject({
      code: 'PUBLICATION_REF_FORBIDDEN',
    });
    await expect(
      publish(publications, handle, { name: 'refs/cas/rootsets/internal' })
    ).rejects.toMatchObject({ code: 'PUBLICATION_REF_FORBIDDEN' });
  });
});

describe('PublicationService reserved ref boundaries', () => {
  it.each([
    'refs/bisect/session',
    'refs/cas/rootsets/internal',
    'refs/heads/main',
    'refs/notes/commits',
    'refs/remotes/origin/main',
    `refs/replace/${'a'.repeat(40)}`,
    'refs/rewritten/main',
    'refs/stash',
    'refs/tags/v1.0.0',
    'refs/worktree/main',
  ])('hard-blocks reserved Git ref %s under a broad allowlist', async (name) => {
    const { persistence, publications } = makeService({
      applicationRefPrefixes: ['refs/'],
    });
    const handle = await makeHandle(persistence, 'reserved');

    await expect(publish(publications, handle, { name })).rejects.toMatchObject({
      code: 'PUBLICATION_REF_FORBIDDEN',
    });
  });

  it.each([
    'refs/bisect/',
    'refs/cas/',
    'refs/heads/',
    'refs/notes/',
    'refs/remotes/',
    'refs/replace/',
    'refs/rewritten/',
    'refs/stash/',
    'refs/tags/',
    'refs/worktree/',
  ])('rejects reserved namespace configuration %s', (prefix) => {
    expect(() => makeService({ applicationRefPrefixes: [prefix] })).toThrow(
      expect.objectContaining({ code: 'PUBLICATION_INVALID' })
    );
  });
});

describe('PublicationService failures requiring explicit expectations', () => {
  it('requires an explicit expected head', async () => {
    const { persistence, publications } = makeService();
    const handle = await makeHandle(persistence, 'expected');

    await expect(
      publications.commit({
        root: handle,
        commit: { message: 'missing expectation', parents: [] },
        ref: { name: 'refs/warp/events' },
      })
    ).rejects.toMatchObject({ code: 'PUBLICATION_INVALID' });
  });
});

describe('PublicationService ref failure normalization', () => {
  it('normalizes a ref failure even when the current head cannot be observed', async () => {
    const { persistence, publications, ref } = makeService();
    const handle = await makeHandle(persistence, 'unobservable');
    const writeError = new Error('ref write failed');
    const observationError = new Error('ref read failed');
    vi.spyOn(ref, 'updateRef').mockRejectedValueOnce(writeError);
    vi.spyOn(ref, 'resolveRef').mockRejectedValueOnce(observationError);

    await expect(publish(publications, handle)).rejects.toMatchObject({
      code: 'PUBLICATION_REF_UPDATE_FAILED',
      meta: { originalError: writeError, observationError },
    });
  });
});
