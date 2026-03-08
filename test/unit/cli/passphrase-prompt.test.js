import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPassphraseFile } from '../../../bin/ui/passphrase-prompt.js';

const tmpPath = join(tmpdir(), `test-passphrase-${Date.now()}.txt`);

afterEach(async () => {
  try { await unlink(tmpPath); } catch { /* may not exist */ }
});

describe('readPassphraseFile', () => {
  it('reads from file and trims trailing newline', async () => {
    await writeFile(tmpPath, 'my-secret\n', { mode: 0o600 });
    const result = await readPassphraseFile(tmpPath);
    expect(result).toBe('my-secret');
  });

  it('preserves content without trailing newline', async () => {
    await writeFile(tmpPath, 'no-newline', { mode: 0o600 });
    const result = await readPassphraseFile(tmpPath);
    expect(result).toBe('no-newline');
  });

  it('preserves internal newlines', async () => {
    await writeFile(tmpPath, 'line1\nline2\n', { mode: 0o600 });
    const result = await readPassphraseFile(tmpPath);
    expect(result).toBe('line1\nline2');
  });

  it('strips trailing CRLF (Windows line ending)', async () => {
    await writeFile(tmpPath, 'win-secret\r\n', { mode: 0o600 });
    const result = await readPassphraseFile(tmpPath);
    expect(result).toBe('win-secret');
  });
});

describe('readPassphraseFile — empty passphrase rejection', () => {
  it('rejects file containing only LF', async () => {
    await writeFile(tmpPath, '\n', { mode: 0o600 });
    await expect(readPassphraseFile(tmpPath)).rejects.toThrow('Passphrase must not be empty');
  });

  it('rejects file containing only CRLF', async () => {
    await writeFile(tmpPath, '\r\n', { mode: 0o600 });
    await expect(readPassphraseFile(tmpPath)).rejects.toThrow('Passphrase must not be empty');
  });
});

describe('readPassphraseFile — permission warnings', () => {
  it('warns on group/world-readable file permissions', async () => {
    const writeSpy = [];
    const origWrite = process.stderr.write;
    process.stderr.write = (/** @type {any} */ chunk) => { writeSpy.push(String(chunk)); return true; };
    try {
      await writeFile(tmpPath, 'secret\n', { mode: 0o644 });
      await readPassphraseFile(tmpPath);
      expect(writeSpy.some((s) => s.includes('permissions'))).toBe(true);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it('no warning for restricted file permissions', async () => {
    const writeSpy = [];
    const origWrite = process.stderr.write;
    process.stderr.write = (/** @type {any} */ chunk) => { writeSpy.push(String(chunk)); return true; };
    try {
      await writeFile(tmpPath, 'secret\n', { mode: 0o600 });
      await readPassphraseFile(tmpPath);
      expect(writeSpy.some((s) => s.includes('permissions'))).toBe(false);
    } finally {
      process.stderr.write = origWrite;
    }
  });
});
