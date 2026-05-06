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

function summaryCounts(markdown) {
  const match = markdown.match(/summary:\n\s+total_findings: (\d+)\n\s+severity_count:\n\s+critical: (\d+)\n\s+high: (\d+)\n\s+medium: (\d+)\n\s+low: (\d+)/);
  if (!match) {
    throw new Error('Missing summary counts');
  }
  const [, total, critical, high, medium, low] = match.map(Number);
  return { total, critical, high, medium, low };
}

function countMatches(markdown, pattern) {
  return [...markdown.matchAll(pattern)].length;
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

  it('keeps audit summary finding counts reconciled with report bodies', () => {
    const codeQuality = read('docs/audit/2026-05-04_code-quality.md');
    const shipReadiness = read('docs/audit/2026-05-04_ship-readiness.md');

    const reports = [
      {
        name: 'code quality',
        markdown: codeQuality,
        bodyCount: countMatches(codeQuality, /^### [1-4]\.\d\./gm),
      },
      {
        name: 'ship readiness',
        markdown: shipReadiness,
        bodyCount: countMatches(shipReadiness, /^\*\*(Issue|Violation|Risk|Vulnerability|Gap) \d+:/gm),
      },
    ];

    for (const report of reports) {
      const counts = summaryCounts(report.markdown);
      expect(counts.total, report.name).toBe(report.bodyCount);
      expect(counts.critical + counts.high + counts.medium + counts.low, report.name).toBe(counts.total);
    }
  });
});

describe('audit blocker classification', () => {
  it('keeps non-TUI audit leftovers classified as v6 blockers', () => {
    const reports = [
      read('docs/audit/2026-05-04_code-quality.md'),
      read('docs/audit/2026-05-04_documentation-quality.md'),
      read('docs/audit/2026-05-04_ship-readiness.md'),
    ];

    const combined = reports.join('\n');

    expect(combined).toContain('Still Open - v6.0.0 Blockers');
    expect(combined).toContain('Deferred To v6.x');
    expect(combined).toContain('TUI — Orphaned-Chunk Health Check');
    expect(combined).not.toContain('not required to tag v6.0.0');
    expect(combined).not.toContain('not a v6.0.0 blocker');
    expect(combined).not.toContain('remain post-v6 maintenance priorities, not tag blockers');
  });

  it('marks the v6 release readiness polish findings resolved', () => {
    const report = read('docs/audit/2026-05-05_v6-release-readiness.md');

    for (const issue of ['ISSUE-002', 'ISSUE-003', 'ISSUE-004', 'ISSUE-005']) {
      expect(report).toContain(`### ${issue}`);
      expect(report).toContain(`**Resolution Status:** RESOLVED`);
    }

    expect(report).toContain('### ISSUE-001');
    expect(report).toContain('**Resolution Status:** RESOLVED');
    expect(report).not.toContain('**Resolution Status:** DEFERRED TO v6.1.0');
  });
});
