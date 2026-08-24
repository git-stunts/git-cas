import { describe, expect, it, vi } from 'vitest';
import WorkspaceCompoundScope from '../../../../src/domain/services/WorkspaceCompoundScope.js';

const PERSISTENCE = Object.freeze({ kind: 'test-persistence' });

function artifact(id) {
  return Object.freeze({
    handle: Object.freeze({ id, toString: () => id }),
  });
}

function ignoreRejection(promise) {
  void promise.catch(() => undefined);
}

function fixture({ putPages, putBundles } = {}) {
  const pages = {
    putBatchWithPersistence: vi.fn(putPages ?? (async ({ id }) => [artifact(`page:${id}`)])),
  };
  const bundles = {
    putOrderedBatchWithPersistence: vi.fn(
      putBundles ?? (async ({ id }) => [artifact(`bundle:${id}`)])
    ),
  };
  const scope = new WorkspaceCompoundScope({
    pages,
    bundles,
    persistence: PERSISTENCE,
  });
  return { bundles, pages, scope };
}

describe('WorkspaceCompoundScope ordering', () => {
  it('serializes concurrently started operations by invocation order', async () => {
    const order = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const { pages, scope } = fixture({
      putPages: async ({ id }) => {
        order.push(`start:${id}`);
        if (id === 'first') {
          await firstGate;
        }
        order.push(`finish:${id}`);
        return [artifact(`page:${id}`)];
      },
    });

    const result = await scope.execute(async (api) => {
      const first = api.pages.putBatch({ id: 'first' });
      const second = api.pages.putBatch({ id: 'second' });
      await vi.waitFor(() => expect(order).toEqual(['start:first']));
      releaseFirst();
      return await Promise.all([first, second]);
    });

    expect(order).toEqual(['start:first', 'finish:first', 'start:second', 'finish:second']);
    expect(pages.putBatchWithPersistence).toHaveBeenCalledTimes(2);
    expect(result.operationCount).toBe(2);
    expect(result.staged).toHaveLength(2);
  });
});

describe('WorkspaceCompoundScope failure ordering', () => {
  it('poisons later queued work after the first staged failure', async () => {
    const failure = new Error('first operation failed');
    const { bundles, scope } = fixture({
      putPages: async () => {
        throw failure;
      },
    });

    await expect(
      scope.execute(
        async (api) =>
          await Promise.all([
            api.pages.putBatch({ id: 'first' }),
            api.bundles.putOrderedBatch({ id: 'second' }),
          ])
      )
    ).rejects.toBe(failure);
    expect(bundles.putOrderedBatchWithPersistence).not.toHaveBeenCalled();
  });

  it('reports distinct callback and staged failures together', async () => {
    const callbackFailure = new Error('callback failed');
    const stagedFailure = new Error('staged operation failed');
    const { scope } = fixture({
      putPages: async () => {
        throw stagedFailure;
      },
    });

    const failure = await scope
      .execute(async (api) => {
        await api.pages.putBatch({ id: 'first' }).catch(() => undefined);
        throw callbackFailure;
      })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([callbackFailure, stagedFailure]);
  });
});

describe('WorkspaceCompoundScope callback failure ordering', () => {
  it('poisons queued work as soon as the callback fails', async () => {
    const callbackFailure = new Error('callback failed');
    const { bundles, pages, scope } = fixture();

    await expect(scope.execute((api) => {
      ignoreRejection(api.pages.putBatch({ id: 'first' }));
      ignoreRejection(api.bundles.putOrderedBatch({ id: 'second' }));
      throw callbackFailure;
    })).rejects.toBe(callbackFailure);

    expect(pages.putBatchWithPersistence).not.toHaveBeenCalled();
    expect(bundles.putOrderedBatchWithPersistence).not.toHaveBeenCalled();
  });
});

describe('WorkspaceCompoundScope falsy failure evidence', () => {
  it('preserves a staged undefined rejection after the callback handles it', async () => {
    const { scope } = fixture({
      putPages: async () => {
        throw undefined;
      },
    });

    const outcome = await scope.execute(async (api) => {
      await api.pages.putBatch({ id: 'first' }).catch(() => undefined);
      return 'must not escape';
    }).then(
      (value) => ({ rejected: false, value }),
      (error) => ({ rejected: true, error }),
    );

    expect(outcome).toEqual({ rejected: true, error: undefined });
  });
});
