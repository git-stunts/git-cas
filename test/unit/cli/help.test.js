import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../../../bin/git-cas.js');
const RUNTIME_CMD = globalThis.Bun
  ? ['bun', 'run', BIN]
  : globalThis.Deno
    ? ['deno', 'run', '-A', BIN]
    : ['node', BIN];

function runHelp(args) {
  const result = spawnSync(RUNTIME_CMD[0], [...RUNTIME_CMD.slice(1), ...args, '--help'], {
    encoding: 'utf8',
    timeout: 30_000,
  });

  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(0);
  expect(`${result.stderr ?? ''}`).toBe('');
  return `${result.stdout ?? ''}`.replace(/\s+/g, ' ');
}

describe('git-cas help text', () => {
  it.each([
    ['store', ['store'], 'Vault-level passphrase for encryption'],
    ['restore', ['restore'], 'Vault-level passphrase for decryption'],
    ['vault init', ['vault', 'init'], 'Passphrase for vault-level encryption'],
  ])('keeps %s passphrase-source guidance stable', (_name, args, description) => {
    const help = runHelp(args);

    expect(help).toContain('--vault-passphrase <pass>');
    expect(help).toContain(description);
    expect(help).toContain('prefer --vault-passphrase-file -, GIT_CAS_PASSPHRASE, or --os-keychain-target');
    expect(help).toContain('--vault-passphrase-file <path>');
    expect(help).toContain('--os-keychain-target <target>');
  });

  it('keeps vault rotate inline passphrase warnings stable', () => {
    const help = runHelp(['vault', 'rotate']);

    expect(help).toContain('--old-passphrase <pass>');
    expect(help).toContain('Current vault passphrase (warns; prefer --old-passphrase-file -)');
    expect(help).toContain('--new-passphrase <pass>');
    expect(help).toContain('New vault passphrase (warns; prefer --new-passphrase-file -)');
    expect(help).toContain('--old-passphrase-file <path>');
    expect(help).toContain('--new-passphrase-file <path>');
  });
});
