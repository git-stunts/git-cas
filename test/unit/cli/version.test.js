import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_VERSION } from '../../../src/package-version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../../bin/git-cas.js');
const { version } = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
const { version: jsrVersion } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../jsr.json'), 'utf8')
);

const RUNTIME_CMD = globalThis.Bun
  ? ['bun', 'run', BIN]
  : globalThis.Deno
    ? ['deno', 'run', '-A', BIN]
    : ['node', BIN];

describe('git-cas --version', () => {
  it('keeps the package-version export in sync with package metadata', () => {
    expect(PACKAGE_VERSION).toBe(version);
  });

  it('keeps npm and JSR package metadata on the same version', () => {
    expect(jsrVersion).toBe(version);
  });

  it('matches package metadata', () => {
    const result = spawnSync(RUNTIME_CMD[0], [...RUNTIME_CMD.slice(1), '--version'], {
      encoding: 'utf8',
      timeout: 30_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    const output = `${result.stdout ?? ''}`.trim();
    expect(output.startsWith(version)).toBe(true);
    // In dev: "5.3.3+abc1234" (version+sha). In CI/published: "5.3.3" or "5.3.3+abc1234".
    expect(output).toMatch(new RegExp(`^${version.replace(/\./g, '\\.')}(\\+[0-9a-f]+)?$`));
    expect(`${result.stderr ?? ''}`).toBe('');
  });
});
