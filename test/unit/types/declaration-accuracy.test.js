import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function casServiceTypes() {
  return readFileSync(path.join(repoRoot, 'src/domain/services/CasService.d.ts'), 'utf8');
}

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function interfaceBody(source, name) {
  const match = source.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    throw new Error(`Missing interface ${name}`);
  }
  return match[1];
}

describe('Type declaration accuracy', () => {
  it('keeps direct CasService constructor-only runtime requirements non-optional', () => {
    const options = interfaceBody(casServiceTypes(), 'CasServiceOptions');

    expect(options).toMatch(/\n\s+chunker: ChunkingPort;/);
    expect(options).toMatch(/\n\s+compressionAdapter: CompressionPort;/);
    expect(options).not.toMatch(/\n\s+chunker\?: ChunkingPort;/);
    expect(options).not.toMatch(/\n\s+compressionAdapter\?: CompressionPort;/);
  });

  it('exposes all supported store-time encryption knobs', () => {
    const options = interfaceBody(casServiceTypes(), 'StoreEncryptionOptions');

    expect(options).toMatch(/\n\s+scheme\?: EncryptionScheme;/);
    expect(options).toMatch(/\n\s+frameBytes\?: number;/);
    expect(options).toMatch(/\n\s+convergent\?: boolean;/);
  });

  it('keeps runtime JSDoc store encryption shapes aligned with declarations', () => {
    const encryptionShape = /@param \{\{ scheme\?: 'whole'\|'framed'\|'convergent', frameBytes\?: number, convergent\?: boolean \}\} \[options\.encryption\]/;

    for (const relPath of [
      'src/domain/services/CasService.js',
      'src/infrastructure/adapters/FileIOHelper.js',
    ]) {
      expect(read(relPath), relPath).toMatch(encryptionShape);
    }
  });

  it('keeps ManifestDiff parameter typedefs resolvable', () => {
    const source = read('src/domain/services/ManifestDiff.js');

    expect(source).toMatch(
      /@typedef\s+\{import\(['"]\.\.\/value-objects\/Manifest\.js['"]\)\.default\}\s+Manifest/,
    );
    expect(source).toMatch(/@param\s+\{Manifest\}\s+oldManifest/);
    expect(source).toMatch(/@param\s+\{Manifest\}\s+newManifest/);
  });
});
