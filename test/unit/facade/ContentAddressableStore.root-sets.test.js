import { describe, expect, it, vi } from 'vitest';
import ContentAddressableStore, { RootSet, RootSetRegistry } from '../../../index.js';

function mockPlumbing() {
  return {
    execute: vi.fn(),
    executeStream: vi.fn(),
  };
}

describe('ContentAddressableStore rootSets', () => {
  it('opens a typed root set through the facade namespace', async () => {
    const cas = new ContentAddressableStore({ plumbing: mockPlumbing() });
    const rootSet = await cas.rootSets.open({
      ref: 'refs/cas/rootsets/warp/state-cache',
    });

    expect(rootSet).toBeInstanceOf(RootSet);
    expect(await cas.getRootSetRegistry()).toBeInstanceOf(RootSetRegistry);
  });

  it('rejects refs outside the root-set namespace', async () => {
    const cas = new ContentAddressableStore({ plumbing: mockPlumbing() });

    await expect(cas.rootSets.open({ ref: 'refs/heads/main' }))
      .rejects.toMatchObject({ code: 'ROOT_SET_REF_INVALID' });
  });
});
