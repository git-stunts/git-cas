import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const requiredStandardDocs = [
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  'docs/EXTENDING.md',
  'docs/releases/v6.0.0.md',
];
const forbiddenPackagePrefixes = [
  'docs/audit/',
  'docs/archive/',
  'docs/method/',
];
const forbiddenPackageFiles = [
  'docs/cli.gif',
  'docs/vault.gif',
];

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

let packedFileCache;

function packedFiles() {
  if (!packedFileCache) {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
    const [pack] = JSON.parse(output);
    packedFileCache = new Set(pack.files.map((file) => file.path));
  }
  return packedFileCache;
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

function isPackaged(target, files) {
  return files.has(target);
}

function normalizeTarget(sourceFile, target) {
  return path.normalize(path.join(path.dirname(sourceFile), target)).replaceAll(path.sep, '/');
}

function shouldShipWithDocs(target) {
  return target.endsWith('.md') || target.startsWith('docs/') || target.startsWith('examples/');
}

function publicPackagedMarkdownFiles(files) {
  return [
    'README.md',
    'GUIDE.md',
    'ADVANCED_GUIDE.md',
    'ARCHITECTURE.md',
    'SECURITY.md',
    'SUPPORT.md',
    'CODE_OF_CONDUCT.md',
    'UPGRADING.md',
    'docs/API.md',
    'docs/EXTENDING.md',
    'docs/releases/v6.0.0.md',
    'docs/THREAT_MODEL.md',
    'docs/WALKTHROUGH.md',
  ].filter((file) => files.has(file));
}

function unpackagedLinkedDocs(sourceFile, files) {
  return markdownTargets(read(sourceFile))
    .map((target) => normalizeTarget(sourceFile, target))
    .filter(shouldShipWithDocs)
    .filter((target) => !isPackaged(target, files))
    .map((target) => `${sourceFile} -> ${target}`);
}

function isForbiddenPackageArtifact(file) {
  if (forbiddenPackageFiles.includes(file)) {
    return true;
  }
  for (const prefix of forbiddenPackagePrefixes) {
    if (file.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

describe('package documentation surface', () => {
  it('keeps standard repository docs present and packaged', () => {
    const files = packedFiles();

    const missing = requiredStandardDocs.filter((file) => !existsSync(path.join(repoRoot, file)));
    const unpackaged = requiredStandardDocs.filter((file) => !isPackaged(file, files));

    expect(missing).toEqual([]);
    expect(unpackaged).toEqual([]);
  });

  it('keeps README relative documentation links inside the npm package', () => {
    const files = packedFiles();
    const missing = markdownTargets(read('README.md'))
      .filter((target) => target.endsWith('.md') || target.startsWith('docs/'))
      .filter((target) => !isPackaged(target, files));

    expect(missing).toEqual([]);
  });

  it('keeps local documentation links closed across public packaged Markdown files', () => {
    const files = packedFiles();
    const missing = publicPackagedMarkdownFiles(files)
      .flatMap((file) => unpackagedLinkedDocs(file, files));

    expect(missing).toEqual([]);
  });
});

describe('package internal artifact exclusions', () => {
  it('keeps internal audit, planning, archive, and unused media out of the npm package', () => {
    const files = [...packedFiles()];
    const leaked = files.filter(isForbiddenPackageArtifact);

    expect(leaked).toEqual([]);
    expect(files).toContain('docs/demo.gif');
  });
});
