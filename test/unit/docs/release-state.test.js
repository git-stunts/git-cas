import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const v653PublishedMarker = '**v6.5.3 artifact posture**';
const v659CandidatePath =
  'docs/design/0060-compound-workspace-admission/witness/release-candidate.md';
const v659PublicationPath =
  'docs/design/0060-compound-workspace-admission/witness/release-publication.md';
const v658CandidatePath = 'docs/design/0059-bounded-write-waves/witness/release-candidate.md';
const v658PublicationPath = 'docs/design/0059-bounded-write-waves/witness/release-publication.md';
const v657CandidatePath =
  'docs/design/0058-bounded-stream-session-reads/witness/release-candidate.md';
const v657PublicationPath =
  'docs/design/0058-bounded-stream-session-reads/witness/release-publication.md';
const v656CandidatePath =
  'docs/design/0057-deterministic-ref-conflict-posture/witness/release-candidate.md';
const v656PublicationPath =
  'docs/design/0057-deterministic-ref-conflict-posture/witness/release-publication.md';
const v655CandidatePath = 'docs/design/0055-internal-commit-identity/witness/release-candidate.md';
const v655PublicationPath =
  'docs/design/0055-internal-commit-identity/witness/release-publication.md';
const v654CandidatePath = 'docs/design/0054-batched-page-retention/witness/release-candidate.md';
const v654PublicationPath =
  'docs/design/0054-batched-page-retention/witness/release-publication.md';
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

function expectNoV659PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '**Last tagged release:** `v6.5.9`',
    '**Current release state:** `v6.5.9` is published',
    '- Signed annotated tag: `v6.5.9`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.9',
    '## npm Registry Evidence',
    /\| Package\s+\| `@git-stunts\/git-cas@6\.5\.9`\s+\|/,
    /\| Dist-tag\s+\| `latest` -> `6\.5\.9`\s+\|/,
    'attestations/@git-stunts%2fgit-cas@6.5.9',
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

function expectNoV658PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '**Last tagged release:** `v6.5.8`',
    '**Current release state:** `v6.5.8` is published',
    '- Signed annotated tag: `v6.5.8`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.8',
    '## npm Registry Evidence',
    /\| Package\s+\| `@git-stunts\/git-cas@6\.5\.8`\s+\|/,
    /\| Dist-tag\s+\| `latest` -> `6\.5\.8`\s+\|/,
    'attestations/@git-stunts%2fgit-cas@6.5.8',
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

function expectNoV657PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '**Last tagged release:** `v6.5.7`',
    '**Current release state:** `v6.5.7` is published',
    '- Signed annotated tag: `v6.5.7`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.7',
    '## npm Registry Evidence',
    /\| Package\s+\| `@git-stunts\/git-cas@6\.5\.7`\s+\|/,
    /\| Dist-tag\s+\| `latest` -> `6\.5\.7`\s+\|/,
    'attestations/@git-stunts%2fgit-cas@6.5.7',
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

function expectNoV656PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '- Signed annotated tag: `v6.5.6`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.6',
    '## npm Registry Evidence',
    /\| Package\s+\| `@git-stunts\/git-cas@6\.5\.6`\s+\|/,
    /\| Dist-tag\s+\| `latest` -> `6\.5\.6`\s+\|/,
    'attestations/@git-stunts%2fgit-cas@6.5.6',
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

function expectNoV655PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '- Signed annotated tag: `v6.5.5`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.5',
    '## npm Registry Evidence',
    /\| Package\s+\| `@git-stunts\/git-cas@6\.5\.5`\s+\|/,
    /\| Dist-tag\s+\| `latest` -> `6\.5\.5`\s+\|/,
    'attestations/@git-stunts%2fgit-cas@6.5.5',
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

function expectNoV654PublicationEvidence(...documents) {
  const forbiddenMarkers = [
    '**Last tagged release:** `v6.5.4`',
    '**Current release state:** `v6.5.4` is published',
    '- Signed annotated tag: `v6.5.4`',
    'https://github.com/git-stunts/git-cas/releases/tag/v6.5.4',
    '## npm Registry Evidence',
    /\| Package\s+\| `@git-stunts\/git-cas@6\.5\.4`\s+\|/,
    /\| Dist-tag\s+\| `latest` -> `6\.5\.4`\s+\|/,
    'attestations/@git-stunts%2fgit-cas@6.5.4',
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

function expectV653CandidateEvidence(candidate) {
  expect(candidate).toContain('# PERF-0053 v6.5.3 Release Candidate Witness');
  expect(candidate).toContain('Implementation review: #95');
  expect(candidate).toContain('Release review: #96');
  expect(candidate).toContain('7bdcbf1f9eccd16acd324c94d576e1ecd2e11d98');
  expect(candidate).toContain('**PASS (14/14)**');
  expect(candidate).toContain('**6,829**');
  expect(candidate).toMatch(/explicitly\s+unpublished candidate/);
  expectNoV653PublicationEvidence(candidate);
}

function expectV654CandidateEvidence(candidate) {
  expect(candidate).toContain('# PERF-0054 v6.5.4 Release Candidate Witness');
  expect(candidate).toContain('Implementation review: #100');
  expect(candidate).toContain('Release review: #101');
  expect(candidate).toContain('e6c58f10bf5244d0ee815a60636dec3c896ef38f');
  expect(candidate).toContain('**PASS (14/14)**');
  expect(candidate).toContain('**6,844**');
  expect(candidate).toMatch(/explicitly\s+unpublished\s+candidate/);
  expectNoV654PublicationEvidence(candidate);
}

function expectV654PublishedEvidence(status, publication) {
  expect(status).toContain('**v6.5.4 artifact posture**');
  expect(status).toContain('a2d23f5b');
  expect(status).toContain('30205009357');
  expect(publication).toContain('# PERF-0054 v6.5.4 Publication Witness');
  expect(publication).toContain('a2d23f5bfc5d00eecab897eadd9072dab4aff534');
  expect(publication).toContain('554d552ed957d5bbe2ad1c685309ae64359ff7ea');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('- Signed annotated tag: `v6.5.4`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.5.4');
  expect(publication).toContain('actions/runs/30205009357');
  expect(publication).toMatch(/\| Package\s+\| `@git-stunts\/git-cas@6\.5\.4`\s+\|/);
  expect(publication).toMatch(/\| Dist-tag\s+\| `latest` -> `6\.5\.4`\s+\|/);
  expect(publication).toContain(
    'sha512-3C7kWprQl6cPz0P1DPIW/T04ujucn276LJv0zK+QmwI83t6smTx2PLDulOTlpumlP4SVOFY2cUTyd/1gtgbgkA=='
  );
  expect(publication).toContain('bcf4784d4c05a08a8bb95f03038f680dc5ed90a8');
  expect(publication).toContain('2,209,770');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.5.4');
}

function expectV655CandidateEvidence(candidate) {
  expect(candidate).toContain('# INFRA-0055 v6.5.5 Release Candidate Witness');
  expect(candidate).toContain('Implementation review: #103');
  expect(candidate).toContain('Release review: #104');
  expect(candidate).toContain('fa3d5f6479b66bc09578487b33d1a55dec9e02b4');
  expect(candidate).toContain('**PASS (14/14)**');
  expect(candidate).toContain('**6,850**');
  expect(candidate).toMatch(/explicitly\s+unpublished\s+candidate/);
  expectNoV655PublicationEvidence(candidate);
}

function expectV655PublishedEvidence(status, publication) {
  expect(status).toContain('**v6.5.5 artifact posture**');
  expect(status).toContain('9ea91a73');
  expect(status).toContain('30211630524');
  expect(publication).toContain('# INFRA-0055 v6.5.5 Publication Witness');
  expect(publication).toContain('9ea91a738f2cbadf2a20b5ac7c2c6d54ba9f409e');
  expect(publication).toContain('c1dc40fa3b25902be4abf6588da75f309a0153c7');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('- Signed annotated tag: `v6.5.5`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.5.5');
  expect(publication).toContain('actions/runs/30211630524');
  expect(publication).toMatch(/\| Package\s+\| `@git-stunts\/git-cas@6\.5\.5`\s+\|/);
  expect(publication).toMatch(/\| Dist-tag at publication\s+\| `latest` -> `6\.5\.5`\s+\|/);
  expect(publication).toContain(
    'sha512-x2ohvIq04o5W3eFmn/x6WQ8UuXcqIxcdKuQOhttZJ80ZokuY+97xqqi7cJCDdrmeJMkbcuSW1VvWFzcz6K6TAg=='
  );
  expect(publication).toContain('92d2be5d262dd8f24273d518d60bb23f81d7d427');
  expect(publication).toContain('2,213,032');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.5.5');
}

function expectV656CandidateEvidence(candidate) {
  expect(candidate).toContain('# TRUST-0057 v6.5.6 Release Candidate Witness');
  expect(candidate).toContain('Implementation reviews: #109 and #112');
  expect(candidate).toContain('Release review: #113');
  expect(candidate).toContain('e802269ab6035eae75c2d61a8e8a898800cffbb8');
  expect(candidate).toContain('4327effd31c6d8ff00980512d6c59fc5064432d7');
  expect(candidate).toContain('**PASS: 14/14 gates**');
  expect(candidate).toContain('**6,898**');
  expect(candidate).toMatch(/explicitly\s+unpublished\s+candidate/);
  expectNoV656PublicationEvidence(candidate);
}

function expectV657CandidateEvidence(candidate, releaseNotes) {
  expect(candidate).toContain('# PERF-0058 v6.5.7 Release Candidate Witness');
  expect(candidate).toContain('Implementation review: #116');
  expect(candidate).toContain('Release review: #117');
  expect(candidate).toContain('7631d597b1091f5cb5c29c7c7770a5a2bf435cc7');
  expect(candidate).toContain('1e30740c8670bf42b8bb863f8feb99a5e0f0f29b');
  expect(candidate).toContain('c344d119fd2afb5f7c024b4912714acbfd156768');
  expect(candidate).toContain('**PASS: 14/14 gates**');
  expect(candidate).toContain('**6,922**');
  expect(candidate).toMatch(/explicitly\s+unpublished\s+candidate/);
  expectNoV657PublicationEvidence(candidate, releaseNotes);
}

function expectV657PublishedEvidence(status, publication) {
  expect(status).toContain('**v6.5.7 artifact posture**');
  expect(status).toContain('eebc6e37');
  expect(status).toContain('32637934268');
  expect(publication).toContain('# PERF-0058 v6.5.7 Publication Witness');
  expect(publication).toContain(
    '- Reviewed merge commit: `eebc6e37179f4fffd55f6ff7df2cab2613902772`'
  );
  expect(publication).toContain('- Tag object: `74ce49dc415365b966b39bf6d2a8a0e2e0d9b846`');
  expect(publication).toContain('- Peeled tag target: `eebc6e37179f4fffd55f6ff7df2cab2613902772`');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('- Signed annotated tag: `v6.5.7`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.5.7');
  expect(publication).toContain('actions/runs/32637934268');
  expect(publication).toMatch(/\| Package\s+\| `@git-stunts\/git-cas@6\.5\.7`\s+\|/);
  expect(publication).toMatch(/\| Dist-tag\s+\| `latest` -> `6\.5\.7`\s+\|/);
  expect(publication).toContain(
    'sha512-UkJTvRUOiKmh+g9KjvuArWpOkwoyfPTud1Eo77xw7KPrEa4F8QFnCLl8ay4u6c9pxrHW5Ub0mbkOvihuTRQHhw=='
  );
  expect(publication).toContain('8b7cb6e2df4b26f980c8373c0551be0ea3cb286e');
  expect(publication).toContain('2,223,367');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.5.7');
  expect(publication).toContain('CLI version `6.5.7+eebc6e3`');
}

function expectV658CandidateEvidence(candidate, releaseNotes) {
  expect(candidate).toContain('# PERF-0059 v6.5.8 Release Candidate Witness');
  expect(candidate).toContain('Implementation review: #120');
  expect(candidate).toContain('Release review: #121');
  expect(candidate).toContain('a762a02ca9270b2ace05b98a3d3025c61927de2c');
  expect(candidate).toContain('8badb3194d1bed66e79dff1355cfcc765078ca11');
  expect(candidate).toContain('fd5950d5767b7c43cec56e7d5ae2adf99c5e3b30');
  expect(candidate).toContain('**PASS: 14/14 gates**');
  expect(candidate).toContain('**7,057**');
  expect(candidate).toMatch(/explicitly\s+unpublished\s+candidate/);
  expectNoV658PublicationEvidence(candidate, releaseNotes);
}

function expectV658PublishedEvidence(status, publication) {
  expect(status).toContain('**v6.5.8 artifact posture**');
  expect(status).toContain('57b40553');
  expect(status).toContain('32690361682');
  expect(publication).toContain('# PERF-0059 v6.5.8 Publication Witness');
  expect(publication).toContain(
    '- Reviewed merge commit: `57b40553703b71744c11d6c8e8c62e171683e502`'
  );
  expect(publication).toContain('- Tag object: `580636bbfd4be622c8247b577708631746175c9a`');
  expect(publication).toContain('- Peeled tag target: `57b40553703b71744c11d6c8e8c62e171683e502`');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('- Signed annotated tag: `v6.5.8`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.5.8');
  expect(publication).toContain('actions/runs/32690361682');
  expect(publication).toMatch(/\| Package\s+\| `@git-stunts\/git-cas@6\.5\.8`\s+\|/);
  expect(publication).toMatch(/\| Dist-tag\s+\| `latest` -> `6\.5\.8`\s+\|/);
  expect(publication).toContain(
    'sha512-Vi4HTS8M29rls0WH/JYXtRTQTrRrDUZUJq+JmvwxGhYrs/D2zu9F3Qbzbj6eOQnVfVOonHFv4oVbF/Q4x6DPNQ=='
  );
  expect(publication).toContain('d9b1dccdd7c37cc144deca9fb653d12ed97d7ad0');
  expect(publication).toContain('2,294,644');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.5.8');
  expect(publication).toContain('CLI version `6.5.8+57b4055`');
}

function expectV659CandidateEvidence(candidate, releaseNotes) {
  expect(candidate).toContain('# PERF-0060 v6.5.9 Release Candidate Witness');
  expect(candidate).toContain('Implementation review: #124');
  expect(candidate).toContain('Release review: #125');
  expect(candidate).toContain('eb8d617620fa8f401fb887f5b1bbc341d4746b0a');
  expect(candidate).toContain('29ba6e88c787a5e54c95a554e9166fd21aae31c0');
  expect(candidate).toContain('5512acd477bc5e5a11339d6027a03631d1a3544a');
  expect(candidate).toContain('**PASS: 14/14 gates**');
  expect(candidate).toContain('**7,141**');
  expect(candidate).toContain('**7,147**');
  expect(candidate).toMatch(/explicitly\s+unpublished\s+candidate/);
  expect(releaseNotes).toMatch(/requires no application or stored-data migration/);
  expectNoV659PublicationEvidence(candidate, releaseNotes);
}

function expectV659PublishedEvidence(status, publication) {
  expect(status).toContain('**Last tagged release:** `v6.5.9` (`2026-08-24`)');
  expect(status).toContain('**Current release state:** `v6.5.9` is published');
  expect(status).toContain('**v6.5.9 artifact posture**');
  expect(status).toContain('a16e31a9');
  expect(status).toContain('32766297971');
  expect(publication).toContain('# PERF-0060 v6.5.9 Publication Witness');
  expect(publication).toContain(
    '- Reviewed merge commit: `a16e31a9d4b0dff3b538fe8ad9ad2da31b67b275`'
  );
  expect(publication).toContain('- Tag object: `df65d8af46c5e4758ab3108272ebc849df58c29e`');
  expect(publication).toContain('- Peeled tag target: `a16e31a9d4b0dff3b538fe8ad9ad2da31b67b275`');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('- Signed annotated tag: `v6.5.9`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.5.9');
  expect(publication).toContain('actions/runs/32766297971');
  expect(publication).toMatch(/\| Package\s+\| `@git-stunts\/git-cas@6\.5\.9`\s+\|/);
  expect(publication).toMatch(/\| Dist-tag\s+\| `latest` -> `6\.5\.9`\s+\|/);
  expect(publication).toContain(
    'sha512-shlQB+EgLmzWsWTxRwLUN8rovI1wKv0N2yx43fiAxdOLTqMOOQOxSB8AMLfUmxnVd0zS+/0HIEwXF5ixl046XQ=='
  );
  expect(publication).toContain('a4fcff9ffd6c50292284903606726d6067636d56');
  expect(publication).toContain('2,318,806');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.5.9');
  expect(publication).toContain('CLI version `6.5.9+a16e31a9`');
  expect(publication).toContain('`StagingWorkspace.prototype.batch`');
}

function expectV656PublishedEvidence(status, publication) {
  expect(status).toContain('**v6.5.6 artifact posture**');
  expect(status).toContain('257e8821');
  expect(status).toContain('30526282895');
  expect(publication).toContain('# TRUST-0057 v6.5.6 Publication Witness');
  expect(publication).toContain(
    '- Reviewed merge commit: `257e8821ddb971bb922d618b7944da07a987e6c4`'
  );
  expect(publication).toContain('- Tag object: `248f3c740348e019cc0a4fb0ce8d5457dba824e2`');
  expect(publication).toContain('- Peeled tag target: `257e8821ddb971bb922d618b7944da07a987e6c4`');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('- Signed annotated tag: `v6.5.6`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.5.6');
  expect(publication).toContain('actions/runs/30526282895');
  expect(publication).toMatch(/\| Package\s+\| `@git-stunts\/git-cas@6\.5\.6`\s+\|/);
  expect(publication).toMatch(/\| Dist-tag\s+\| `latest` -> `6\.5\.6`\s+\|/);
  expect(publication).toContain(
    'sha512-pv2RSJsTpcGxiNTfxpYhripL3ievxQEgUICj5iOiIU6HV8nTs71/N1nPWr45wMNJpEJmoxzuMZw/JjAwwYJgTQ=='
  );
  expect(publication).toContain('08dfdf7a217dcd06a465d38dc8692ae4b220083d');
  expect(publication).toContain('2,218,118');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.5.6');
}

function expectV653PublishedEvidence(status, publication) {
  expect(status).toContain(v653PublishedMarker);
  expect(status).toContain('00df6077');
  expect(status).toContain('29696131557');
  expect(status).toContain('#39 v6.6.0: Operator TUI');
  expect(status).toContain('#40 v6.6.0: Agent automation follow-through');
  expect(publication).toContain('# PERF-0053 v6.5.3 Publication Witness');
  expect(publication).toContain('00df6077f1f9c111b9d0d9b636b7d746df0d2aad');
  expect(publication).toContain('efd1a1e0f9d71cf971a74d254d2661a52b366a81');
  expect(publication).toContain('01A63D8E9DBEEDE32918AF9C39560E0406CA9135');
  expect(publication).toContain('- Signed annotated tag: `v6.5.3`');
  expect(publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.5.3');
  expect(publication).toContain('actions/runs/29696131557');
  expect(publication).toMatch(/\| Package\s+\| `@git-stunts\/git-cas@6\.5\.3`\s+\|/);
  expect(publication).toMatch(/\| Dist-tag\s+\| `latest` -> `6\.5\.3`\s+\|/);
  expect(publication).toContain(
    'sha512-to7bk0BCcp0He5rSwViI7ZD0gb5CL0fFrIPbKpuIwXpuc9MBW0y5AzqvZFGicEncN4iwccEaIZm87paOfpEDrg=='
  );
  expect(publication).toContain('4010d528abfde6b49739dfa2a4dd0bf41fea4981');
  expect(publication).toContain('2,203,509');
  expect(publication).toContain('attestations/@git-stunts%2fgit-cas@6.5.3');
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

function expectV657ReleaseDocs(status) {
  const candidate = read(v657CandidatePath);
  const publication = read(v657PublicationPath);
  const releaseNotes = read('docs/releases/v6.5.7.md');

  expectV657CandidateEvidence(candidate, releaseNotes);
  expectV657PublishedEvidence(status, publication);
  expect(releaseNotes).toContain('14-step verifier with\n6,922 observed tests');
  expect(releaseNotes).toMatch(/requires no application or stored-data\s+migration/);
}

function expectV658ReleaseDocs(status) {
  const candidate = read(v658CandidatePath);
  const publication = read(v658PublicationPath);
  const releaseNotes = read('docs/releases/v6.5.8.md');

  expectV658CandidateEvidence(candidate, releaseNotes);
  expectV658PublishedEvidence(status, publication);
  expect(releaseNotes).toContain('14-step verifier with\n7,057 observed tests');
  expect(releaseNotes).toMatch(/requires no application or stored-data\s+migration/);
}

function expectV659ReleaseDocs(status) {
  const candidate = read(v659CandidatePath);
  const publication = read(v659PublicationPath);
  const releaseNotes = read('docs/releases/v6.5.9.md');

  expectV659CandidateEvidence(candidate, releaseNotes);
  expectV659PublishedEvidence(status, publication);
}

function expectCurrentQueue(status) {
  expect(status).toContain('Latest completed release goalpost:');
  expect(status).toContain('Current queued release goalposts are');
  expect(status).toContain('#39 v6.6.0: Operator TUI');
  expect(status).toContain('#40 v6.6.0: Agent automation follow-through');
  expect(status).toContain('#123 v6.5.9: Compound staging-workspace admission');
  expect(status).toContain('0060-compound-workspace-admission');
}

describe('release state docs', () => {
  it('enforces the v6.5.9 candidate history and publication evidence', () => {
    const status = read('STATUS.md');
    const [v656Candidate, v656Publication] = [v656CandidatePath, v656PublicationPath].map(read);
    const v655Candidate = read(v655CandidatePath);
    const v655Publication = read(v655PublicationPath);
    const v654Candidate = read(v654CandidatePath);
    const v654Publication = read(v654PublicationPath);
    const candidate = read(v653CandidatePath);
    const v653Publication = read(v653PublicationPath);
    const v652Candidate = read(v652CandidatePath);
    const v652Publication = read(v652PublicationPath);
    const v651Candidate = read(v651CandidatePath);
    const v653ReleaseNotes = read('docs/releases/v6.5.3.md');
    const v654ReleaseNotes = read('docs/releases/v6.5.4.md');
    const v655ReleaseNotes = read('docs/releases/v6.5.5.md');
    const v656ReleaseNotes = read('docs/releases/v6.5.6.md');
    const v652ReleaseNotes = read('docs/releases/v6.5.2.md');
    const publication = read(v651PublicationPath);
    const v650Publication = read(v650PublicationPath);
    const v640Publication = read(v640PublicationPath);

    expectV659ReleaseDocs(status);
    expectV658ReleaseDocs(status);
    expectV657ReleaseDocs(status);
    expectV656CandidateEvidence(v656Candidate);
    expectV656PublishedEvidence(status, v656Publication);
    expectV655CandidateEvidence(v655Candidate);
    expectV655PublishedEvidence(status, v655Publication);
    expectV654CandidateEvidence(v654Candidate);
    expectV654PublishedEvidence(status, v654Publication);
    expectV653CandidateEvidence(candidate);
    expectV653PublishedEvidence(status, v653Publication);
    expectV652CandidateEvidence(v652Candidate);
    expectV652PublishedEvidence(status, v652Publication);
    expectV651CandidateEvidence(v651Candidate);
    expectV651PublishedEvidence(status, publication);
    expect(v653ReleaseNotes).toContain('release verifier passed all 14 steps with 6,829');
    expect(v654ReleaseNotes).toContain('full release verifier passed all 14 steps with 6,844');
    expect(v655ReleaseNotes).toMatch(/requires no\s+migration/);
    expect(v656ReleaseNotes).toContain('14-step verifier with\n6,898 observed tests');
    expect(v656ReleaseNotes).toMatch(/requires no application or stored-data\s+migration/);
    expect(v652ReleaseNotes).toContain('passed all 14 release-verifier steps with 6,817 observed');
    expectV650PublishedEvidence(status, v650Publication);
    expectCurrentV640PublicationEvidence(v640Publication);
    expectCurrentQueue(status);
    expect(v640Publication).toContain('https://slsa.dev/provenance/v1');
    expect(v640Publication).toContain('https://github.com/git-stunts/git-cas/releases/tag/v6.4.0');
  });
});

describe('v6.5.9 candidate publication-marker calibration', () => {
  it('rejects a GitHub Release marker in candidate release notes', () => {
    const candidate = read(v659CandidatePath);
    const releaseNotes = `${read('docs/releases/v6.5.9.md')}\nhttps://github.com/git-stunts/git-cas/releases/tag/v6.5.9\n`;

    expect(() => expectV659CandidateEvidence(candidate, releaseNotes)).toThrow();
  });
});

describe('v6.5.8 candidate publication-marker calibration', () => {
  it('rejects a GitHub Release marker in candidate release notes', () => {
    const candidate = read(v658CandidatePath);
    const releaseNotes = `${read('docs/releases/v6.5.8.md')}\nhttps://github.com/git-stunts/git-cas/releases/tag/v6.5.8\n`;

    expect(() => expectV658CandidateEvidence(candidate, releaseNotes)).toThrow();
  });
});

describe('v6.5.7 candidate publication-marker calibration', () => {
  it('rejects a GitHub Release marker in candidate release notes', () => {
    const candidate = read(v657CandidatePath);
    const releaseNotes = `${read('docs/releases/v6.5.7.md')}\nhttps://github.com/git-stunts/git-cas/releases/tag/v6.5.7\n`;

    expect(() => expectV657CandidateEvidence(candidate, releaseNotes)).toThrow();
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
