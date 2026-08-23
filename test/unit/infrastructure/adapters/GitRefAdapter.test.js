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

function createFailedMutationAdapter({ mutationError, postures }) {
  let mutationAttempted = false;
  const plumbing = {
    execute: vi.fn().mockImplementation(({ args }) => {
      if (args[0] === 'update-ref') {
        mutationAttempted = true;
        return Promise.reject(mutationError);
      }
      const ref = args.at(-1);
      const posture = mutationAttempted ? postures[ref] : null;
      if (args[0] === 'symbolic-ref') {
        return Promise.resolve(posture?.symref ?? '');
      }
      if (args[0] === 'for-each-ref') {
        return Promise.resolve(posture?.oid
          ? `${ref}\t${posture.oid}\t${posture.symref ?? ''}`
          : '');
      }
      return Promise.resolve('');
    }),
  };
  return {
    adapter: new GitRefAdapter({ plumbing, policy: noPolicy }),
    plumbing,
  };
}

function createSessionAdapter({ sessions, execute = vi.fn().mockResolvedValue('') }) {
  const plumbing = {
    execute,
    openUpdateRefSession: vi.fn(),
  };
  for (const session of sessions) {
    plumbing.openUpdateRefSession.mockResolvedValueOnce(session);
  }
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

describe('GitRefAdapter.createCommit()', () => {
  it('supplies internal identity instead of depending on ambient Git config', async () => {
    const { adapter, plumbing } = createAdapter();
    const treeOid = 'a'.repeat(40);
    plumbing.execute.mockResolvedValueOnce('b'.repeat(40));

    await adapter.createCommit({
      treeOid,
      parentOid: null,
      message: 'root-set: replace current roots',
    });

    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['commit-tree', treeOid, '-m', 'root-set: replace current roots'],
      env: {
        GIT_AUTHOR_EMAIL: 'git-cas@example.invalid',
        GIT_AUTHOR_NAME: 'git-cas',
        GIT_COMMITTER_EMAIL: 'git-cas@example.invalid',
        GIT_COMMITTER_NAME: 'git-cas',
      },
    });
  });
});

describe('GitRefAdapter typed update-ref reuse', () => {
  it('uses one process across successful checked updates and closes it once', async () => {
    const session = {
      update: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const { adapter, plumbing } = createSessionAdapter({ sessions: [session] });

    await adapter.updateRef({
      ref: 'refs/cas/rootsets/one',
      newOid: 'a'.repeat(40),
      expectedOldOid: null,
    });
    await adapter.updateRef({
      ref: 'refs/cas/rootsets/two',
      newOid: 'b'.repeat(40),
      expectedOldOid: 'c'.repeat(40),
    });

    expect(plumbing.openUpdateRefSession).toHaveBeenCalledOnce();
    expect(session.update).toHaveBeenNthCalledWith(1, {
      ref: 'refs/cas/rootsets/one',
      newOid: 'a'.repeat(40),
      expectedOldOid: null,
      noDeref: true,
    });
    expect(session.update).toHaveBeenNthCalledWith(2, {
      ref: 'refs/cas/rootsets/two',
      newOid: 'b'.repeat(40),
      expectedOldOid: 'c'.repeat(40),
      noDeref: true,
    });
    expect(plumbing.execute).toHaveBeenCalledTimes(2);
    await Promise.all([adapter.close(), adapter.close(), adapter[Symbol.asyncDispose]()]);
    expect(session.close).toHaveBeenCalledOnce();
    await expect(adapter.resolveRef('refs/cas/rootsets/one')).rejects.toMatchObject({
      code: ErrorCodes.RESOURCE_CLOSED,
    });
  });
});

describe('GitRefAdapter typed update-ref failure', () => {
  it('discards the failed process without replaying its transaction', async () => {
    const ref = 'refs/cas/rootsets/one';
    const expectedOldOid = 'a'.repeat(40);
    const rootCause = new Error('update failed');
    let mutationFailed = false;
    const failed = {
      update: vi.fn(async () => {
        mutationFailed = true;
        throw rootCause;
      }),
      close: vi.fn(),
    };
    const replacement = {
      update: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const execute = vi.fn().mockImplementation(({ args }) => {
      if (args[0] === 'for-each-ref' && mutationFailed) {
        return Promise.resolve(`${ref}\t${expectedOldOid}\t`);
      }
      return Promise.resolve('');
    });
    const { adapter, plumbing } = createSessionAdapter({
      sessions: [failed, replacement],
      execute,
    });

    await expect(adapter.updateRef({ ref, newOid: 'b'.repeat(40), expectedOldOid }))
      .rejects.toBe(rootCause);
    expect(failed.update).toHaveBeenCalledOnce();
    expect(replacement.update).not.toHaveBeenCalled();
    await adapter.updateRef({ ref, newOid: 'c'.repeat(40), expectedOldOid });
    expect(plumbing.openUpdateRefSession).toHaveBeenCalledTimes(2);
    expect(replacement.update).toHaveBeenCalledOnce();
    await adapter.close();
  });
});

// eslint-disable-next-line max-lines-per-function
describe('GitRefAdapter.updateRef()', () => {
  it('uses Git create-only CAS semantics when expectedOldOid is null', async () => {
    const { adapter, plumbing } = createAdapter();

    await adapter.updateRef({
      ref: 'refs/cas/vault',
      newOid: 'a'.repeat(40),
      expectedOldOid: null,
    });

    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['update-ref', '--no-deref', 'refs/cas/vault', 'a'.repeat(40), ZERO_OID],
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
      args: ['update-ref', '--no-deref', 'refs/cas/vault', 'a'.repeat(64), '0'.repeat(64)],
    });
  });

  it('omits the expected old OID only when the caller explicitly leaves it undefined', async () => {
    const { adapter, plumbing } = createAdapter();

    await adapter.updateRef({
      ref: 'refs/cas/vault',
      newOid: 'b'.repeat(40),
    });

    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['update-ref', '--no-deref', 'refs/cas/vault', 'b'.repeat(40)],
    });
  });

  it('fails closed instead of following an observed symbolic ref', async () => {
    const { adapter, plumbing } = createAdapter();
    plumbing.execute.mockResolvedValueOnce('refs/heads/main');

    await expect(adapter.updateRef({
      ref: 'refs/cas/vault',
      newOid: 'b'.repeat(40),
      expectedOldOid: 'a'.repeat(40),
    })).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_CONFLICT,
      meta: {
        ref: 'refs/cas/vault',
        expectedOldOid: 'a'.repeat(40),
        actualOldOid: null,
        actualSymref: 'refs/heads/main',
      },
    });
    expect(plumbing.execute).toHaveBeenCalledTimes(1);
  });

  it('normalizes a diagnostic-free checked update from observed OID posture', async () => {
    const ref = 'refs/cas/vault';
    const expectedOldOid = 'a'.repeat(40);
    const actualOldOid = 'b'.repeat(40);
    const rootCause = new Error('update failed');
    const { adapter } = createFailedMutationAdapter({
      mutationError: rootCause,
      postures: { [ref]: { oid: actualOldOid, symref: null } },
    });

    await expect(adapter.updateRef({
      ref,
      newOid: 'c'.repeat(40),
      expectedOldOid,
    })).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_CONFLICT,
      meta: {
        ref,
        expectedOldOid,
        actualOldOid,
        actualSymref: null,
        originalError: rootCause,
      },
    });
  });

  it('normalizes a diagnostic-free create-only update when the target appeared', async () => {
    const ref = 'refs/cas/vault';
    const actualOldOid = 'b'.repeat(40);
    const rootCause = new Error('update failed');
    const { adapter } = createFailedMutationAdapter({
      mutationError: rootCause,
      postures: { [ref]: { oid: actualOldOid, symref: null } },
    });

    await expect(adapter.updateRef({
      ref,
      newOid: 'c'.repeat(40),
      expectedOldOid: null,
    })).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_CONFLICT,
      meta: {
        ref,
        expectedOldOid: null,
        actualOldOid,
        actualSymref: null,
        originalError: rootCause,
      },
    });
  });

  it('preserves a failed checked update when observed posture still satisfies it', async () => {
    const ref = 'refs/cas/vault';
    const expectedOldOid = 'a'.repeat(40);
    const rootCause = new Error('permission denied');
    const { adapter } = createFailedMutationAdapter({
      mutationError: rootCause,
      postures: { [ref]: { oid: expectedOldOid, symref: null } },
    });

    await expect(adapter.updateRef({
      ref,
      newOid: 'b'.repeat(40),
      expectedOldOid,
    })).rejects.toBe(rootCause);
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

  it('normalizes a diagnostic-free anchor failure from observed source posture', async () => {
    const sourceRef = 'refs/cas/caches/git-warp/materializations';
    const targetRef = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    const generation = 'a'.repeat(40);
    const { adapter } = createFailedMutationAdapter({
      mutationError: new Error('transaction failed'),
      postures: {
        [sourceRef]: { oid: 'b'.repeat(40), symref: null },
        [targetRef]: null,
      },
    });

    await expect(adapter.anchorRef({
      sourceRef,
      expectedSourceOid: generation,
      targetRef,
    })).resolves.toBe(false);
  });
});

describe('GitRefAdapter scoped-anchor target and operational failures', () => {
  it('normalizes a diagnostic-free anchor failure when the target appeared', async () => {
    const sourceRef = 'refs/cas/caches/git-warp/materializations';
    const targetRef = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    const generation = 'a'.repeat(40);
    const { adapter } = createFailedMutationAdapter({
      mutationError: new Error('transaction failed'),
      postures: {
        [sourceRef]: { oid: generation, symref: null },
        [targetRef]: { oid: generation, symref: null },
      },
    });

    await expect(adapter.anchorRef({
      sourceRef,
      expectedSourceOid: generation,
      targetRef,
    })).resolves.toBe(false);
  });

  it('preserves a failed anchor when observed posture still satisfies it', async () => {
    const sourceRef = 'refs/cas/caches/git-warp/materializations';
    const targetRef = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    const generation = 'a'.repeat(40);
    const rootCause = new Error('permission denied');
    const { adapter } = createFailedMutationAdapter({
      mutationError: rootCause,
      postures: {
        [sourceRef]: { oid: generation, symref: null },
        [targetRef]: null,
      },
    });

    await expect(adapter.anchorRef({
      sourceRef,
      expectedSourceOid: generation,
      targetRef,
    })).rejects.toBe(rootCause);
  });
});

// eslint-disable-next-line max-lines-per-function
describe('GitRefAdapter checked-delete conflicts', () => {
  it('normalizes a diagnostic-free checked delete from observed absence', async () => {
    const ref = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    const generation = 'a'.repeat(40);
    const rootCause = new Error('delete failed');
    const { adapter } = createFailedMutationAdapter({
      mutationError: rootCause,
      postures: { [ref]: null },
    });

    await expect(adapter.deleteRef({ ref, expectedOldOid: generation })).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_CONFLICT,
      meta: {
        ref,
        expectedOldOid: generation,
        actualOldOid: null,
        actualSymref: null,
        originalError: rootCause,
      },
    });
  });

  it('normalizes a diagnostic-free checked delete from an observed OID mismatch', async () => {
    const ref = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    const generation = 'a'.repeat(40);
    const actualOldOid = 'b'.repeat(40);
    const rootCause = new Error('delete failed');
    const { adapter } = createFailedMutationAdapter({
      mutationError: rootCause,
      postures: { [ref]: { oid: actualOldOid, symref: null } },
    });

    await expect(adapter.deleteRef({ ref, expectedOldOid: generation })).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_CONFLICT,
      meta: {
        ref,
        expectedOldOid: generation,
        actualOldOid,
        actualSymref: null,
        originalError: rootCause,
      },
    });
  });

  it('preserves a failed checked delete when observed posture still satisfies it', async () => {
    const ref = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    const generation = 'a'.repeat(40);
    const rootCause = new Error('permission denied');
    const { adapter } = createFailedMutationAdapter({
      mutationError: rootCause,
      postures: { [ref]: { oid: generation, symref: null } },
    });

    await expect(adapter.deleteRef({ ref, expectedOldOid: generation })).rejects.toBe(rootCause);
  });

  it('fails closed when a checked-delete conflict leaves no inspectable direct ref', async () => {
    const { adapter, plumbing } = createAdapter();
    const ref = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    const generation = 'a'.repeat(40);
    const rootCause = Object.assign(new Error('delete failed'), {
      details: { stderr: `error: cannot lock ref '${ref}': unable to resolve reference '${ref}'` },
    });
    plumbing.execute
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(rootCause)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');

    await expect(adapter.deleteRef({ ref, expectedOldOid: generation })).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_CONFLICT,
      meta: {
        ref,
        expectedOldOid: generation,
        actualOldOid: null,
        actualSymref: null,
        originalError: rootCause,
      },
    });
    expect(plumbing.execute).toHaveBeenNthCalledWith(3, {
      args: ['symbolic-ref', '--quiet', ref],
    });
    expect(plumbing.execute).toHaveBeenNthCalledWith(4, {
      args: [
        'for-each-ref',
        '--format=%(refname)%09%(objectname)%09%(symref)',
        '--count=1',
        ref,
      ],
    });
  });

  it('fails closed when a checked-delete conflict leaves a dangling symbolic ref', async () => {
    const { adapter, plumbing } = createAdapter();
    const ref = 'refs/cas/cache-acquisitions/git-warp/materializations/acquisition';
    const danglingTarget = 'refs/heads/not-created';
    const generation = 'a'.repeat(40);
    const rootCause = Object.assign(new Error('delete failed'), {
      details: { stderr: `error: cannot lock ref '${ref}': unable to resolve reference '${ref}'` },
    });
    plumbing.execute
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(rootCause)
      .mockResolvedValueOnce(danglingTarget);

    await expect(adapter.deleteRef({ ref, expectedOldOid: generation })).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_CONFLICT,
      meta: {
        ref,
        expectedOldOid: generation,
        actualOldOid: null,
        actualSymref: danglingTarget,
        originalError: rootCause,
      },
    });
    expect(plumbing.execute).toHaveBeenCalledTimes(3);
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
