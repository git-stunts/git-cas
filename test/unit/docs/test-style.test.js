import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('documentation test style', () => {
  it('does not leave a blank line before top-level describe closures', () => {
    const source = read('test/unit/docs/release-truth.test.js');

    expect(source).not.toMatch(/\n\s*\n\}\);\n\ndescribe\(/);
  });
});
