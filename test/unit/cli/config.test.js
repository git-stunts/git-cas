import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, mergeConfig } from '../../../bin/config.js';

const tmpDir = join(tmpdir(), `casrc-test-${Date.now()}`);

function setup() {
  mkdirSync(tmpDir, { recursive: true });
}

function teardown() {
  rmSync(tmpDir, { recursive: true, force: true });
}

describe('loadConfig', () => {
  afterEach(teardown);

  it('returns empty object when .casrc does not exist', () => {
    setup();
    expect(loadConfig(tmpDir)).toEqual({});
  });

  it('loads valid JSON from .casrc', () => {
    setup();
    writeFileSync(join(tmpDir, '.casrc'), JSON.stringify({ chunkSize: 65536, strategy: 'cdc' }));
    const config = loadConfig(tmpDir);
    expect(config.chunkSize).toBe(65536);
    expect(config.strategy).toBe('cdc');
  });

  it('throws on invalid JSON', () => {
    setup();
    writeFileSync(join(tmpDir, '.casrc'), '{bad json');
    expect(() => loadConfig(tmpDir)).toThrow(/invalid JSON/);
  });

  it('throws on non-object JSON', () => {
    setup();
    writeFileSync(join(tmpDir, '.casrc'), '"just a string"');
    expect(() => loadConfig(tmpDir)).toThrow(/expected a JSON object/);
  });

  it('throws on array JSON', () => {
    setup();
    writeFileSync(join(tmpDir, '.casrc'), '[1, 2, 3]');
    expect(() => loadConfig(tmpDir)).toThrow(/expected a JSON object/);
  });
});

describe('mergeConfig — CLI overrides', () => {
  it('CLI flags override config', () => {
    const { casConfig } = mergeConfig({ chunkSize: 4096, strategy: 'fixed' }, { chunkSize: 65536 });
    expect(casConfig.chunkSize).toBe(4096);
    expect(casConfig.chunking).toEqual({ strategy: 'fixed', chunkSize: 4096 });
  });

  it('config fills in when CLI omits flags', () => {
    const { casConfig } = mergeConfig({}, { concurrency: 4, chunkSize: 32768 });
    expect(casConfig.concurrency).toBe(4);
    expect(casConfig.chunkSize).toBe(32768);
  });
});

describe('mergeConfig — CDC strategy', () => {
  it('CDC strategy merges cdc sub-config', () => {
    const config = { cdc: { targetChunkSize: 8192, minChunkSize: 2048, maxChunkSize: 16384 } };
    const { casConfig } = mergeConfig({ strategy: 'cdc' }, config);
    expect(casConfig.chunking).toEqual({
      strategy: 'cdc',
      targetChunkSize: 8192,
      minChunkSize: 2048,
      maxChunkSize: 16384,
    });
  });

  it('CDC CLI params override cdc sub-config', () => {
    const config = { cdc: { targetChunkSize: 8192, minChunkSize: 2048, maxChunkSize: 16384 } };
    const { casConfig } = mergeConfig({ strategy: 'cdc', targetChunkSize: 4096 }, config);
    expect(casConfig.chunking.targetChunkSize).toBe(4096);
    expect(casConfig.chunking.minChunkSize).toBe(2048);
  });
});

describe('mergeConfig — compression', () => {
  it('gzip from CLI', () => {
    const { storeExtras } = mergeConfig({ gzip: true }, {});
    expect(storeExtras.compression).toEqual({ algorithm: 'gzip' });
  });

  it('gzip from config', () => {
    const { storeExtras } = mergeConfig({}, { compression: 'gzip' });
    expect(storeExtras.compression).toEqual({ algorithm: 'gzip' });
  });

  it('no compression by default', () => {
    const { storeExtras } = mergeConfig({}, {});
    expect(storeExtras.compression).toBeUndefined();
  });
});

describe('mergeConfig — codec and thresholds', () => {
  it('cbor codec from CLI', () => {
    const { casConfig } = mergeConfig({ codec: 'cbor' }, {});
    expect(casConfig.codec).toBe('cbor');
  });

  it('cbor codec from config', () => {
    const { casConfig } = mergeConfig({}, { codec: 'cbor' });
    expect(casConfig.codec).toBe('cbor');
  });

  it('merkleThreshold from config', () => {
    const { casConfig } = mergeConfig({}, { merkleThreshold: 500 });
    expect(casConfig.merkleThreshold).toBe(500);
  });

  it('maxRestoreBufferSize from config', () => {
    const { casConfig } = mergeConfig({}, { maxRestoreBufferSize: 1024 * 1024 });
    expect(casConfig.maxRestoreBufferSize).toBe(1024 * 1024);
  });
});
