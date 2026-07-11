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
