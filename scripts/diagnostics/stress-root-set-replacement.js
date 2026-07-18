import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import ContentAddressableStore from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';

const iterations = positiveSafeInteger(process.argv[2] ?? '500');
const repoDir = mkdtempSync(path.join(tmpdir(), 'cas-root-race-'));
const git = (args) =>
  execFileSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim();

try {
  git(['init', '--bare']);
  const plumbing = await createGitPlumbing({ cwd: repoDir });
  const cas = new ContentAddressableStore({ plumbing });

  for (let index = 0; index < iterations; index += 1) {
    const namespace = `stress/${index}`;
    const left = await cas.caches.open({ namespace });
    const right = await cas.caches.open({ namespace });
    const original = await cas.pages.put({ source: Buffer.from(`original-${index}`) });
    const leftPage = await cas.pages.put({ source: Buffer.from(`left-${index}`) });
    const rightPage = await cas.pages.put({ source: Buffer.from(`right-${index}`) });
    await left.put('shared', original.handle);

    const results = await Promise.all([
      left.replace('shared', leftPage.handle, { expectedHandle: original.handle }),
      right.replace('shared', rightPage.handle, { expectedHandle: original.handle }),
    ]);
    if (results.filter((result) => result.accepted).length !== 1) {
      throw new Error(
        `Expected exactly one replacement winner at iteration ${index}: ${inspect(results, { depth: 8 })}`
      );
    }
  }

  process.stdout.write(`${JSON.stringify({ iterations, passed: iterations })}\n`);
} finally {
  rmSync(repoDir, { recursive: true, force: true });
}

function positiveSafeInteger(raw) {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError('iterations must be a positive safe integer');
  }
  return parsed;
}
