import { describe, it, expect, vi } from 'vitest';
import EventEmitterObserver from '../../../src/infrastructure/adapters/EventEmitterObserver.js';
import { makeCtx } from './_testContext.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx('static'),
}));

const { createStoreProgress, createRestoreProgress } = await import('../../../bin/ui/progress.js');

const FILE_SIZE = 5 * 256 * 1024;

describe('createStoreProgress', () => {
  it('returns no-op when quiet is true', () => {
    const p = createStoreProgress({ filePath: 'test.bin', chunkSize: 256 * 1024, quiet: true });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    emitter.metric('chunk', { action: 'stored', index: 0, size: 256 * 1024 });
    p.detach();
    expect(emitter.listenerCount('chunk:stored')).toBe(0);
  });

  it('attaches and detaches from EventEmitter', () => {
    const p = createStoreProgress({ filePath: 'test.bin', chunkSize: 256 * 1024, quiet: false, fileSize: FILE_SIZE });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    expect(emitter.listenerCount('chunk:stored')).toBe(1);
    p.detach();
    expect(emitter.listenerCount('chunk:stored')).toBe(0);
  });

  it('tracks chunk events without throwing', () => {
    const p = createStoreProgress({ filePath: 'test.bin', chunkSize: 256 * 1024, quiet: false, fileSize: FILE_SIZE });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    for (let i = 0; i < 5; i++) {
      emitter.metric('chunk', { action: 'stored', index: i, size: 256 * 1024 });
    }
    p.detach();
    expect(emitter.listenerCount('chunk:stored')).toBe(0);
  });
});

describe('createRestoreProgress', () => {
  it('returns no-op when quiet is true', () => {
    const p = createRestoreProgress({ totalChunks: 5, quiet: true });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    p.detach();
    expect(emitter.listenerCount('chunk:restored')).toBe(0);
  });

  it('returns no-op for 0-chunk manifests', () => {
    const p = createRestoreProgress({ totalChunks: 0, quiet: false });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    p.detach();
    expect(emitter.listenerCount('chunk:restored')).toBe(0);
  });

  it('attaches and detaches from EventEmitter', () => {
    const p = createRestoreProgress({ totalChunks: 3, quiet: false });
    const emitter = new EventEmitterObserver();
    p.attach(emitter);
    expect(emitter.listenerCount('chunk:restored')).toBe(1);
    emitter.metric('chunk', { action: 'restored', index: 0, size: 256 * 1024 });
    p.detach();
    expect(emitter.listenerCount('chunk:restored')).toBe(0);
  });
});
