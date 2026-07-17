import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

describe('pre-push hook', () => {
  it('clears repository-local Git variables before invoking child tools', () => {
    const source = readFileSync(path.join(repoRoot, 'scripts/hooks/pre-push'), 'utf8');
    const enumeratePosition = source.indexOf('git rev-parse --local-env-vars');
    const unsetPosition = source.indexOf('unset "$git_var"');
    const lintPosition = source.indexOf('pnpm run lint');
    const testPosition = source.indexOf('pnpm test');

    expect(enumeratePosition).toBeGreaterThan(-1);
    expect(unsetPosition).toBeGreaterThan(-1);
    expect(lintPosition).toBeGreaterThan(enumeratePosition);
    expect(lintPosition).toBeGreaterThan(unsetPosition);
    expect(testPosition).toBeGreaterThan(enumeratePosition);
    expect(testPosition).toBeGreaterThan(unsetPosition);
  });
});
