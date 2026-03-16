import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../../bin/git-cas.js');
const { version } = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));

const RUNTIME_CMD = globalThis.Bun
  ? ['bun', 'run', BIN]
  : globalThis.Deno
    ? ['deno', 'run', '-A', BIN]
    : ['node', BIN];

describe('git-cas --version', () => {
  it('matches package metadata', () => {
    const result = spawnSync(RUNTIME_CMD[0], [...RUNTIME_CMD.slice(1), '--version'], {
      encoding: 'utf8',
      timeout: 30_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(`${result.stdout ?? ''}`.trim()).toBe(version);
    expect(`${result.stderr ?? ''}`).toBe('');
  });
});
