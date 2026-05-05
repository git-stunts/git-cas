import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function v6Heading(changelog) {
  return changelog.match(/^## \[6\.0\.0\] — (.+)$/m)?.[1];
}

describe('release state docs', () => {
  it('keeps v6.0.0 marked unreleased until the tag workflow runs', () => {
    const changelogHeading = v6Heading(read('CHANGELOG.md'));
    const status = read('STATUS.md');

    if (status.includes('annotated tag has not been created')) {
      expect(changelogHeading).toBe('Unreleased');
      expect(changelogHeading).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
