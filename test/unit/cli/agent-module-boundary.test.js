import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('agent CLI module boundary', () => {
  it('keeps bin/agent/cli.js as the protocol shell', () => {
    const source = read('bin/agent/cli.js');

    expect(source.split('\n').length).toBeLessThan(120);
    expect(source).not.toContain("from '../../index.js'");
    expect(source).not.toContain("from '../ui/");
    expect(source).not.toContain('ContentAddressableStore');
    expect(source).not.toContain('buildVaultStats');
    expect(source).not.toContain('inspectVaultHealth');
    expect(source).not.toContain('filterEntries');
  });

  it('keeps command implementations in the commands module', () => {
    expect(existsSync(path.join(repoRoot, 'bin/agent/commands/index.js'))).toBe(true);
    const source = read('bin/agent/commands/index.js');
    expect(source).toContain('executeAgentCommand');
    expect(source).toContain('storeCommand');
    expect(source).toContain('vaultInitCommand');
  });

  it('keeps shared request parsing out of the command dispatcher', () => {
    expect(existsSync(path.join(repoRoot, 'bin/agent/input.js'))).toBe(true);
    const inputSource = read('bin/agent/input.js');
    const commandSource = read('bin/agent/commands/index.js');

    expect(inputSource).toContain('parseAgentInput');
    expect(inputSource).toContain('validateCredentialSources');
    expect(commandSource).not.toContain("from 'node:util'");
    expect(commandSource).not.toContain("from 'node:fs'");
    expect(commandSource).not.toContain('INPUT_ALIAS_MAP');
  });
});
