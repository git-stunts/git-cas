import { describe, expect, it } from 'vitest';
import GitTreeObjectCodec from '../../../../src/infrastructure/codecs/GitTreeObjectCodec.js';

function rawEntry({ mode, name, oid }) {
  return Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, 'hex')]);
}

describe('GitTreeObjectCodec.decode()', () => {
  it.each([
    ['SHA-1', 'a'.repeat(40)],
    ['SHA-256', 'b'.repeat(64)],
  ])('decodes %s object identifiers without changing entry meaning', (_label, oid) => {
    const treeOid = 'c'.repeat(oid.length);
    const decoded = GitTreeObjectCodec.decode(
      rawEntry({
        mode: '100644',
        name: 'page',
        oid,
      }),
      treeOid
    );

    expect(decoded.entries).toEqual([{ mode: '100644', type: 'blob', oid, name: 'page' }]);
    expect(decoded.weight).toBeGreaterThan(oid.length / 2);
    expect(Object.isFrozen(decoded.entries[0])).toBe(true);
  });

  it('normalizes the raw directory mode and preserves commit entries', () => {
    const treeOid = 'd'.repeat(40);
    const content = Buffer.concat([
      rawEntry({ mode: '40000', name: 'nested', oid: 'e'.repeat(40) }),
      rawEntry({ mode: '160000', name: 'submodule', oid: 'f'.repeat(40) }),
    ]);

    expect(GitTreeObjectCodec.decode(content, treeOid).entries).toEqual([
      { mode: '040000', type: 'tree', oid: 'e'.repeat(40), name: 'nested' },
      { mode: '160000', type: 'commit', oid: 'f'.repeat(40), name: 'submodule' },
    ]);
  });

  it.each([
    ['missing delimiter', Buffer.from('100644 page')],
    ['truncated OID', Buffer.concat([Buffer.from('100644 page\0'), Buffer.alloc(19)])],
    ['invalid mode', rawEntry({ mode: '100600', name: 'page', oid: 'a'.repeat(40) })],
  ])('rejects a malformed tree with a %s', (_label, content) => {
    expect(() => GitTreeObjectCodec.decode(content, 'a'.repeat(40))).toThrow(TypeError);
  });
});

describe('GitTreeObjectCodec.parseMktreeLines()', () => {
  it('converts the existing persistence line contract', () => {
    expect(
      GitTreeObjectCodec.parseMktreeLines([
        `100644 blob ${'a'.repeat(40)}\tpage`,
        `040000 tree ${'b'.repeat(40)}\tnested`,
      ])
    ).toEqual([
      { mode: '100644', type: 'blob', oid: 'a'.repeat(40), name: 'page' },
      { mode: '040000', type: 'tree', oid: 'b'.repeat(40), name: 'nested' },
    ]);
  });

  it.each([
    ['bad OID', '100644 blob nope\tpage'],
    ['wrong type', `100644 tree ${'a'.repeat(40)}\tpage`],
    ['nested name', `100644 blob ${'a'.repeat(40)}\tnested/page`],
  ])('rejects %s before writing protocol bytes', (_label, line) => {
    expect(() => GitTreeObjectCodec.parseMktreeLines([line])).toThrow(TypeError);
  });
});
