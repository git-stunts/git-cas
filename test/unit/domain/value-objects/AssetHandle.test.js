import { describe, expect, it } from 'vitest';
import AssetHandle from '../../../../src/domain/value-objects/AssetHandle.js';

const OID = '0123456789abcdef0123456789abcdef01234567';
const TOKEN = `git-cas:1:asset:manifest-tree:json:sha1:${OID}`;

describe('AssetHandle', () => {
  it('round-trips one canonical repository-independent token', () => {
    const handle = new AssetHandle({ codec: 'json', oid: OID });

    expect(handle).toMatchObject({
      version: 1,
      kind: 'asset',
      format: 'manifest-tree',
      codec: 'json',
      hashAlgorithm: 'sha1',
      oid: OID,
    });
    expect(handle.toString()).toBe(TOKEN);
    expect(AssetHandle.from(TOKEN)).toEqual(handle);
    expect(AssetHandle.from(handle.toJSON())).toEqual(handle);
    expect(handle.toJSON()).toEqual({
      version: 1,
      kind: 'asset',
      format: 'manifest-tree',
      codec: 'json',
      hashAlgorithm: 'sha1',
      oid: OID,
    });
    expect(handle.toJSON()).not.toHaveProperty('repository');
    expect(Object.isFrozen(handle)).toBe(true);
  });

  it('derives sha256 from a 64-character object identifier', () => {
    const oid = 'a'.repeat(64);

    expect(new AssetHandle({ codec: 'cbor', oid })).toMatchObject({
      hashAlgorithm: 'sha256',
      oid,
    });
  });

  it.each([
    ['not a token', 'HANDLE_INVALID'],
    [`git-cas:2:asset:manifest-tree:json:sha1:${OID}`, 'HANDLE_INVALID'],
    [`git-cas:1:bundle:manifest-tree:json:sha1:${OID}`, 'HANDLE_KIND_MISMATCH'],
    [`git-cas:1:asset:unknown:json:sha1:${OID}`, 'HANDLE_INVALID'],
    [`git-cas:1:asset:manifest-tree:JSON:sha1:${OID}`, 'HANDLE_INVALID'],
    [`git-cas:1:asset:manifest-tree:json:sha256:${OID}`, 'HANDLE_INVALID'],
    ['git-cas:1:asset:manifest-tree:json:sha1:nope', 'HANDLE_INVALID'],
  ])('rejects malformed token %s', (token, code) => {
    expect(() => AssetHandle.from(token)).toThrow(expect.objectContaining({ code }));
  });
});
