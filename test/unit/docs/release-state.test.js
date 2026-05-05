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

  it('keeps the v6 release checklist evidence current with the latest pushed candidate', () => {
    const releaseCard = read('docs/method/backlog/v6.0.0/REL_version-bump.md');

    expect(releaseCard).toContain('main` is pushed through `63d9bc1`');
    expect(releaseCard).toContain('130 files, 1390 passed, 2 skipped');
    expect(releaseCard).toContain('tarball has 113 entries');
    expect(releaseCard).not.toContain('119 files, 1344 passed');
    expect(releaseCard).not.toContain('tarball has 102 files');
    expect(releaseCard).not.toContain('Push the final pre-tag `main` commit');
  });
});
