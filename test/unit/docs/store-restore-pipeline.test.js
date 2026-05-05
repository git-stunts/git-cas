import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const pipelineDocPath = path.join(repoRoot, 'docs/STORE_RESTORE_PIPELINE.md');

function readPipelineDoc() {
  return readFileSync(pipelineDocPath, 'utf8');
}

describe('store/restore pipeline documentation', () => {
  it('documents the maintainer state machines for store and restore', () => {
    expect(existsSync(pipelineDocPath)).toBe(true);

    const doc = readPipelineDoc();

    expect(doc).toContain('# Store And Restore Pipeline State Machines');
    expect(doc).toContain('## Store State Machine');
    expect(doc).toContain('## Restore State Machine');
    expect(doc).toContain('## Tree And Vault Publication Boundaries');
    expect(doc).toContain('State: Resolve Encryption');
    expect(doc).toContain('State: Dispatch Chunks');
    expect(doc).toContain('State: Select Restore Plan');
    expect(doc).toContain('State: Verify And Emit Bytes');
  });
});
