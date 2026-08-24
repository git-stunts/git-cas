import { describe, expect, it, vi } from 'vitest';
import ContentAddressableStore from '../../../index.js';
import GitRefAdapter from '../../../src/infrastructure/adapters/GitRefAdapter.js';

function plumbing() {
  return {
    execute: vi.fn(),
    executeStream: vi.fn(),
  };
}

describe('ContentAddressableStore lifecycle', () => {
  it('closes initialized persistence exactly once', async () => {
    const closeRef = vi.spyOn(GitRefAdapter.prototype, 'close');
    const cas = new ContentAddressableStore({ plumbing: plumbing() });
    const service = await cas.getService();
    const close = vi.spyOn(service.persistence, 'close');

    await Promise.all([cas.close(), cas.close(), cas[Symbol.asyncDispose]()]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(closeRef).toHaveBeenCalledTimes(1);
    await expect(cas.getService()).rejects.toMatchObject({ code: 'RESOURCE_CLOSED' });
    closeRef.mockRestore();
  });

  it('does not initialize persistence merely to close an unused facade', async () => {
    const cas = new ContentAddressableStore({ plumbing: plumbing() });

    await cas.close();

    expect(cas.service).toBeNull();
    await expect(cas.pages.get({ handle: 'unused' })).rejects.toMatchObject({
      code: 'RESOURCE_CLOSED',
    });
  });
});
