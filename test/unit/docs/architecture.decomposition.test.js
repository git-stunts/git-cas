import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('architecture decomposition plan', () => {
  it('publishes the CasService decomposition trajectory in architecture truth', () => {
    const architecture = read('ARCHITECTURE.md');

    expect(architecture).toContain('## CasService Decomposition Trajectory');
    expect(architecture).toContain('Store write coordination');
    expect(architecture).toContain('Manifest and tree publication');
    expect(architecture).toContain('Recipient mutation flows');
    expect(architecture).toContain('Restore pipeline extraction');
    expect(architecture).toContain('public `CasService` facade');
  });
});
