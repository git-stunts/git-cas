import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function sectionBody(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) {
    return '';
  }

  const afterHeading = markdown.slice(start + heading.length);
  const nextSectionOffset = afterHeading.search(/\n## |\n### /);
  if (nextSectionOffset === -1) {
    return afterHeading;
  }
  return afterHeading.slice(0, nextSectionOffset);
}

function markdownLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
}

function localMarkdownLinks(markdown) {
  return markdownLinks(markdown)
    .filter((link) => !link.startsWith('http'))
    .filter((link) => !link.startsWith('#'));
}

function assertLocalMarkdownLinksExist(file) {
  const directory = path.dirname(file);
  const missing = localMarkdownLinks(read(file))
    .map((link) => link.split('#')[0])
    .filter(Boolean)
    .map((link) => path.normalize(path.join(directory, link)))
    .filter((target) => !existsSync(path.join(repoRoot, target)));

  expect(missing).toEqual([]);
}

function cycleDirs() {
  return readdirSync(path.join(repoRoot, 'docs/design'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function archivedGoalpostFiles() {
  const root = path.join(repoRoot, 'docs/archive/goalposts-pre-issues');
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readdirSync(path.join(root, entry.name))
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.posix.join('docs/archive/goalposts-pre-issues', entry.name, name)))
    .sort();
}

describe('planning surfaces', () => { // eslint-disable-line max-lines-per-function
  it('keeps GitHub Issues named as the canonical work tracker', () => {
    const checks = [
      ['ROADMAP.md', 'GitHub Issues and Milestones are the source of truth'],
      ['WORKFLOW.md', 'Work tracking truth lives in GitHub Issues and Milestones'],
      ['docs/method/process.md', 'If it is actionable work, it must be a GitHub Issue'],
      ['docs/method/backlog/README.md', 'This directory is no longer an active work tracker'],
      ['docs/method/legends/TR_truth.md', 'GitHub Issues and Milestones own current Truth work'],
      ['docs/legends/TR-truth.md', 'GitHub Issues and Milestones own current Truth work'],
    ];

    for (const [file, expected] of checks) {
      expect(read(file)).toContain(expected);
    }
  });

  it('publishes GitHub issue forms for canonical tracker work types', () => {
    const forms = [
      '.github/ISSUE_TEMPLATE/goalpost.yml',
      '.github/ISSUE_TEMPLATE/slice.yml',
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/debt.yml',
      '.github/ISSUE_TEMPLATE/idea.yml',
    ];

    for (const form of forms) {
      expect(existsSync(path.join(repoRoot, form))).toBe(true);
    }

    expect(read('.github/ISSUE_TEMPLATE/goalpost.yml')).toContain('type:goalpost');
    expect(read('.github/ISSUE_TEMPLATE/slice.yml')).toContain('type:slice');
    expect(read('docs/method/process.md')).toContain('.github/ISSUE_TEMPLATE/');
  });

  it('keeps the METHOD design index in sync with numbered cycle directories', () => {
    const designReadme = read('docs/design/README.md');
    const indexedCycles = [
      sectionBody(designReadme, '## Active METHOD Cycles'),
      sectionBody(designReadme, '## Landed METHOD Cycles'),
    ].join('\n');
    const links = markdownLinks(indexedCycles)
      .map((link) => link.split('/')[1])
      .sort();

    expect(links).toEqual(cycleDirs());
  });

  it('keeps the retired repo backlog from acting like a live queue', () => {
    const backlog = read('docs/method/backlog/README.md');

    expect(backlog).toContain('Do not add new work cards here.');
    expect(backlog).toContain('docs/archive/backlog-pre-issues/');
    expect(backlog).not.toContain('bad-code/');
    expect(backlog).not.toContain('cool-ideas/');
    assertLocalMarkdownLinksExist('docs/method/backlog/README.md');
  });

  it('keeps current legend tracker summaries out of repo-local backlog lanes', () => {
    const files = [
      'docs/method/legends/TR_truth.md',
      'docs/method/legends/RL_relay.md',
      'docs/legends/TR-truth.md',
      'docs/legends/RL-relay.md',
    ];

    for (const file of files) {
      const section = sectionBody(read(file), '## Current Tracker')
        || sectionBody(read(file), '## Current METHOD Tracker');
      expect(section).toContain('GitHub Issues and Milestones');
      expect(section).not.toContain('method/backlog');
      assertLocalMarkdownLinksExist(file);
    }
  });

  it('keeps roadmap and process links pointed at real repo docs', () => {
    const files = [
      'ROADMAP.md',
      'WORKFLOW.md',
      'docs/method/process.md',
      'docs/templates/design-doc.md',
    ];

    for (const file of files) {
      assertLocalMarkdownLinksExist(file);
    }
  });

  it('keeps archived goalpost identity paths pointed at their archived files', () => {
    for (const file of archivedGoalpostFiles()) {
      const goalpostDoc = read(file).match(/^\| Goalpost doc \| `([^`]+)` \|$/mu)?.[1];

      expect(goalpostDoc).toBe(file);
    }
  });
});
