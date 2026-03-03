import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { storeFile, restoreFile } from '../../../../src/infrastructure/adapters/FileIOHelper.js';

describe('FileIOHelper – storeFile', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fio-store-')); });
  afterEach(() => { if (tmpDir) { rmSync(tmpDir, { recursive: true, force: true }); } });

  it('passes a readable stream and options to service.store()', async () => {
    const filePath = path.join(tmpDir, 'input.bin');
    const data = Buffer.from('hello storeFile');
    writeFileSync(filePath, data);

    let capturedOpts;
    const mockService = {
      async store(opts) {
        const chunks = [];
        for await (const chunk of opts.source) { chunks.push(chunk); }
        capturedOpts = { ...opts, source: Buffer.concat(chunks) };
        return { slug: opts.slug };
      },
    };

    const result = await storeFile(mockService, { filePath, slug: 'test-slug' });
    expect(result).toEqual({ slug: 'test-slug' });
    expect(capturedOpts.source.equals(data)).toBe(true);
    expect(capturedOpts.slug).toBe('test-slug');
    expect(capturedOpts.filename).toBe('input.bin');
  });

  it('uses filename override when provided', async () => {
    const filePath = path.join(tmpDir, 'input.bin');
    writeFileSync(filePath, 'data');

    let capturedFilename;
    const mockService = {
      async store(opts) {
        // eslint-disable-next-line no-unused-vars
        for await (const _ of opts.source) { /* drain */ }
        capturedFilename = opts.filename;
        return {};
      },
    };

    await storeFile(mockService, { filePath, slug: 's', filename: 'custom.dat' });
    expect(capturedFilename).toBe('custom.dat');
  });
});

describe('FileIOHelper – restoreFile', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'fio-restore-')); });
  afterEach(() => { if (tmpDir) { rmSync(tmpDir, { recursive: true, force: true }); } });

  it('writes restored chunks to the output path and counts bytes', async () => {
    const outputPath = path.join(tmpDir, 'output.bin');
    const chunk1 = Buffer.from('hello ');
    const chunk2 = Buffer.from('world');

    const mockService = {
      restoreStream() {
        return (async function* gen() {
          yield chunk1;
          yield chunk2;
        })();
      },
    };

    const { bytesWritten } = await restoreFile(mockService, {
      manifest: {},
      outputPath,
    });

    expect(bytesWritten).toBe(11);
    const written = readFileSync(outputPath);
    expect(written.toString()).toBe('hello world');
  });
});
