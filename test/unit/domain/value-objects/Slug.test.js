import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import CasError from '../../../../src/domain/errors/CasError.js';
import Slug from '../../../../src/domain/value-objects/Slug.js';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('Slug value object', () => {
  it('accepts valid hierarchical slugs', () => {
    expect(Slug.from('photos/beach-2024').toString()).toBe('photos/beach-2024');
  });

  it('rejects invalid slug structure with domain errors', () => {
    expect(() => Slug.validate('a/../b')).toThrow(CasError);
    expect(() => Slug.validate('a/../b')).toThrow('Slug contains "." or ".." segment');
  });

  it('encodes and decodes vault tree entry names without losing percent signs or slashes', () => {
    const slug = Slug.from('demo/%/hello');

    expect(slug.toTreePath()).toBe('demo%2F%25%2Fhello');
    expect(Slug.encode(slug)).toBe('demo%2F%25%2Fhello');
    expect(Slug.decode('demo%2F%25%2Fhello')).toBe(slug.toString());
  });

  it('rejects control characters before tree-entry encoding', () => {
    expect(() => Slug.encode('demo\nhello')).toThrow('Slug contains control characters');
  });
});

describe('Slug module boundaries', () => {
  it('keeps VaultService delegated to the Slug value object', () => {
    const vaultService = read('src/domain/services/VaultService.js');

    expect(vaultService).not.toMatch(/function encodeSlug/);
    expect(vaultService).not.toMatch(/function decodeSlug/);
    expect(vaultService).not.toMatch(/#validateSegment/);
    expect(vaultService).toContain('.toTreePath()');
    expect(vaultService).toContain('Slug.decode');
  });
});
