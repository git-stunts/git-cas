import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function maintainerEmail() {
  const pkg = JSON.parse(read('package.json'));
  return pkg.author.match(/<([^>]+)>/u)?.[1];
}

describe('support and reporting docs', () => {
  it('publishes a concrete private contact for support and conduct reports', () => {
    const email = maintainerEmail();
    const support = read('SUPPORT.md');
    const conduct = read('CODE_OF_CONDUCT.md');

    expect(email).toBe('james@flyingrobots.dev');
    expect(support).toContain('## Maintainer Contact');
    expect(support).toContain(`mailto:${email}`);
    expect(conduct).toContain(`mailto:${email}`);
    expect(conduct).not.toContain('maintainer listed in');
  });

  it('publishes a private vulnerability reporting path in the security model', () => {
    const email = maintainerEmail();
    const security = read('SECURITY.md');

    expect(security).toContain('## Reporting Vulnerabilities');
    expect(security).toContain('Do not open public issues for suspected vulnerabilities');
    expect(security).toContain(`mailto:${email}`);
  });
});
