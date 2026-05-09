import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const activeDocs = [
  'STATUS.md',
  'ROADMAP.md',
  'BEARING.md',
  'README.md',
  'GUIDE.md',
  'CHANGELOG.md',
  'docs/method/release.md',
  'docs/method/backlog/README.md',
];

const forbiddenCurrentReleaseClaims = [
  /Last tagged release:\*\* `v5\.3\.2`/u,
  /Current release candidate:\*\* `v6\.0\.0`/u,
  /annotated tag has not been created/u,
  /pre-tag release prep/u,
  /REL — Version Bump/u,
];

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('active release docs', () => {
  it('do not carry stale v6.0.0 pre-release claims after publication', () => {
    const violations = [];

    for (const relPath of activeDocs) {
      const doc = read(relPath);
      for (const pattern of forbiddenCurrentReleaseClaims) {
        if (pattern.test(doc)) {
          violations.push(`${relPath}: ${pattern.source}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
