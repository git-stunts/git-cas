import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
    expect(bijouDeps).toEqual(bijouDeps.map(([name]) => [name, '^5.0.0']));
  });
});
