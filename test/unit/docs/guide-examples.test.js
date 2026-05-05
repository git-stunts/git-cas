import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import ContentAddressableStore from '../../../index.js';

const repoRoot = process.cwd();
const hasGuide = existsSync(path.join(repoRoot, 'GUIDE.md'));
const guideFenceIt = hasGuide ? it : it.skip;

function guideMarkdown() {
  return readFileSync(path.join(repoRoot, 'GUIDE.md'), 'utf8');
}

function fencedBlocks(markdown, language) {
  return [...markdown.matchAll(/```(\w+)?\n([\s\S]*?)```/g)]
    .map((match, index) => ({ index: index + 1, language: match[1] ?? '', code: match[2] }))
    .filter((block) => block.language === language);
}

function stripEsmImports(code) {
  const kept = [];
  let insideImport = false;

  for (const line of code.split('\n')) {
    const trimmed = line.trim();
    if (!insideImport && /^import\b/.test(trimmed)) {
      insideImport = !trimmed.endsWith(';');
      continue;
    }
    if (insideImport) {
      insideImport = !trimmed.endsWith(';');
      continue;
    }
    kept.push(line);
  }

  return kept.join('\n');
}

function assertParsesAsAsyncBody(code) {
  new Function(`return async () => {\n${stripEsmImports(code)}\n};`);
}

function initBareRepo(cwd) {
  const result = spawnSync('git', ['init', '--bare'], { cwd, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${result.stderr ?? result.stdout ?? 'git init --bare failed'}`.trim());
  }
}

function configureGitIdentity(gitDir) {
  for (const [key, value] of [
    ['user.email', 'git-cas-tests@example.com'],
    ['user.name', 'git-cas tests'],
  ]) {
    const result = spawnSync('git', ['--git-dir', gitDir, 'config', key, value], { encoding: 'utf8' });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`${result.stderr ?? result.stdout ?? `git config ${key} failed`}`.trim());
    }
  }
}

function expectBytesEqual(actual, expected) {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBe(expected[index]);
  }
}

describe('GUIDE examples', () => {
  guideFenceIt('keeps JavaScript fences syntactically valid', () => {
    const failures = [];

    for (const block of fencedBlocks(guideMarkdown(), 'js')) {
      try {
        assertParsesAsAsyncBody(block.code);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`JS block ${block.index}: ${message}`);
      }
    }

    expect(failures).toEqual([]);
  });

  guideFenceIt('keeps JSON fences valid', () => {
    for (const block of fencedBlocks(guideMarkdown(), 'json')) {
      expect(() => JSON.parse(block.code)).not.toThrow();
    }
  });
});

describe('GUIDE quick start', () => {
  it('keeps the quick-start facade methods present on the public API', () => {
    expect(typeof ContentAddressableStore.open).toBe('function');
    expect(typeof ContentAddressableStore.createJson).toBe('function');
    for (const method of ['storeFile', 'createTree', 'addToVault', 'readManifest', 'restore']) {
      expect(typeof ContentAddressableStore.prototype[method]).toBe('function');
    }
  });

  it('keeps the documented library quick-start workflow working', async () => {
    const repoDir = mkdtempSync(path.join(os.tmpdir(), 'cas-guide-example-'));
    const original = new Uint8Array([0x67, 0x69, 0x74, 0x2d, 0x63, 0x61, 0x73]);

    try {
      initBareRepo(repoDir);
      configureGitIdentity(repoDir);
      const inputPath = path.join(repoDir, 'photo.jpg');
      writeFileSync(inputPath, original);

      const cas = ContentAddressableStore.open({ cwd: repoDir });
      const manifest = await cas.storeFile({ filePath: inputPath, slug: 'photos/vacation' });
      const treeOid = await cas.createTree({ manifest });
      await cas.addToVault({ slug: 'photos/vacation', treeOid });
      const readBack = await cas.readManifest({ treeOid });
      const { buffer } = await cas.restore({ manifest: readBack });

      expectBytesEqual(buffer, original);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
