import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const markdownLinkIt = existsSync(path.join(repoRoot, '.git')) ? it : it.skip;

function trackedMarkdownFiles() {
  const output = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).trim();
  return output
    ? output.split('\n').filter((file) => existsSync(path.join(repoRoot, file)))
    : [];
}

function stripCodeFences(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '');
}

function inlineLinks(markdown) {
  return [...stripCodeFences(markdown).matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)]
    .map((match) => match[1]);
}

function targetWithoutTitle(rawTarget) {
  const trimmed = rawTarget.trim();
  if (!trimmed.startsWith('<')) {
    return trimmed.split(/\s+/)[0];
  }

  const close = trimmed.indexOf('>');
  return close === -1 ? trimmed.slice(1) : trimmed.slice(1, close);
}

function localPathTarget(rawTarget) {
  const target = targetWithoutTitle(rawTarget).split('#')[0];
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return undefined;
  }
  return decodeURIComponent(target);
}

function isInsideRepo(absPath) {
  const rel = path.relative(repoRoot, absPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

describe('markdown links', () => {
  markdownLinkIt('keeps tracked relative markdown links pointed at existing files', () => {
    const broken = [];

    for (const file of trackedMarkdownFiles()) {
      const markdown = readFileSync(path.join(repoRoot, file), 'utf8');
      for (const rawTarget of inlineLinks(markdown)) {
        const target = localPathTarget(rawTarget);
        if (target === undefined) { continue; }

        const absTarget = path.resolve(path.dirname(path.join(repoRoot, file)), target);
        if (!isInsideRepo(absTarget) || !existsSync(absTarget)) {
          broken.push(`${file}: ${rawTarget}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });
});
