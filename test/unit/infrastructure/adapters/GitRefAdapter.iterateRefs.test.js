import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../../src/domain/errors/index.js';
import GitRefAdapter from '../../../../src/infrastructure/adapters/GitRefAdapter.js';

const noPolicy = { execute: (fn) => fn() };

function refStream(chunks, result = { code: 0, stderr: '' }) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
    finished: Promise.resolve(result),
  };
}

describe('GitRefAdapter.iterateRefs()', () => {
  it('streams only the requested ref prefix and validates fragmented output', async () => {
    const prefix = 'refs/cas/cache-acquisitions/git-warp%2Fmaterializations/';
    const firstOid = 'a'.repeat(40);
    const secondOid = 'b'.repeat(40);
    const plumbing = {
      executeStream: vi.fn().mockResolvedValue(refStream([
        `${prefix}first\t${firstOid}\t\n${prefix}`,
        `second\t${secondOid}\trefs/heads/main\n`,
      ])),
    };
    const adapter = new GitRefAdapter({ plumbing, policy: noPolicy });

    const refs = [];
    for await (const ref of adapter.iterateRefs({ prefix, limit: 3 })) {
      refs.push(ref);
    }

    expect(refs).toEqual([
      { ref: `${prefix}first`, oid: firstOid, symref: null },
      { ref: `${prefix}second`, oid: secondOid, symref: 'refs/heads/main' },
    ]);
    expect(plumbing.executeStream).toHaveBeenCalledWith({
      args: [
        'for-each-ref',
        '--format=%(refname)%09%(objectname)%09%(symref)',
        '--count=3',
        prefix,
      ],
    });
  });

});

describe('GitRefAdapter.iterateRefs() failures', () => {
  it('fails closed on malformed records and non-zero stream completion', async () => {
    const plumbing = {
      executeStream: vi.fn()
        .mockResolvedValueOnce(refStream(['refs/cas/example\tnot-an-oid\t\n']))
        .mockResolvedValueOnce(refStream([], { code: 128, stderr: 'inventory failed' })),
    };
    const adapter = new GitRefAdapter({ plumbing, policy: noPolicy });

    await expect(async () => {
      for await (const ignored of adapter.iterateRefs({ prefix: 'refs/cas/', limit: 10 })) {
        void ignored;
      }
    }).rejects.toMatchObject({ code: ErrorCodes.GIT_ERROR });

    await expect(async () => {
      for await (const ignored of adapter.iterateRefs({ prefix: 'refs/cas/', limit: 10 })) {
        void ignored;
      }
    }).rejects.toMatchObject({
      code: ErrorCodes.GIT_ERROR,
      meta: { stderr: 'inventory failed' },
    });
  });

  it('rejects an absent or unbounded record limit before invoking Git', async () => {
    const plumbing = { executeStream: vi.fn() };
    const adapter = new GitRefAdapter({ plumbing, policy: noPolicy });

    await expect(async () => {
      for await (const ignored of adapter.iterateRefs({ prefix: 'refs/cas/' })) {
        void ignored;
      }
    }).rejects.toMatchObject({ code: ErrorCodes.GIT_ERROR });
    await expect(async () => {
      for await (const ignored of adapter.iterateRefs({ prefix: 'refs/cas/', limit: 1002 })) {
        void ignored;
      }
    }).rejects.toMatchObject({ code: ErrorCodes.GIT_ERROR });
    expect(plumbing.executeStream).not.toHaveBeenCalled();
  });
});
