import { describe, expect, it } from 'vitest';
import RootSetRef from '../../../../src/domain/value-objects/RootSetRef.js';

describe('RootSetRef', () => {
  it.each([
    'refs/cas/rootsets/warp/state-cache',
    'refs/cas/rootsets/integration/prune-proof',
    'refs/cas/rootsets/cache.v1',
  ])('accepts %s', (ref) => {
    expect(RootSetRef.from(ref).toString()).toBe(ref);
  });

  it.each([
    'refs/heads/main',
    'refs/cas/rootsets/',
    'refs/cas/rootsets/warp//cache',
    'refs/cas/rootsets/warp/../cache',
    'refs/cas/rootsets/warp/cache.lock',
    'refs/cas/rootsets/warp/cache~1',
    'refs/cas/rootsets/warp/cache\nother',
  ])('rejects %s', (ref) => {
    expect(() => RootSetRef.from(ref))
      .toThrowError(expect.objectContaining({ code: 'ROOT_SET_REF_INVALID' }));
  });
});
