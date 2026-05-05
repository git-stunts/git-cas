import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

  it('keeps the API quick-start plumbing constructor aligned with @git-stunts/plumbing', () => {
    const api = read('docs/API.md');

    expect(api).toContain('GitPlumbing.createDefault({ cwd:');
    expect(api).not.toContain('Plumbing.create({ repoPath');
  });

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
