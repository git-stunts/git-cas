import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRestoreOutputTarget } from '../../../bin/restore-output-target.js';

describe('resolveRestoreOutputTarget', () => {
  it('keeps relative CLI output paths anchored to the invocation cwd', () => {
    const target = resolveRestoreOutputTarget('sub/restored.bin', { cwd: '/work/project' });

    expect(target).toEqual({
      outputPath: path.resolve('/work/project/sub/restored.bin'),
      baseDirectory: path.resolve('/work/project/sub'),
    });
  });

  it('treats an absolute CLI output path as explicit authority to its parent directory', () => {
    const target = resolveRestoreOutputTarget('/tmp/git-cas-output/restored.bin', {
      cwd: '/work/project',
    });

    expect(target).toEqual({
      outputPath: path.resolve('/tmp/git-cas-output/restored.bin'),
      baseDirectory: path.resolve('/tmp/git-cas-output'),
    });
  });
});
