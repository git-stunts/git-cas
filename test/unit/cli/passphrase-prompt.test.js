import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPassphraseFile } from '../../../bin/ui/passphrase-prompt.js';

describe('readPassphraseFile', () => {
  const tmpPath = join(tmpdir(), `test-passphrase-${Date.now()}.txt`);

  afterEach(async () => {
    try { await unlink(tmpPath); } catch { /* may not exist */ }
  });

  it('reads from file and trims trailing newline', async () => {
    await writeFile(tmpPath, 'my-secret\n', 'utf8');
    const result = await readPassphraseFile(tmpPath);
    expect(result).toBe('my-secret');
  });

  it('preserves content without trailing newline', async () => {
    await writeFile(tmpPath, 'no-newline', 'utf8');
    const result = await readPassphraseFile(tmpPath);
    expect(result).toBe('no-newline');
  });

  it('preserves internal newlines', async () => {
    await writeFile(tmpPath, 'line1\nline2\n', 'utf8');
    const result = await readPassphraseFile(tmpPath);
    expect(result).toBe('line1\nline2');
  });
});
