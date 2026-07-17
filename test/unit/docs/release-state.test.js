import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const v630CandidateMarker = '**Current release state:** `v6.3.0` release candidate';
const v630PublishedMarker = '**Current release state:** `v6.3.0` is published';
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

function expectNoV630PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '**Last tagged release:** `v6.3.0`',
    '**Current release state:** `v6.3.0` is published',
    '- Signed annotated tag: `v6.3.0`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.3.0',
    '## npm Registry Evidence',
    '| Package | `@git-stunts/git-cas@6.3.0` |',
    '| Dist-tag | `latest` -> `6.3.0` |',
    'attestations/@git-stunts%2fgit-cas@6.3.0'
  ];

  for (const document of documents) {
    for (const marker of forbiddenMarkers) {
      expect(document).not.toContain(marker);
    }
  }
}

function expectV630CandidateState(status, candidate, publication) {
  expect(status).toContain('**Last tagged release:** `v6.2.0` (`2026-07-13`)');
  expect(status).toContain(v630CandidateMarker);
  expect(status).toContain('publication remain pending the reviewed tag workflow');
  expect(candidate).toContain('It passed 14/14 steps and observed 6,325 tests');
  expect(candidate).toContain('242 files, 747,220 packed bytes, and 2,054,933');
  expect(candidate).toContain('7b15ec1819a1c2500c459818785fcd7ec6cf7676');
  expect(candidate).toContain('explicitly unpublished candidate');
  expect(publication).toBeNull();
  expectNoV630PublicationEvidence(status, candidate);
}

function expectV630PublishedState(status, publication) {
  expect(status).toMatch(/\*\*Last tagged release:\*\* `v6\.3\.0` \(`\d{4}-\d{2}-\d{2}`\)/);
  expect(status).toContain(v630PublishedMarker);
  expect(publication).toContain('# PERF-0048 v6.3.0 Publication Witness');
  expect(publication).toContain('- Signed annotated tag: `v6.3.0`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.3.0');
  expect(publication).toContain('| Package | `@git-stunts/git-cas@6.3.0` |');
  expect(publication).toContain('| Dist-tag | `latest` -> `6.3.0` |');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.3.0');
}

function expectV630Lifecycle(status, candidate, publication) {
  const isCandidate = status.includes(v630CandidateMarker);
  const isPublished = status.includes(v630PublishedMarker);

  expect(Number(isCandidate) + Number(isPublished)).toBe(1);
  if (isCandidate) {
    expectV630CandidateState(status, candidate, publication);
    return;
  }
  expect(publication).not.toBeNull();
  expectV630PublishedState(status, publication);
}

function expectFutureV630PublicationState() {
  const status = [
    '**Last tagged release:** `v6.3.0` (`2026-07-17`)',
    `${v630PublishedMarker} to npm with provenance and to GitHub Releases.`
  ].join('\n');
  const publication = [
    '# PERF-0048 v6.3.0 Publication Witness',
    '- Signed annotated tag: `v6.3.0`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.3.0',
    '| Package | `@git-stunts/git-cas@6.3.0` |',
    '| Dist-tag | `latest` -> `6.3.0` |',
    'attestations/@git-stunts%2fgit-cas@6.3.0'
  ].join('\n');

  expectV630Lifecycle(status, '', publication);
}

describe('release state docs', () => {
  it('enforces the v6.3.0 candidate-to-publication lifecycle', () => {
    const status = read('STATUS.md');
    const candidate = read(
      'docs/design/0048-scoped-cache-acquisitions/witness/release-candidate.md'
    );
    const publication = readOptional(v630PublicationPath);
    const witness = read(
      'docs/design/0047-application-storage-cache-boundary/witness/release-publication.md'
    );

    expectV630Lifecycle(status, candidate, publication);
    expectFutureV630PublicationState();
    expect(status).toContain('Current release goalpost:');
    expect(status).toContain('#69 v6.3.0: Bounded scoped cache acquisitions');
    expect(witness).toContain('432c5d9effb12c9f66536f1386791bb4421f3cea');
    expect(witness).toContain('sha512-m8+ZzgNhKU6pVS9pjqJlwAnwYI/s+NMEnINC+Q0g3h6T6mNPdH8U0jb4nEoxU9N1TF+Ut5bjtRMRRaYT75dlew==');
    expect(witness).toContain('https://slsa.dev/provenance/v1');
    expect(witness).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.2.0');
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
