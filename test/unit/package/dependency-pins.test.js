import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();

function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function isExactVersion(version) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

describe('dependency pins', () => {
  it('pins commander to an exact version for stable CLI parsing', () => {
    const manifest = readJson('package.json');
    const lockfile = readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');

    expect(manifest.dependencies.commander).toBeDefined();
    expect(isExactVersion(manifest.dependencies.commander)).toBe(true);
    expect(lockfile).toContain(`specifier: ${manifest.dependencies.commander}`);
  });

  it('keeps Bijou family dependencies on the same caretaker range', () => {
    const manifest = readJson('package.json');
    const bijouDeps = Object.entries(manifest.dependencies)
      .filter(([name]) => name.startsWith('@flyingrobots/bijou'))
      .sort(([a], [b]) => a.localeCompare(b));

    expect(bijouDeps.length).toBeGreaterThan(0);
    expect(bijouDeps).toEqual(bijouDeps.map(([name]) => [name, '^7.2.0']));
  });
});

describe('release package scripts', () => {
  it('stamps build metadata before package dry-runs without contaminating npm pack JSON', () => {
    const manifest = readJson('package.json');

    expect(manifest.scripts.prepack).toBe('node scripts/stamp-build.js --quiet');
  });

  it('supports quiet build metadata stamping for JSON pack consumers', () => {
    const output = execFileSync('node', ['scripts/stamp-build.js', '--quiet'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(output).toBe('');
  });

  it('supports build metadata stamping outside git checkouts', () => {
    const outsideGit = mkdtempSync(path.join(tmpdir(), 'git-cas-stamp-'));

    try {
      const output = execFileSync(
        'node',
        [path.join(repoRoot, 'scripts/stamp-build.js'), '--quiet'],
        {
          cwd: outsideGit,
          encoding: 'utf8',
        }
      );
      const buildInfo = readJson('build-info.json');

      expect(output).toBe('');
      expect(buildInfo.sha).toMatch(/^(?:unknown|[a-f0-9]{7,64})$/u);
    } finally {
      rmSync(outsideGit, { recursive: true, force: true });
    }
  });
});
