import { describe, it, expect, vi } from 'vitest';
import { makeCtx } from './_testContext.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
}));

const { renderManifestView } = await import('../../../bin/ui/manifest-view.js');

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
  });

  it('renders chunk table', () => {
    const output = renderManifestView({ manifest: makeManifest() });
    expect(output).toContain('Chunks (2)');
    expect(output).toContain('aaaaaaaaaaaa...');
  });

  it('renders encryption section', () => {
    const enc = { algorithm: 'aes-256-gcm', nonce: 'bm9uY2U=bm9u', tag: 'dGFndGFn', encrypted: true, kdf: { algorithm: 'pbkdf2', iterations: 100000 } };
    const output = renderManifestView({ manifest: makeManifest({ encryption: enc }) });
    expect(output).toContain('Encryption');
    expect(output).toContain('aes-256-gcm');
  });

  it('renders compression section', () => {
    const output = renderManifestView({ manifest: makeManifest({ compression: { algorithm: 'gzip' } }) });
    expect(output).toContain('Compression');
  });

  it('renders sub-manifests', () => {
    const subs = [{ oid: 'aaaa1111bbbb2222', chunkCount: 1000, startIndex: 0 }, { oid: 'cccc3333dddd4444', chunkCount: 500, startIndex: 1000 }];
    const output = renderManifestView({ manifest: makeManifest({ version: 2, subManifests: subs }) });
    expect(output).toContain('Sub-manifests (2)');
  });

  it('truncates chunks beyond 20', () => {
    const chunks = Array.from({ length: 30 }, (_, i) => ({ index: i, size: 262144, digest: 'a'.repeat(64), blob: 'b'.repeat(40) }));
    const output = renderManifestView({ manifest: makeManifest({ chunks }) });
    expect(output).toContain('Chunks (30)');
  });
});
