import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const v640CandidateMarker = '**Current release state:** `v6.4.0` release candidate';
const v640PublishedMarker = '**Current release state:** `v6.4.0` is published';
const v640CandidatePath =
  'docs/design/0049-scoped-staging-workspaces/witness/release-candidate.md';
const v640PublicationPath =
  'docs/design/0049-scoped-staging-workspaces/witness/release-publication.md';
const v630PublicationPath =
  'docs/design/0048-scoped-cache-acquisitions/witness/release-publication.md';

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function readOptional(relPath) {
  return existsSync(path.join(repoRoot, relPath)) ? read(relPath) : null;
}

function v6Heading(changelog) {
  return changelog.match(/^## \[6\.0\.0\] — (.+)$/m)?.[1];
}

function expectNoV640PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '**Last tagged release:** `v6.4.0`',
    '**Current release state:** `v6.4.0` is published',
    '- Signed annotated tag: `v6.4.0`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.4.0',
    '## npm Registry Evidence',
    '| Package | `@git-stunts/git-cas@6.4.0` |',
    '| Dist-tag | `latest` -> `6.4.0` |',
    'attestations/@git-stunts%2fgit-cas@6.4.0'
  ];

  for (const document of documents) {
    for (const marker of forbiddenMarkers) {
      expect(document).not.toContain(marker);
    }
  }
}

function expectV640CandidateState(status, candidate, publication) {
  expect(status).toContain('**Last tagged release:** `v6.3.0` (`2026-07-17`)');
  expect(status).toContain(v640CandidateMarker);
  expect(status).toContain('remain pending the reviewed tag workflow');
  expect(status).toContain('#75 Scoped staging workspaces for multi-object promotion');
  expect(candidate).toContain('# PERF-0049 v6.4.0 Release Candidate Witness');
  expect(candidate).toContain('1ac2fc85be857ca769c459b89c29bf4483b3f304');
  expect(candidate).toContain('8185dfb9819909d9fbe0f0394de6ae31fc0a94a3');
  expect(candidate).toContain('passed 14/14 steps with 6,538 observed tests');
  expect(candidate).toContain('247 files, 763,925 packed bytes');
  expect(candidate).toContain('2,129,717 unpacked bytes');
  expect(candidate).toContain('explicitly unpublished candidate');
  expect(publication).toBeNull();
  expectNoV640PublicationEvidence(status, candidate);
}

function expectV640PublishedState(status, publication) {
  expect(status).toMatch(/\*\*Last tagged release:\*\* `v6\.4\.0` \(`\d{4}-\d{2}-\d{2}`\)/);
  expect(status).toContain(v640PublishedMarker);
  expect(status).toContain('#38 Bounded Residency');
  expect(status).toContain('[`v6.4.1` milestone]');
  expect(publication).toContain('# PERF-0049 v6.4.0 Publication Witness');
  expect(publication).toContain('- Signed annotated tag: `v6.4.0`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.4.0');
  expect(publication).toContain('| Package | `@git-stunts/git-cas@6.4.0` |');
  expect(publication).toContain('| Dist-tag | `latest` -> `6.4.0` |');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.4.0');
}

function expectV640Lifecycle(status, candidate, publication) {
  const isCandidate = status.includes(v640CandidateMarker);
  const isPublished = status.includes(v640PublishedMarker);

  expect(Number(isCandidate) + Number(isPublished)).toBe(1);
  if (isCandidate) {
    expectV640CandidateState(status, candidate, publication);
    return;
  }
  expect(publication).not.toBeNull();
  expectV640PublishedState(status, publication);
}

function expectFutureV640PublicationState() {
  const status = [
    '**Last tagged release:** `v6.4.0` (`2026-07-17`)',
    `${v640PublishedMarker} to npm with provenance and to GitHub Releases.`,
    '#38 Bounded Residency',
    '[`v6.4.1` milestone]'
  ].join('\n');
  const publication = [
    '# PERF-0049 v6.4.0 Publication Witness',
    '- Signed annotated tag: `v6.4.0`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.4.0',
    '| Package | `@git-stunts/git-cas@6.4.0` |',
    '| Dist-tag | `latest` -> `6.4.0` |',
    'attestations/@git-stunts%2fgit-cas@6.4.0'
  ].join('\n');

  expectV640Lifecycle(status, '', publication);
}

describe('release state docs', () => {
  it('enforces the v6.4.0 candidate-to-publication lifecycle', () => {
    const status = read('STATUS.md');
    const candidate = read(v640CandidatePath);
    const publication = readOptional(v640PublicationPath);
    const v630Publication = read(v630PublicationPath);

    expectV640Lifecycle(status, candidate, publication);
    expectFutureV640PublicationState();
    expect(status).toContain('Current release goalpost:');
    expect(v630Publication).toContain('33f4171f6b69d75110de834f9a75d64e2d14e1a3');
    expect(v630Publication).toContain('sha512-Cl/WPjj60LvjXl3BqSb1M3a0tx2xpx6KxGEC1TXKekNzgn5so/t43LG7Qz2XuXle+YmXWoCi8H94cJYvfgI8Yw==');
    expect(v630Publication).toContain('https://slsa.dev/provenance/v1');
    expect(v630Publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.3.0');
  });
});

describe('historical v6 release evidence', () => {
  it('keeps v6.0.0 marked released once the tag workflow has published', () => {
    const changelogHeading = v6Heading(read('CHANGELOG.md'));
    const status = read('STATUS.md');

    if (status.includes('v6.0.0` is published to npm and GitHub Releases')) {
      expect(changelogHeading).toBe('2026-05-09');
      expect(status).toContain('**Last tagged release:** `v6.0.0` (`2026-05-09`)');
      expect(status).not.toContain('annotated tag has not been created');
    }
  });

  it('keeps the v6 release checklist evidence current with the pre-tag candidate', () => {
    const releaseCard = read('docs/archive/backlog-pre-issues/v6.0.0/REL_version-bump.md');

    expect(releaseCard).toContain('v6 release-readiness polish');
    expect(releaseCard).toMatch(/168\s+files, 1502 passed, 2 skipped/);
    expect(releaseCard).toContain('tarball has 166 entries');
    expect(releaseCard).toContain('12/12 executable steps, 4957 observed tests');
    expect(releaseCard).toMatch(/known\s+upstream JSR\/Deno 2\.6\.7/);
    expect(releaseCard).not.toContain('143 files, 1450 passed, 2 skipped');
    expect(releaseCard).not.toContain('tarball has 121 entries');
    expect(releaseCard).not.toContain('4801 observed tests');
    expect(releaseCard).not.toContain('main` is pushed through `63d9bc1`');
    expect(releaseCard).not.toContain('130 files, 1390 passed, 2 skipped');
    expect(releaseCard).not.toContain('tarball has 114 entries');
    expect(releaseCard).not.toContain('119 files, 1344 passed');
    expect(releaseCard).not.toContain('tarball has 102 files');
    expect(releaseCard).not.toContain('Push the final pre-tag `main` commit');
  });
});
