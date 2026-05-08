import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

describe('VaultService source layout', () => {
  it('keeps the fileoverview comment before imports', () => {
    const source = readFileSync(
      path.join(repoRoot, 'src/domain/services/VaultService.js'),
      'utf8',
    );

    expect(source.trimStart()).toMatch(/^\/\*\*\n \* @fileoverview/u);
  });
});
