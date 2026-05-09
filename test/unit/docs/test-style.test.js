import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

describe('documentation test style', () => {
  it('does not leave a blank line before top-level describe closures', () => {
    const source = read('test/unit/docs/release-truth.test.js');

    expect(source).not.toMatch(/\n\s*\n\}\);\n\ndescribe\(/);
  });

  it('keeps unit tests focused on behavior rather than source layout', () => {
    const offenders = listFiles(path.join(repoRoot, 'test/unit'))
      .filter((file) => file.endsWith('.structure.test.js'))
      .map((file) => path.relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });

  it('uses current vault tree-path terminology in vault tests', () => {
    const offenders = listFiles(path.join(repoRoot, 'test/unit/vault'))
      .filter((file) => {
        const relPath = path.relative(repoRoot, file);
        return relPath.endsWith('encodeSlug.test.js') || read(relPath).includes('encodeSlug');
      })
      .map((file) => path.relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });

  it('documents that iterator metadata reads do not produce cache snapshots', () => {
    const source = read('src/domain/services/VaultPersistence.js');

    expect(source).toContain('Iterator metadata reads do not materialize the full vault tree');
  });
});
