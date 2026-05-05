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
});
