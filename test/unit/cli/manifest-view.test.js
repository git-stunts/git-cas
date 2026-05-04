import { describe, it, expect, vi } from 'vitest';
import { makeCtx } from './_testContext.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
}));

const { renderManifestView, buildManifestSections } = await import('../../../bin/ui/manifest-view.js');

function makeManifest(overrides = {}) {
  return {
    toJSON() { return this; },
    version: 1,
    slug: 'test-asset',
    filename: 'photo.jpg',
    size: 524288,
    chunks: [
      { index: 0, size: 262144, digest: 'a'.repeat(64), blob: 'b'.repeat(40) },
      { index: 1, size: 262144, digest: 'c'.repeat(64), blob: 'd'.repeat(40) },
    ],
    ...overrides,
  };
}

describe('renderManifestView', () => {
  it('renders metadata', () => {
    const output = renderManifestView({ manifest: makeManifest() });
    expect(output).toContain('test-asset');
    expect(output).toContain('photo.jpg');
    expect(output).toContain('Metadata');
    expect(output).toContain('v1');
  });

  it('renders chunk table', () => {
    const output = renderManifestView({ manifest: makeManifest() });
    expect(output).toContain('Chunk Ledger (2)');
    expect(output).toContain('aaaaaaaaaaaaaaaa...');
  });

  it('renders encryption section', () => {
    const enc = { algorithm: 'aes-256-gcm', nonce: 'bm9uY2U=bm9u', tag: 'dGFndGFn', encrypted: true, kdf: { algorithm: 'pbkdf2', iterations: 100000 } };
    const output = renderManifestView({ manifest: makeManifest({ encryption: enc }) });
    expect(output).toContain('Encryption');
    expect(output).toContain('aes-256-gcm');
    expect(output).toContain('encrypted');
  });

  it('renders compression section', () => {
    const output = renderManifestView({ manifest: makeManifest({ compression: { algorithm: 'gzip' } }) });
    expect(output).toContain('Compression');
    expect(output).toContain('gzip');
  });

  it('renders sub-manifests', () => {
    const subs = [{ oid: 'aaaa1111bbbb2222', chunkCount: 1000, startIndex: 0 }, { oid: 'cccc3333dddd4444', chunkCount: 500, startIndex: 1000 }];
    const output = renderManifestView({ manifest: makeManifest({ version: 2, subManifests: subs }) });
    expect(output).toContain('Merkle Branches (2)');
    expect(output).toContain('merkle');
  });

  it('renders all chunks in static manifest output', () => {
    const chunks = Array.from({ length: 30 }, (_, i) => ({ index: i, size: 262144, digest: 'a'.repeat(64), blob: 'b'.repeat(40) }));
    const output = renderManifestView({ manifest: makeManifest({ chunks }) });
    expect(output).toContain('Chunk Ledger (30)');
    expect(output).toContain('29');
    expect(output).not.toContain('and 10 more');
  });
});

describe('buildManifestSections structure', () => {
  it('returns metadata section expanded by default', () => {
    const sections = buildManifestSections({ manifest: makeManifest() });
    expect(sections[0].title).toBe('Asset Metadata');
    expect(sections[0].expanded).toBe(true);
  });

  it('includes only applicable sections', () => {
    const sections = buildManifestSections({ manifest: makeManifest() });
    const titles = sections.map((s) => s.title);
    expect(titles).toContain('Asset Metadata');
    expect(titles).toContain('Chunk Ledger (2)');
    expect(titles).not.toContain('Encryption Profile');
    expect(titles).not.toContain('Compression Profile');
  });

  it('all sections default to expanded', () => {
    const enc = { algorithm: 'aes-256-gcm', nonce: 'bm9uY2U=bm9u', tag: 'dGFndGFn', encrypted: true };
    const sections = buildManifestSections({
      manifest: makeManifest({ encryption: enc, compression: { algorithm: 'zstd' } }),
    });
    for (const section of sections) {
      expect(section.expanded).toBe(true);
    }
  });

  it('section content contains expected data', () => {
    const sections = buildManifestSections({ manifest: makeManifest() });
    const metadata = sections.find((s) => s.title === 'Asset Metadata');
    expect(metadata.content).toContain('test-asset');
    expect(metadata.content).toContain('photo.jpg');
  });
});

describe('buildManifestSections optional sections', () => {
  it('includes encryption section when manifest is encrypted', () => {
    const enc = { algorithm: 'aes-256-gcm', nonce: 'bm9uY2U=bm9u', tag: 'dGFndGFn', encrypted: true, kdf: { algorithm: 'pbkdf2', iterations: 100000 } };
    const sections = buildManifestSections({ manifest: makeManifest({ encryption: enc }) });
    expect(sections.map((s) => s.title)).toContain('Encryption Profile');
    expect(sections.find((s) => s.title === 'Encryption Profile').expanded).toBe(true);
  });

  it('includes compression section when manifest is compressed', () => {
    const sections = buildManifestSections({ manifest: makeManifest({ compression: { algorithm: 'gzip' } }) });
    expect(sections.map((s) => s.title)).toContain('Compression Profile');
  });

  it('includes sub-manifests section when present', () => {
    const subs = [{ oid: 'aaaa1111bbbb2222', chunkCount: 1000, startIndex: 0 }];
    const sections = buildManifestSections({ manifest: makeManifest({ subManifests: subs }) });
    expect(sections.map((s) => s.title)).toContain('Merkle Branches (1)');
  });
});
