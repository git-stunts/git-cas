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

  it('keeps the v6 release checklist evidence current with the pre-tag candidate', () => {
    const releaseCard = read('docs/method/backlog/v6.0.0/REL_version-bump.md');

    expect(releaseCard).toContain('v6 release-readiness polish');
    expect(releaseCard).toMatch(/143\s+files, 1450 passed, 2 skipped/);
    expect(releaseCard).toContain('tarball has 121 entries');
    expect(releaseCard).toContain('12/12 executable steps, 4801 observed tests');
    expect(releaseCard).toContain('known upstream JSR/Deno 2.6.7');
    expect(releaseCard).not.toContain('main` is pushed through `63d9bc1`');
    expect(releaseCard).not.toContain('130 files, 1390 passed, 2 skipped');
    expect(releaseCard).not.toContain('tarball has 114 entries');
    expect(releaseCard).not.toContain('119 files, 1344 passed');
    expect(releaseCard).not.toContain('tarball has 102 files');
    expect(releaseCard).not.toContain('Push the final pre-tag `main` commit');
  });
});
