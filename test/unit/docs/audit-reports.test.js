import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function boundedSection(markdown, start, end) {
  const startIndex = markdown.indexOf(start);
  if (startIndex === -1) {
    throw new Error(`Missing section start: ${start}`);
  }
  const endIndex = markdown.indexOf(end, startIndex + start.length);
  return markdown.slice(startIndex, endIndex === -1 ? undefined : endIndex);
}

describe('audit reports', () => {
  it('keeps ship-readiness code-quality violations actionable with rewrite snippets', () => {
    const report = read('docs/audit/2026-05-04_ship-readiness.md');

    for (const violation of [1, 2, 3]) {
      const nextMarker = violation === 3 ? '## 2. PRODUCTION READINESS' : `**Violation ${violation + 1}:**`;
      const section = boundedSection(report, `**Violation ${violation}:**`, nextMarker);

      expect(section, `Violation ${violation}`).toContain(`**Original Code Snippet ${violation}:**`);
      expect(section, `Violation ${violation}`).toContain(`**Simplified Rewrite ${violation}:**`);
      expect(section, `Violation ${violation}`).toContain(`**Mitigation Prompt ${violation + 3}:**`);
    }
  });
});
