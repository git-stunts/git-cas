import { describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const hookPath = path.join(repoRoot, 'scripts/hooks/pre-push');

describe('pre-push hook', () => {
  it('clears repository-local Git variables before invoking quality gates', () => {
    const fixture = createFixture({ gitExitCode: 0 });

    try {
      const result = runHook(fixture);

      expect(result.status).toBe(0);
      expect(readFileSync(fixture.logPath, 'utf8').trim().split('\n')).toEqual([
        'unset|unset|run lint',
        'unset|unset|test',
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed before quality gates when Git variable discovery fails', () => {
    const fixture = createFixture({ gitExitCode: 42 });

    try {
      const result = runHook(fixture);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Failed to discover repository-local Git environment variables.');
      expect(existsSync(fixture.logPath)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });
});

function createFixture({ gitExitCode }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'git-cas-pre-push-'));
  const binPath = path.join(root, 'bin');
  const logPath = path.join(root, 'pnpm.log');
  const gitPath = path.join(binPath, 'git');
  const pnpmPath = path.join(binPath, 'pnpm');

  writeExecutable(
    gitPath,
    `#!/usr/bin/env bash\nif [[ ${gitExitCode} -ne 0 ]]; then exit ${gitExitCode}; fi\nprintf 'GIT_DIR\\nGIT_WORK_TREE\\n'\n`,
  );
  writeExecutable(
    pnpmPath,
    `#!/usr/bin/env bash\nprintf '%s|%s|%s\\n' "\${GIT_DIR-unset}" "\${GIT_WORK_TREE-unset}" "$*" >> "$HOOK_LOG"\n`,
  );

  return {
    binPath,
    logPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runHook(fixture) {
  return spawnSync('bash', [hookPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture.binPath}:${process.env.PATH}`,
      GIT_DIR: '/contaminating/repository',
      GIT_WORK_TREE: '/contaminating/worktree',
      HOOK_LOG: fixture.logPath,
    },
  });
}

function writeExecutable(filePath, source) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
  chmodSync(filePath, 0o755);
}
