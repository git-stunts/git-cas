import { describe, expect, it } from 'vitest';
import RootSetMetadataCodec from '../../../../src/domain/services/RootSetMetadataCodec.js';

const REF = 'refs/cas/rootsets/warp/state-cache';
const TREE_OID = 'a'.repeat(40);

describe('RootSetMetadataCodec', () => {
  it('round-trips a canonical root-set snapshot', () => {
    const codec = new RootSetMetadataCodec();
    const entries = [
      { name: 'snapshot:b', oid: TREE_OID, type: 'tree', retention: 'evictable' },
      { name: 'snapshot:a', oid: 'b'.repeat(40), type: 'blob', retention: 'pinned' },
    ];

    const decoded = codec.decode(codec.encode({ ref: REF, entries }), { expectedRef: REF });

    expect(decoded).toEqual({
      version: 1,
      ref: REF,
      entries: [
        {
          slot: 'root-00000000',
          name: 'snapshot:a',
          oid: 'b'.repeat(40),
          type: 'blob',
          retention: 'pinned',
        },
        {
          slot: 'root-00000001',
          name: 'snapshot:b',
          oid: TREE_OID,
          type: 'tree',
          retention: 'evictable',
        },
      ],
    });
  });

});

describe('RootSetMetadataCodec validation', () => {
  it('rejects metadata copied from another root-set ref', () => {
    const codec = new RootSetMetadataCodec();
    const bytes = codec.encode({ ref: REF, entries: [] });

    expect(() => codec.decode(bytes, {
      expectedRef: 'refs/cas/rootsets/warp/other',
    })).toThrowError(expect.objectContaining({ code: 'ROOT_SET_METADATA_INVALID' }));
  });

  it('rejects duplicate logical names', () => {
    const codec = new RootSetMetadataCodec();

    expect(() => codec.encode({
      ref: REF,
      entries: [
        { name: 'same', oid: TREE_OID, type: 'tree' },
        { name: 'same', oid: 'b'.repeat(40), type: 'blob' },
      ],
    })).toThrowError(expect.objectContaining({ code: 'ROOT_SET_ENTRY_INVALID' }));
  });
});
