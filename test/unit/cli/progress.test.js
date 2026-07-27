import { describe, it, expect } from 'vitest';
import EventEmitterObserver from '../../../src/infrastructure/adapters/EventEmitterObserver.js';
import { createStoreProgress, createRestoreProgress } from '../../../bin/ui/progress.js';
import { makeCtx } from './_testContext.js';

const FILE_SIZE = 5 * 256 * 1024;
const ctx = makeCtx('static');

describe('createStoreProgress', () => {
  it('returns no-op when quiet is true', () => {
    const p = createStoreProgress({
      filePath: 'test.bin',
      chunkSize: 256 * 1024,
      quiet: true,
      ctx,
    });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    emitter.metric('chunk', { action: 'stored', index: 0, size: 256 * 1024 });
    p.detach();
    expect(emitter.listenerCount('chunk:stored')).toBe(0);
  });

  it('attaches and detaches from EventEmitter', () => {
    const p = createStoreProgress({
      filePath: 'test.bin',
      chunkSize: 256 * 1024,
      quiet: false,
      fileSize: FILE_SIZE,
      ctx,
    });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    expect(emitter.listenerCount('chunk:stored')).toBe(1);
    p.detach();
    expect(emitter.listenerCount('chunk:stored')).toBe(0);
  });
});

describe('store progress events', () => {
  it('tracks chunk events without throwing', () => {
    const p = createStoreProgress({
      filePath: 'test.bin',
      chunkSize: 256 * 1024,
      quiet: false,
      fileSize: FILE_SIZE,
      ctx,
    });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    for (let i = 0; i < 5; i++) {
      emitter.metric('chunk', { action: 'stored', index: i, size: 256 * 1024 });
    }
    p.detach();
    expect(emitter.listenerCount('chunk:stored')).toBe(0);
  });

  it('uses Bijou cursor ownership without counting the initial render as a chunk', () => {
    const interactiveCtx = makeCtx('interactive');
    const p = createStoreProgress({
      filePath: 'test.bin',
      chunkSize: 256 * 1024,
      quiet: false,
      fileSize: FILE_SIZE,
      ctx: interactiveCtx,
    });
    const emitter = new EventEmitterObserver();

    p.attach(emitter);
    emitter.metric('chunk', { action: 'stored', index: 0, size: 256 * 1024 });
    p.detach();

    expect(interactiveCtx.io.written).toEqual(['\x1b[?25l', '\x1b[?25h']);
    expect(interactiveCtx.io.writtenErr.join('')).toContain('Storing 0/5');
    expect(interactiveCtx.io.writtenErr.join('')).toContain('Storing 1/5 done');
  });
});

describe('progress cursor recovery', () => {
  it('restores the cursor when the initial progress render fails', () => {
    const interactiveCtx = makeCtx('interactive');
    interactiveCtx.io.writeError = () => {
      throw new Error('stderr unavailable');
    };
    const p = createStoreProgress({
      filePath: 'test.bin',
      chunkSize: 256 * 1024,
      quiet: false,
      fileSize: FILE_SIZE,
      ctx: interactiveCtx,
    });
    const emitter = new EventEmitterObserver();

    expect(() => p.attach(emitter)).toThrow('stderr unavailable');
    expect(emitter.listenerCount('chunk:stored')).toBe(0);
    expect(interactiveCtx.io.written).toEqual(['\x1b[?25l', '\x1b[?25h']);
  });
});

describe('createRestoreProgress', () => {
  it('returns no-op when quiet is true', () => {
    const p = createRestoreProgress({ totalChunks: 5, quiet: true, ctx });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    p.detach();
    expect(emitter.listenerCount('chunk:restored')).toBe(0);
  });

  it('returns no-op for 0-chunk manifests', () => {
    const p = createRestoreProgress({ totalChunks: 0, quiet: false, ctx });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    p.detach();
    expect(emitter.listenerCount('chunk:restored')).toBe(0);
  });

  it('attaches and detaches from EventEmitter', () => {
    const p = createRestoreProgress({ totalChunks: 3, quiet: false, ctx });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    expect(emitter.listenerCount('chunk:restored')).toBe(1);
    emitter.metric('chunk', { action: 'restored', index: 0, size: 256 * 1024 });
    p.detach();
    expect(emitter.listenerCount('chunk:restored')).toBe(0);
  });
});
