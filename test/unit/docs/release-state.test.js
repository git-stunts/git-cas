import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const v650CandidateMarker = '**Current release state:** `v6.5.0` release candidate';
const v650PublishedMarker = '**Current release state:** `v6.5.0` is published';
const v650CandidatePath =
  'docs/design/0050-lazy-bundle-reference-reads/witness/release-candidate.md';
const v650PublicationPath =
  'docs/design/0050-lazy-bundle-reference-reads/witness/release-publication.md';
const v640PublicationPath =
  'docs/design/0049-scoped-staging-workspaces/witness/release-publication.md';

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function readOptional(relPath) {
  return existsSync(path.join(repoRoot, relPath)) ? read(relPath) : null;
}

function v6Heading(changelog) {
  return changelog.match(/^## \[6\.0\.0\] — (.+)$/m)?.[1];
}

function expectNoV650PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '**Last tagged release:** `v6.5.0`',
    '**Current release state:** `v6.5.0` is published',
    '- Signed annotated tag: `v6.5.0`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.0',
    '## npm Registry Evidence',
    /\| Package\s+\| `@git-stunts\/git-cas@6\.5\.0`\s+\|/,
    /\| Dist-tag\s+\| `latest` -> `6\.5\.0`\s+\|/,
    'attestations/@git-stunts%2fgit-cas@6.5.0',
  ];

  for (const document of documents) {
    for (const marker of forbiddenMarkers) {
      if (marker instanceof RegExp) {
        expect(document).not.toMatch(marker);
      } else {
        expect(document).not.toContain(marker);
      }
    }
  }
}

function expectV650CandidateState(status, candidate, publication) {
  expect(status).toContain('**Last tagged release:** `v6.4.0` (`2026-07-18`)');
  expect(status).toContain(v650CandidateMarker);
  expect(status).toContain('remain pending the reviewed tag workflow');
  expect(status).toContain('#81 Bounded lazy bundle references and immutable metadata reads');
  expect(candidate).toContain('# PERF-0050 v6.5.0 Release Candidate Witness');
  expect(candidate).toContain('d5f770fb4589cd33d2244c83232ee7ede1df9ec1');
  expect(candidate).toMatch(/passed 14\/14 steps with 6,625 observed tests/);
  expect(candidate).toContain('249 files totaling 769,785 packed bytes');
  expect(candidate).toMatch(/2,149,364\s+unpacked bytes/);
  expect(candidate).toMatch(/500\/500 two-writer\s+races/);
  expect(candidate).toMatch(/explicitly\s+unpublished candidate/);
  expect(publication).toBeNull();
  expectNoV650PublicationEvidence(status, candidate);
}

function expectV650PublishedState(status, publication) {
  expect(status).toMatch(/\*\*Last tagged release:\*\* `v6\.5\.0` \(`\d{4}-\d{2}-\d{2}`\)/);
  expect(status).toContain(v650PublishedMarker);
  expect(status).toContain('f464b929');
  expect(status).toContain('#39 v6.6.0: Operator TUI');
  expect(status).toContain('#40 v6.6.0: Agent automation follow-through');
  expect(status).toContain('[`v6.6.0` milestone]');
  expect(publication).toContain('# PERF-0050 v6.5.0 Publication Witness');
  expect(publication).toContain('f464b9292a07dbc98cda24aad6712e9d9a3bcefa');
  expect(publication).toContain('fa955936f1e3feb4fe07e8456b983d5a535801a8');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('- Signed annotated tag: `v6.5.0`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.5.0');
  expect(publication).toContain('actions/runs/29655337483');
  expect(publication).toMatch(/\| Package\s+\| `@git-stunts\/git-cas@6\.5\.0`\s+\|/);
  expect(publication).toMatch(/\| Dist-tag\s+\| `latest` -> `6\.5\.0`\s+\|/);
  expect(publication).toContain(
    'sha512-KfKperNdXu3xWw07tpo1yYpLTynhwAP60PhYiZ5MRsSydPdNspQzJmi6Pv0Jz+6WULD883/NJCR0V1IUhBwOBw=='
  );
  expect(publication).toContain('4d05349bb8373bab57e12be65621bdc08325f278');
  expect(publication).toContain('2,149,363');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.5.0');
}

function expectCurrentV640PublicationEvidence(publication) {
  expect(publication).toContain('d47af74a288ef362dba684536cff11c063cfdcc3');
  expect(publication).toContain('3545b8aa81e395e832f112214b301dbe53d9576f');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('actions/runs/29627828620');
  expect(publication).toContain(
    'sha512-xLtNBCpXolGGusV8efsr/cRlhjrRrFFKZQVwgx/gNtonPVzDor6AyidtILM88ss6M6bJLapGUgOaoimr/y3gZA=='
  );
  expect(publication).toContain('5feda2da0e05bbded738602dd47c8bc1d58a3921');
  expect(publication).toContain('2,129,716');
}

function expectV650Lifecycle(status, candidate, publication) {
  const isCandidate = status.includes(v650CandidateMarker);
  const isPublished = status.includes(v650PublishedMarker);

  expect(Number(isCandidate) + Number(isPublished)).toBe(1);
  if (isCandidate) {
    expectV650CandidateState(status, candidate, publication);
    return;
  }
  expect(publication).not.toBeNull();
  expectV650PublishedState(status, publication);
}

function expectFutureV650PublicationState() {
  const status = [
    '**Last tagged release:** `v6.5.0` (`2026-07-18`)',
    `${v650PublishedMarker} to npm with provenance and to GitHub Releases.`,
    'f464b929',
    '#39 v6.6.0: Operator TUI',
    '#40 v6.6.0: Agent automation follow-through',
    '[`v6.6.0` milestone]',
  ].join('\n');
  const publication = [
    '# PERF-0050 v6.5.0 Publication Witness',
    'f464b9292a07dbc98cda24aad6712e9d9a3bcefa',
    'fa955936f1e3feb4fe07e8456b983d5a535801a8',
    '01A63D8E9DBEEDE32918AF9C39560E0406CA9135',
    '- Signed annotated tag: `v6.5.0`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.0',
    'actions/runs/29655337483',
    '| Package | `@git-stunts/git-cas@6.5.0` |',
    '| Dist-tag | `latest` -> `6.5.0` |',
    'sha512-KfKperNdXu3xWw07tpo1yYpLTynhwAP60PhYiZ5MRsSydPdNspQzJmi6Pv0Jz+6WULD883/NJCR0V1IUhBwOBw==',
    '4d05349bb8373bab57e12be65621bdc08325f278',
    '2,149,363',
    'attestations/@git-stunts%2fgit-cas@6.5.0',
  ].join('\n');

  expectV650Lifecycle(status, '', publication);
}

describe('release state docs', () => {
  it('enforces the v6.5.0 candidate-to-publication lifecycle', () => {
    const status = read('STATUS.md');
    const candidate = read(v650CandidatePath);
    const publication = readOptional(v650PublicationPath);
    const v640Publication = read(v640PublicationPath);

    expectV650Lifecycle(status, candidate, publication);
    expectFutureV650PublicationState();
    expectCurrentV640PublicationEvidence(v640Publication);
    expect(status).toContain('Current release goalpost:');
    expect(status).toContain('d47af74a');
    expect(v640Publication).toContain('https://slsa.dev/provenance/v1');
    expect(v640Publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.4.0');
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
