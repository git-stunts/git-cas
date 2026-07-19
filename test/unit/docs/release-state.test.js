import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const v653CandidateMarker = '**Current release state:** `v6.5.3` release candidate';
const v653CandidatePath =
  'docs/design/0053-git-object-session-coherence/witness/release-candidate.md';
const v653PublicationPath =
  'docs/design/0053-git-object-session-coherence/witness/release-publication.md';
const v652CandidatePath =
  'docs/design/0052-persistent-git-object-sessions/witness/release-candidate.md';
const v652PublicationPath =
  'docs/design/0052-persistent-git-object-sessions/witness/release-publication.md';
const v651CandidatePath =
  'docs/design/0051-bounded-page-payload-reuse/witness/release-candidate.md';
const v651PublicationPath =
  'docs/design/0051-bounded-page-payload-reuse/witness/release-publication.md';
const v650PublicationPath =
  'docs/design/0050-lazy-bundle-reference-reads/witness/release-publication.md';
const v640PublicationPath =
  'docs/design/0049-scoped-staging-workspaces/witness/release-publication.md';

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function v6Heading(changelog) {
  return changelog.match(/^## \[6\.0\.0\] — (.+)$/m)?.[1];
}

function expectNoV651PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '**Last tagged release:** `v6.5.1`',
    '**Current release state:** `v6.5.1` is published',
    '- Signed annotated tag: `v6.5.1`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.1',
    '## npm Registry Evidence',
    /\| Package\s+\| `@git-stunts\/git-cas@6\.5\.1`\s+\|/,
    /\| Dist-tag\s+\| `latest` -> `6\.5\.1`\s+\|/,
    'attestations/@git-stunts%2fgit-cas@6.5.1',
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

function expectNoV652PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '**Last tagged release:** `v6.5.2`',
    '**Current release state:** `v6.5.2` is published',
    '- Signed annotated tag: `v6.5.2`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.2',
    '## npm Registry Evidence',
    /\| Package\s+\| `@git-stunts\/git-cas@6\.5\.2`\s+\|/,
    /\| Dist-tag\s+\| `latest` -> `6\.5\.2`\s+\|/,
    'attestations/@git-stunts%2fgit-cas@6.5.2',
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

function expectNoV653PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '**Last tagged release:** `v6.5.3`',
    '**Current release state:** `v6.5.3` is published',
    '- Signed annotated tag: `v6.5.3`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.3',
    '## npm Registry Evidence',
    /\| Package\s+\| `@git-stunts\/git-cas@6\.5\.3`\s+\|/,
    /\| Dist-tag\s+\| `latest` -> `6\.5\.3`\s+\|/,
    'attestations/@git-stunts%2fgit-cas@6.5.3',
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

function expectV653CandidateEvidence(status, candidate) {
  expect(status).toContain('**Last tagged release:** `v6.5.2` (`2026-07-19`)');
  expect(status).toContain(v653CandidateMarker);
  expect(status).toContain('remain pending the reviewed tag workflow');
  expect(status).toContain('passed 14/14 release-verifier steps with 6,829 observed tests');
  expect(status).toContain('7bdcbf1f');
  expect(candidate).toContain('# PERF-0053 v6.5.3 Release Candidate Witness');
  expect(candidate).toContain('Implementation review: #95');
  expect(candidate).toContain('Release review: pending');
  expect(candidate).toContain('7bdcbf1f9eccd16acd324c94d576e1ecd2e11d98');
  expect(candidate).toContain('**PASS (14/14)**');
  expect(candidate).toContain('**6,829**');
  expect(candidate).toMatch(/explicitly\s+unpublished candidate/);
  expectNoV653PublicationEvidence(status, candidate);
  expect(existsSync(path.join(repoRoot, v653PublicationPath))).toBe(false);
}

function expectV652CandidateEvidence(candidate) {
  expect(candidate).toContain('# PERF-0052 v6.5.2 Release Candidate Witness');
  expect(candidate).toContain('Implementation review: #91');
  expect(candidate).toContain('Release review: #92');
  expect(candidate).toContain('4ce37adc57d49d2633507c3fbdc46e98617b26d6');
  expect(candidate).toContain('**PASS (14/14)**');
  expect(candidate).toContain('**6,817**');
  expect(candidate).toMatch(/explicitly\s+unpublished candidate/);
  expectNoV652PublicationEvidence(candidate);
}

function expectV652PublishedEvidence(status, publication) {
  expect(status).toContain('**Last tagged release:** `v6.5.2` (`2026-07-19`)');
  expect(status).toContain('**v6.5.2 artifact posture**');
  expect(status).toContain('c2d41f60');
  expect(status).toContain('29690794540');
  expect(status).toContain('#39 v6.6.0: Operator TUI');
  expect(status).toContain('#40 v6.6.0: Agent automation follow-through');
  expect(publication).toContain('# PERF-0052 v6.5.2 Publication Witness');
  expect(publication).toContain('c2d41f608bc9a5e8c19a12ce1024c4c756fd752a');
  expect(publication).toContain('5becfb292460bfa22e6e4dad6cec3c3243e6e88f');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('- Signed annotated tag: `v6.5.2`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.5.2');
  expect(publication).toContain('actions/runs/29690794540');
  expect(publication).toMatch(/\| Package\s+\| `@git-stunts\/git-cas@6\.5\.2`\s+\|/);
  expect(publication).toMatch(/\| Dist-tag\s+\| `latest` -> `6\.5\.2`\s+\|/);
  expect(publication).toContain(
    'sha512-2fZXK52SuaSnO7xxlcAEh6qxnptNIoN2jl0eq5ZYZCisFdtGRGW6I080gC3J40/r35dI32UTtRRY+R3cCd2X1g=='
  );
  expect(publication).toContain('b2eca5eb490716e3a8156a63e151d0db040ce16c');
  expect(publication).toContain('2,200,510');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.5.2');
}

function expectV651CandidateEvidence(candidate) {
  expect(candidate).toContain('# PERF-0051 v6.5.1 Release Candidate Witness');
  expect(candidate).toContain('Implementation review: #87');
  expect(candidate).toContain('Release review: #88');
  expect(candidate).toContain('ad5b91b2ff7c156526961a8d0575be1a250d92c6');
  expect(candidate).toContain('**PASS (14/14)**');
  expect(candidate).toContain('**6,676**');
  expect(candidate).toMatch(/explicitly\s+unpublished candidate/);
  expectNoV651PublicationEvidence(candidate);
}

function expectV651PublishedEvidence(status, publication) {
  expect(status).toContain('**v6.5.1 artifact posture**');
  expect(status).toContain('49b7d5cb');
  expect(status).toContain('29666480492');
  expect(status).toContain('#39 v6.6.0: Operator TUI');
  expect(status).toContain('#40 v6.6.0: Agent automation follow-through');
  expect(publication).toContain('# PERF-0051 v6.5.1 Publication Witness');
  expect(publication).toContain('49b7d5cb9d589d73fa17d393e48d40bd6f139e57');
  expect(publication).toContain('ed905f8f8cde55ffae08f607dc02f545f9e0565b');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('- Signed annotated tag: `v6.5.1`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.5.1');
  expect(publication).toContain('actions/runs/29666480492');
  expect(publication).toMatch(/\| Package\s+\| `@git-stunts\/git-cas@6\.5\.1`\s+\|/);
  expect(publication).toMatch(/\| Dist-tag\s+\| `latest` -> `6\.5\.1`\s+\|/);
  expect(publication).toContain(
    'sha512-rRPDuuMUsy1KpysIDlQ0oclUxnECAN+b7TNGOBZdE+c7inqaj3Mv4dHuZ2Bb4I/jKwQ+e13wSSG+IaWfkrmOXw=='
  );
  expect(publication).toContain('3811131c703a0ccea5f4fdbb906778a6bdd06eb0');
  expect(publication).toContain('2,158,035');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.5.1');
}

function expectV650PublishedEvidence(status, publication) {
  expect(status).toContain('**v6.5.0 artifact posture**');
  expect(status).toContain('f464b929');
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

describe('release state docs', () => {
  it('enforces the v6.5.3 candidate while preserving prior evidence', () => {
    const status = read('STATUS.md');
    const candidate = read(v653CandidatePath);
    const v652Candidate = read(v652CandidatePath);
    const v652Publication = read(v652PublicationPath);
    const v651Candidate = read(v651CandidatePath);
    const v653ReleaseNotes = read('docs/releases/v6.5.3.md');
    const v652ReleaseNotes = read('docs/releases/v6.5.2.md');
    const publication = read(v651PublicationPath);
    const v650Publication = read(v650PublicationPath);
    const v640Publication = read(v640PublicationPath);

    expectV653CandidateEvidence(status, candidate);
    expectV652CandidateEvidence(v652Candidate);
    expectV652PublishedEvidence(status, v652Publication);
    expectV651CandidateEvidence(v651Candidate);
    expectV651PublishedEvidence(status, publication);
    expect(v653ReleaseNotes).toContain('release verifier passed all 14 steps with 6,829');
    expect(v652ReleaseNotes).toContain('passed all 14 release-verifier steps with 6,817 observed');
    expectV650PublishedEvidence(status, v650Publication);
    expectCurrentV640PublicationEvidence(v640Publication);
    expect(status).toContain('Current release goalpost:');
    expect(status).toContain('#39 v6.6.0: Operator TUI');
    expect(status).toContain('#40 v6.6.0: Agent automation follow-through');
    expect(status).toContain('0053-git-object-session-coherence');
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
