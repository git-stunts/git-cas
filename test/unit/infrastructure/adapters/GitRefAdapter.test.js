import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../../src/domain/errors/index.js';
import GitRefAdapter from '../../../../src/infrastructure/adapters/GitRefAdapter.js';

const noPolicy = { execute: (fn) => fn() };
const ZERO_OID = '0'.repeat(40);

function createAdapter() {
  const plumbing = {
    execute: vi.fn().mockResolvedValue(''),
  };
  return {
    adapter: new GitRefAdapter({ plumbing, policy: noPolicy }),
    plumbing,
  };
}

describe('GitRefAdapter.resolveRef()', () => {
  it('normalizes Git missing-ref stderr into a structured ref-not-found error', async () => {
    const { adapter, plumbing } = createAdapter();
    const rootCause = Object.assign(new Error('Git command failed with code 128'), {
      details: {
        stderr: "fatal: ambiguous argument 'refs/cas/vault': unknown revision",
      },
    });
    plumbing.execute.mockRejectedValueOnce(rootCause);

    await expect(adapter.resolveRef('refs/cas/vault')).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_NOT_FOUND,
      meta: {
        ref: 'refs/cas/vault',
        originalError: rootCause,
      },
    });
  });

  it('normalizes stdout-only rev-parse misses into a structured ref-not-found error', async () => {
    const { adapter, plumbing } = createAdapter();
    const rootCause = Object.assign(new Error('Git command failed with code 128'), {
      details: {
        args: ['rev-parse', 'refs/cas/vault'],
        code: 128,
        stdout: 'refs/cas/vault\n',
        stderr: '',
      },
    });
    plumbing.execute.mockRejectedValueOnce(rootCause);

    await expect(adapter.resolveRef('refs/cas/vault')).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_NOT_FOUND,
      meta: {
        ref: 'refs/cas/vault',
        originalError: rootCause,
      },
    });
  });
});

describe('GitRefAdapter.resolveParents()', () => {
  it('returns direct commit parents and recognizes a parentless commit', async () => {
    const { adapter, plumbing } = createAdapter();
    const commitOid = 'a'.repeat(40);
    const firstParent = 'b'.repeat(40);
    const secondParent = 'c'.repeat(40);
    plumbing.execute
      .mockResolvedValueOnce(`${commitOid} ${firstParent} ${secondParent}`)
      .mockResolvedValueOnce(commitOid);

    await expect(adapter.resolveParents(commitOid)).resolves.toEqual([
      firstParent,
      secondParent,
    ]);
    await expect(adapter.resolveParents(commitOid)).resolves.toEqual([]);
    expect(plumbing.execute).toHaveBeenNthCalledWith(1, {
      args: ['rev-list', '--parents', '-n', '1', commitOid],
    });
  });
});

describe('GitRefAdapter.updateRef()', () => {
  it('uses Git create-only CAS semantics when expectedOldOid is null', async () => {
    const { adapter, plumbing } = createAdapter();

    await adapter.updateRef({
      ref: 'refs/cas/vault',
      newOid: 'a'.repeat(40),
      expectedOldOid: null,
    });

    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['update-ref', 'refs/cas/vault', 'a'.repeat(40), ZERO_OID],
    });
  });

  it('uses the repository hash width for SHA-256 create-only updates', async () => {
    const { adapter, plumbing } = createAdapter();

    await adapter.updateRef({
      ref: 'refs/cas/vault',
      newOid: 'a'.repeat(64),
      expectedOldOid: null,
    });

    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['update-ref', 'refs/cas/vault', 'a'.repeat(64), '0'.repeat(64)],
    });
  });

  it('omits the expected old OID only when the caller explicitly leaves it undefined', async () => {
    const { adapter, plumbing } = createAdapter();

    await adapter.updateRef({
      ref: 'refs/cas/vault',
      newOid: 'b'.repeat(40),
    });

    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['update-ref', 'refs/cas/vault', 'b'.repeat(40)],
    });
  });
});

describe('GitRefAdapter scoped anchors', () => {
  it('atomically verifies the source generation while creating an anchor', async () => {
    const { adapter, plumbing } = createAdapter();
    const generation = 'a'.repeat(40);
    const sourceRef = 'refs/cas/caches/git-warp/materializations';
    const targetRef = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';

    await adapter.anchorRef({ sourceRef, expectedSourceOid: generation, targetRef });

    expect(plumbing.execute).toHaveBeenNthCalledWith(1, {
      args: ['symbolic-ref', '--quiet', sourceRef],
    });
    expect(plumbing.execute).toHaveBeenNthCalledWith(2, {
      args: ['symbolic-ref', '--quiet', targetRef],
    });
    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['update-ref', '--no-deref', '--stdin'],
      input: [
        'start',
        `verify ${sourceRef} ${generation}`,
        `create ${targetRef} ${generation}`,
        'prepare',
        'commit',
        '',
      ].join('\n'),
    });
  });

  it('deletes only the expected anchored generation', async () => {
    const { adapter, plumbing } = createAdapter();
    const generation = 'b'.repeat(40);
    const ref = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    plumbing.execute.mockResolvedValueOnce('').mockResolvedValueOnce('');

    await adapter.deleteRef({ ref, expectedOldOid: generation });

    expect(plumbing.execute).toHaveBeenNthCalledWith(2, {
      args: ['update-ref', '--no-deref', '-d', ref, generation],
    });
    expect(plumbing.execute).toHaveBeenCalledTimes(2);
  });

});

describe('GitRefAdapter scoped-anchor validation', () => {
  it('rejects malformed transaction refs and generations before invoking Git', async () => {
    const { adapter, plumbing } = createAdapter();
    const sourceRef = 'refs/cas/caches/git-warp/materializations';

    await expect(adapter.anchorRef({
      sourceRef,
      expectedSourceOid: 'a'.repeat(40),
      targetRef: 'refs/cas/cache-acquisitions/safe\ncreate refs/heads/injected',
    })).rejects.toMatchObject({ code: ErrorCodes.GIT_ERROR });
    await expect(adapter.anchorRef({
      sourceRef,
      expectedSourceOid: 'not-an-oid',
      targetRef: 'refs/cas/cache-acquisitions/safe/acquisition',
    })).rejects.toMatchObject({ code: ErrorCodes.INVALID_OID });
    expect(plumbing.execute).not.toHaveBeenCalled();
  });
});

describe('GitRefAdapter scoped-anchor conflicts', () => {
  it('refuses to anchor through a symbolic source ref', async () => {
    const { adapter, plumbing } = createAdapter();
    const sourceRef = 'refs/cas/caches/git-warp/materializations';
    const targetRef = 'refs/cas/cache-acquisitions/git-warp%2Fmaterializations/acquisition';
    plumbing.execute.mockResolvedValueOnce('refs/heads/main');

    await expect(adapter.anchorRef({
      sourceRef,
      expectedSourceOid: 'a'.repeat(40),
      targetRef,
    })).resolves.toBe(false);
    expect(plumbing.execute).toHaveBeenCalledTimes(1);
  });

  it('reports a generation race without hiding unrelated Git failures', async () => {
    const { adapter, plumbing } = createAdapter();
    const sourceRef = 'refs/cas/caches/git-warp/materializations';
    const targetRef = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    const generation = 'a'.repeat(40);
    plumbing.execute
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(Object.assign(new Error('transaction failed'), {
        details: { stderr: `fatal: prepare: cannot lock ref '${sourceRef}': is at b but expected a` },
      }));

    await expect(adapter.anchorRef({ sourceRef, expectedSourceOid: generation, targetRef }))
      .resolves.toBe(false);

    const failure = new Error('permission denied');
    plumbing.execute
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(failure);
    await expect(adapter.anchorRef({ sourceRef, expectedSourceOid: generation, targetRef }))
      .rejects.toBe(failure);
  });
});

describe('GitRefAdapter checked-delete conflicts', () => {
  it('normalizes a concurrent checked-delete disappearance as an idempotent miss', async () => {
    const { adapter, plumbing } = createAdapter();
    const ref = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    const generation = 'a'.repeat(40);
    const rootCause = Object.assign(new Error('delete failed'), {
      details: { stderr: `error: cannot lock ref '${ref}': unable to resolve reference '${ref}'` },
    });
    plumbing.execute
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(rootCause)
      .mockResolvedValueOnce('');

    await expect(adapter.deleteRef({ ref, expectedOldOid: generation })).resolves.toBe(false);
    expect(plumbing.execute).toHaveBeenNthCalledWith(3, {
      args: [
        'for-each-ref',
        '--format=%(refname)%09%(objectname)%09%(symref)',
        '--count=1',
        ref,
      ],
    });
  });

  it('fails closed when the checked ref becomes a symbolic ref', async () => {
    const { adapter, plumbing } = createAdapter();
    const ref = 'refs/cas/cache-acquisitions/git-warp%2Fmaterializations/acquisition';
    const generation = 'a'.repeat(40);
    plumbing.execute.mockResolvedValueOnce('refs/heads/main');

    await expect(adapter.deleteRef({ ref, expectedOldOid: generation })).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_CONFLICT,
      meta: {
        ref,
        expectedOldOid: generation,
        actualOldOid: null,
        actualSymref: 'refs/heads/main',
      },
    });
    expect(plumbing.execute).toHaveBeenCalledTimes(1);
  });
});
