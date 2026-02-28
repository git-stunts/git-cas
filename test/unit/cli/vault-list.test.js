import { describe, it, expect } from 'vitest';
import { matchGlob, filterEntries, formatTable, formatTabSeparated } from '../../../bin/ui/vault-list.js';

describe('matchGlob', () => {
  it('matches single-segment wildcard', () => {
    expect(matchGlob('photos/*', 'photos/hero.jpg')).toBe(true);
  });

  it('rejects non-matching prefix', () => {
    expect(matchGlob('photos/*', 'other/hero.jpg')).toBe(false);
  });

  it('matches extension glob', () => {
    expect(matchGlob('*.bin', 'asset.bin')).toBe(true);
  });

  it('rejects wrong extension', () => {
    expect(matchGlob('*.bin', 'asset.json')).toBe(false);
  });

  it('matches double-star across segments', () => {
    expect(matchGlob('assets/**/*.png', 'assets/img/icons/logo.png')).toBe(true);
  });

  it('matches question mark for single char', () => {
    expect(matchGlob('file?.txt', 'file1.txt')).toBe(true);
    expect(matchGlob('file?.txt', 'file12.txt')).toBe(false);
  });

  it('handles exact match', () => {
    expect(matchGlob('exact', 'exact')).toBe(true);
    expect(matchGlob('exact', 'other')).toBe(false);
  });
});

describe('filterEntries', () => {
  const entries = [
    { slug: 'photos/hero.jpg', treeOid: 'aaa' },
    { slug: 'photos/thumb.png', treeOid: 'bbb' },
    { slug: 'videos/intro.mp4', treeOid: 'ccc' },
  ];

  it('returns all entries when no pattern is provided', () => {
    expect(filterEntries(entries)).toEqual(entries);
    expect(filterEntries(entries, undefined)).toEqual(entries);
  });

  it('filters entries by glob pattern', () => {
    const result = filterEntries(entries, 'photos/*');
    expect(result).toEqual([
      { slug: 'photos/hero.jpg', treeOid: 'aaa' },
      { slug: 'photos/thumb.png', treeOid: 'bbb' },
    ]);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterEntries(entries, 'docs/*')).toEqual([]);
  });
});

describe('formatTable', () => {
  it('includes header and aligned columns', () => {
    const entries = [
      { slug: 'short', treeOid: 'abc123' },
      { slug: 'a-longer-slug', treeOid: 'def456' },
    ];
    const output = formatTable(entries);
    const lines = output.split('\n');
    expect(lines[0]).toMatch(/^SLUG\s+TREE OID$/);
    expect(lines[1]).toContain('short');
    expect(lines[1]).toContain('abc123');
    expect(lines[2]).toContain('a-longer-slug');
    expect(lines[2]).toContain('def456');
  });

  it('returns empty string for no entries', () => {
    expect(formatTable([])).toBe('');
  });
});

describe('formatTabSeparated', () => {
  it('outputs tab-delimited rows', () => {
    const entries = [
      { slug: 'a', treeOid: '111' },
      { slug: 'b', treeOid: '222' },
    ];
    const output = formatTabSeparated(entries);
    expect(output).toBe('a\t111\nb\t222\n');
  });

  it('returns empty string for no entries', () => {
    expect(formatTabSeparated([])).toBe('');
  });
});
