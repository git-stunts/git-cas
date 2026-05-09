import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function runNodeScript(relPath) {
  return spawnSync(process.execPath, [path.join(repoRoot, relPath)], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

describe('release truth docs and examples', () => {
  it.each([
    ['examples/store-and-restore.js', 'Integrity check: PASSED'],
    ['examples/encrypted-workflow.js', 'Integrity check: PASSED'],
    ['examples/progress-tracking.js', 'Content verification: PASSED'],
  ])('keeps %s runnable under the current public API', (relPath, expectedOutput) => {
    const result = runNodeScript(relPath);

    expect(
      result.status,
      `${relPath} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    ).toBe(0);
    expect(result.stdout).toContain(expectedOutput);
  }, 30_000);

  it('keeps the API quick-start on ContentAddressableStore.open', () => {
    const api = read('docs/API.md');

    expect(api).toContain('ContentAddressableStore.open({ cwd:');
    expect(api).toContain('Any other `ContentAddressableStore` constructor option except `plumbing`');
    expect(api).toContain('Any other `ContentAddressableStore` constructor option except `codec`');
    expect(api).not.toContain('Plumbing.create({ repoPath');
  });
});

describe('Merkle manifest docs', () => {
  it('keeps Merkle threshold docs on per-operation overrides', () => {
    const walkthrough = read('docs/WALKTHROUGH.md');

    expect(walkthrough).toContain('storeFile({');
    expect(walkthrough).toContain('merkleThreshold: 500, // Per-operation override');
    expect(walkthrough).toContain('Constructor-level `merkleThreshold` remains the default');
    expect(walkthrough).not.toContain('Set `merkleThreshold` at construction time:');
  });
});

describe('release truth security docs', () => {
  it('keeps the active threat model on current v6 scheme names', () => {
    const threatModel = read('docs/THREAT_MODEL.md');

    expect(threatModel).toContain('When `convergent` encryption is active');
    expect(threatModel).toContain('use `framed` or `whole`');
    expect(threatModel).not.toContain('When `convergent-v1` encryption is active');
    expect(threatModel).not.toContain('use `framed-v2` or `whole-v2` instead');
  });

  it('keeps nonce documentation precise for convergent encryption', () => {
    const readme = read('README.md');
    const advancedGuide = read('ADVANCED_GUIDE.md');

    expect(readme).not.toContain('All encryption uses **AES-256-GCM** with 12-byte random nonces');
    expect(readme).toMatch(/`whole`\s+and\s+`framed`\s+use fresh random 96-bit nonces/);
    expect(readme).toMatch(/`convergent`\s+derives per-chunk keys\s+and nonces/);

    expect(advancedGuide).not.toContain('All use 256-bit keys,\n96-bit random nonces');
    expect(advancedGuide).toMatch(/`whole`\s+and\s+`framed`\s+use fresh 96-bit random\s+nonces/);
    expect(advancedGuide).toMatch(/`convergent`\s+derives per-chunk keys and nonces deterministically/);
  });
});

describe('v6 release documentation', () => {
  it('keeps v6 migration instructions on safe passphrase sources', () => {
    const upgrading = read('UPGRADING.md');

    expect(upgrading).toContain('npm run upgrade -- --execute --passphrase-file -');
    expect(upgrading).toContain('--passphrase-file <path>');
    expect(upgrading).toContain('--vault-passphrase-file');
    expect(upgrading).not.toMatch(/npm run upgrade -- --execute --passphrase\s+</u);
  });

  it('keeps public v6 release notes discoverable from the README', () => {
    const readme = read('README.md');
    const releaseNotes = read('docs/releases/v6.0.0.md');

    expect(readme).toContain('[v6.0.0 Release Notes](./docs/releases/v6.0.0.md)');
    expect(readme).toContain('[UPGRADING.md](./UPGRADING.md)');
    expect(readme).toContain('Existing v5 users');
    expect(releaseNotes).toContain('# git-cas v6.0.0 Release Notes');
    expect(releaseNotes).toContain('npm run upgrade');
    expect(releaseNotes).toContain('--passphrase-file -');
  });

  it('keeps the v6 changelog aligned with final migration hardening', () => {
    const changelog = read('CHANGELOG.md');

    expect(changelog).toContain('`--passphrase-file`');
    expect(changelog).toContain('vault `encryptionCount` metadata');
    expect(changelog).toContain('npm package documentation surface');
    expect(changelog).toContain('concrete support, conduct, and vulnerability reporting paths');
  });

  it('keeps the changelog JSR posture aligned with release verification', () => {
    const changelog = read('CHANGELOG.md');
    const releaseVerify = read('scripts/release/verify.js');
    const jsrConfigExists = existsSync(path.join(repoRoot, 'jsr.json'));

    expect(jsrConfigExists).toBe(true);
    expect(releaseVerify).toContain("id: 'jsr-publish'");
    expect(changelog).not.toContain('JSR support removed');
    expect(changelog).not.toContain('The JSR registry publication workflow has been removed');
    expect(changelog).toContain('JSR publication deferred for v6.0.0');
  });
});

describe('advanced guide rendering', () => {
  it('keeps the table of contents rendered as Markdown links', () => {
    const advancedGuide = read('ADVANCED_GUIDE.md');

    expect(advancedGuide).not.toContain('```insta-toc');
    expect(advancedGuide).toContain('- [Content-Defined Chunking (CDC)](#content-defined-chunking-cdc)');
    expect(advancedGuide).toContain('- [Direct CasService and Custom Port Contracts](#direct-casservice-and-custom-port-contracts)');
  });
});

describe('examples README snippets', () => {
  it('documents encrypted integrity verification with restore credentials', () => {
    const examplesReadme = read('examples/README.md');

    expect(examplesReadme).toContain('cas.verifyIntegrity(manifest, { encryptionKey: optionalKeyBytes })');
    expect(examplesReadme).toContain('Encrypted manifests require the same credentials used for restore');
  });
});
