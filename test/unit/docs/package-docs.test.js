import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function packageFiles() {
  return JSON.parse(read('package.json')).files ?? [];
}

function stripCodeFences(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '');
}

function markdownTargets(markdown) {
  return [...stripCodeFences(markdown).matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter((target) => target && !/^[a-z][a-z0-9+.-]*:/i.test(target))
    .map((target) => target.replace(/^\.\//, ''));
}

function isIncludedByPackageFiles(target, files) {
  return files.some((entry) => {
    if (entry === target) {
      return true;
    }
    const directory = entry.endsWith('/') ? entry : `${entry}/`;
    return target.startsWith(directory);
  });
}

describe('package documentation surface', () => {
  it('keeps README relative documentation links inside the npm package', () => {
    const files = packageFiles();
    const missing = markdownTargets(read('README.md'))
      .filter((target) => target.endsWith('.md') || target.startsWith('docs/'))
      .filter((target) => !isIncludedByPackageFiles(target, files));

    expect(missing).toEqual([]);
  });
});
