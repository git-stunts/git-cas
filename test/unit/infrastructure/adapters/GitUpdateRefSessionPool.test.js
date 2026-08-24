import { describe, expect, it, vi } from 'vitest';
import GitUpdateRefSessionPool from '../../../../src/infrastructure/adapters/GitUpdateRefSessionPool.js';

describe('GitUpdateRefSessionPool shutdown', () => {
  it('settles repeated close calls when an in-flight session open rejects', async () => {
    const opening = deferred();
    const rootCause = new Error('session open failed');
    const plumbing = { openUpdateRefSession: vi.fn(() => opening.promise) };
    const pool = new GitUpdateRefSessionPool({ plumbing });
    const update = pool.update({
      ref: 'refs/cas/test',
      newOid: 'a'.repeat(40),
      expectedOldOid: null,
      noDeref: true,
    });
    await vi.waitFor(() => expect(plumbing.openUpdateRefSession).toHaveBeenCalledOnce());

    const closing = pool.close();
    opening.reject(rootCause);

    await expect(update).rejects.toBe(rootCause);
    await expect(closing).resolves.toBeUndefined();
    await expect(pool.close()).resolves.toBeUndefined();
  });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}
