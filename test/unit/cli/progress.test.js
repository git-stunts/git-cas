import { describe, it, expect, vi } from 'vitest';
import EventEmitter from 'node:events';
import { makeCtx } from './_testContext.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx('static'),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    statSync: vi.fn(() => ({ size: 5 * 256 * 1024 })),
  };
});

const { createStoreProgress, createRestoreProgress } = await import('../../../bin/ui/progress.js');

describe('createStoreProgress', () => {
  it('returns no-op when quiet is true', () => {
    const p = createStoreProgress({ filePath: 'test.bin', chunkSize: 256 * 1024, quiet: true });
    const emitter = new EventEmitter();
    p.attach(emitter);
    emitter.emit('chunk:stored', { index: 0, size: 256 * 1024 });
    p.detach();
    expect(emitter.listenerCount('chunk:stored')).toBe(0);
  });

  it('attaches and detaches from EventEmitter', () => {
    const p = createStoreProgress({ filePath: 'test.bin', chunkSize: 256 * 1024, quiet: false });
    const emitter = new EventEmitter();
    p.attach(emitter);
    expect(emitter.listenerCount('chunk:stored')).toBe(1);
    p.detach();
    expect(emitter.listenerCount('chunk:stored')).toBe(0);
  });

  it('tracks chunk events without throwing', () => {
    const p = createStoreProgress({ filePath: 'test.bin', chunkSize: 256 * 1024, quiet: false });
    const emitter = new EventEmitter();
    p.attach(emitter);
    for (let i = 0; i < 5; i++) {
      emitter.emit('chunk:stored', { index: i, size: 256 * 1024 });
    }
    p.detach();
    expect(emitter.listenerCount('chunk:stored')).toBe(0);
  });
});

describe('createRestoreProgress', () => {
  it('returns no-op when quiet is true', () => {
    const p = createRestoreProgress({ totalChunks: 5, quiet: true });
    const emitter = new EventEmitter();
    p.attach(emitter);
    p.detach();
    expect(emitter.listenerCount('chunk:restored')).toBe(0);
  });

  it('returns no-op for 0-chunk manifests', () => {
    const p = createRestoreProgress({ totalChunks: 0, quiet: false });
    const emitter = new EventEmitter();
    p.attach(emitter);
    p.detach();
    expect(emitter.listenerCount('chunk:restored')).toBe(0);
  });

  it('attaches and detaches from EventEmitter', () => {
    const p = createRestoreProgress({ totalChunks: 3, quiet: false });
    const emitter = new EventEmitter();
    p.attach(emitter);
    expect(emitter.listenerCount('chunk:restored')).toBe(1);
    emitter.emit('chunk:restored', { index: 0, size: 256 * 1024 });
    p.detach();
    expect(emitter.listenerCount('chunk:restored')).toBe(0);
  });
});
