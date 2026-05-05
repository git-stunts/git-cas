import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
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

function targetWithoutTitle(rawTarget) {
  const trimmed = rawTarget.trim();
  if (!trimmed.startsWith('<')) {
    return trimmed.split(/\s+/)[0];
  }

  const close = trimmed.indexOf('>');
  return close === -1 ? trimmed.slice(1) : trimmed.slice(1, close);
}

function markdownTargets(markdown) {
  return [...stripCodeFences(markdown).matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)]
    .map((match) => targetWithoutTitle(match[1]).split('#')[0])
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

function trackedMarkdownFiles() {
  const output = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).trim();
  return output ? output.split('\n') : [];
}

function normalizeTarget(sourceFile, target) {
  return path.normalize(path.join(path.dirname(sourceFile), target)).replaceAll(path.sep, '/');
}

function shouldShipWithDocs(target) {
  return target.endsWith('.md') || target.startsWith('docs/') || target.startsWith('examples/');
}

function packagedMarkdownFiles(files) {
  return trackedMarkdownFiles().filter((file) => isIncludedByPackageFiles(file, files));
}

function unpackagedLinkedDocs(sourceFile, files) {
  return markdownTargets(read(sourceFile))
    .map((target) => normalizeTarget(sourceFile, target))
    .filter(shouldShipWithDocs)
    .filter((target) => !isIncludedByPackageFiles(target, files))
    .map((target) => `${sourceFile} -> ${target}`);
}

describe('package documentation surface', () => {
  it('keeps README relative documentation links inside the npm package', () => {
    const files = packageFiles();
    const missing = markdownTargets(read('README.md'))
      .filter((target) => target.endsWith('.md') || target.startsWith('docs/'))
      .filter((target) => !isIncludedByPackageFiles(target, files));

    expect(missing).toEqual([]);
  });

  it('keeps local documentation links closed across packaged Markdown files', () => {
    const files = packageFiles();
    const missing = packagedMarkdownFiles(files).flatMap((file) => unpackagedLinkedDocs(file, files));

    expect(missing).toEqual([]);
  });
});
