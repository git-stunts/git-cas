import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import RestorePipeline, {
  classifyRestoreStrategy,
} from '../../../../src/domain/services/RestorePipeline.js';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

function createHandlers() {
  return {
    restoreConvergentStreaming: vi.fn(async function* restoreConvergentStreaming() {
      yield 'convergent';
    }),
    restoreConvergentCompressed: vi.fn(async function* restoreConvergentCompressed() {
      yield 'convergent-compressed';
    }),
    restoreFramedCompressedStreaming: vi.fn(async function* restoreFramedCompressedStreaming() {
      yield 'framed-compressed';
    }),
    restoreFramedStreaming: vi.fn(async function* restoreFramedStreaming() {
      yield 'framed';
    }),
    restoreBuffered: vi.fn(async function* restoreBuffered() {
      yield 'buffered';
    }),
    restoreCompressedStreaming: vi.fn(async function* restoreCompressedStreaming() {
      yield 'compressed-streaming';
    }),
    restoreStreaming: vi.fn(async function* restoreStreaming() {
      yield 'streaming';
    }),
  };
}

describe('RestorePipeline strategy classification', () => {
  it.each([
    [{ scheme: 'convergent', compression: undefined }, 'convergent'],
    [{ scheme: 'convergent', compression: { algorithm: 'gzip' } }, 'convergent-compressed'],
    [{ scheme: 'framed', compression: undefined }, 'framed'],
    [{ scheme: 'framed', compression: { algorithm: 'gzip' } }, 'framed-compressed'],
    [{ scheme: 'whole', compression: undefined }, 'buffered'],
    [{ scheme: undefined, compression: { algorithm: 'gzip' } }, 'compressed-streaming'],
    [{ scheme: undefined, compression: undefined }, 'streaming'],
  ])('classifies %j as %s', ({ scheme, compression }, expected) => {
    expect(classifyRestoreStrategy(scheme, { compression })).toBe(expected);
  });
});

describe('RestorePipeline dispatch', () => {
  it('routes restore work to the classified handler', async () => {
    const handlers = createHandlers();
    const pipeline = new RestorePipeline(handlers);
    const manifest = { compression: { algorithm: 'gzip' } };
    const encryptionMeta = { scheme: 'framed' };
    const key = new Uint8Array(32);

    await expect(collect(pipeline.restore({ manifest, key, encryptionMeta })))
      .resolves.toEqual(['framed-compressed']);

    expect(handlers.restoreFramedCompressedStreaming)
      .toHaveBeenCalledWith({ manifest, key, encryptionMeta });
    expect(handlers.restoreStreaming).not.toHaveBeenCalled();
  });
});

describe('CasService restore strategy boundary', () => {
  it('delegates restore strategy selection to RestorePipeline', () => {
    const source = read('src/domain/services/CasService.js');

    expect(source).toContain("from './RestorePipeline.js'");
    expect(source).not.toContain('_classifyRestoreStrategy');
    expect(source).not.toContain('_executeRestoreStrategy');
    expect(source).not.toContain("case 'convergent'");
  });
});
