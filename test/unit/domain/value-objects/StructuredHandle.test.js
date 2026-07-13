import { describe, expect, it } from 'vitest';
import parseApplicationHandle from '../../../../src/domain/value-objects/ApplicationHandle.js';
import BundleHandle from '../../../../src/domain/value-objects/BundleHandle.js';
import PageHandle from '../../../../src/domain/value-objects/PageHandle.js';

describe('structured application handles', () => {
  it.each([
    [PageHandle, { oid: 'a'.repeat(40) }, 'git-cas:1:page:blob:raw:sha1:'],
    [BundleHandle, { codec: 'json', oid: 'b'.repeat(64) }, 'git-cas:1:bundle:fanout-tree:json:sha256:'],
  ])('round-trips canonical %s tokens', (Type, value, prefix) => {
    const handle = new Type(value);

    expect(handle.toString()).toBe(`${prefix}${value.oid}`);
    expect(Type.parse(handle.toString())).toEqual(handle);
    expect(parseApplicationHandle(handle.toString())).toEqual(handle);
    expect(Object.isFrozen(handle)).toBe(true);
  });

  it('rejects cross-kind parsing', () => {
    const page = new PageHandle({ oid: 'c'.repeat(40) });

    expect(() => BundleHandle.parse(page.toString())).toThrow(
      expect.objectContaining({ code: 'HANDLE_KIND_MISMATCH' })
    );
  });
});
