import { describe, it, expect, vi } from 'vitest';
import EventEmitterObserver from '../../../../src/infrastructure/adapters/EventEmitterObserver.js';

describe('EventEmitterObserver – metric routing', () => {
  it('routes chunk:stored metric to event', () => {
    const obs = new EventEmitterObserver();
    const handler = vi.fn();
    obs.on('chunk:stored', handler);
    obs.metric('chunk', { action: 'stored', index: 0, size: 1024, digest: 'abc', blob: 'def' });
    expect(handler).toHaveBeenCalledWith({ index: 0, size: 1024, digest: 'abc', blob: 'def' });
  });

  it('routes file:stored metric to event', () => {
    const obs = new EventEmitterObserver();
    const handler = vi.fn();
    obs.on('file:stored', handler);
    obs.metric('file', { action: 'stored', slug: 'test', size: 2048, chunkCount: 2, encrypted: false });
    expect(handler).toHaveBeenCalledWith({ slug: 'test', size: 2048, chunkCount: 2, encrypted: false });
  });

  it('routes integrity:pass metric to event', () => {
    const obs = new EventEmitterObserver();
    const handler = vi.fn();
    obs.on('integrity:pass', handler);
    obs.metric('integrity', { action: 'pass', slug: 'test' });
    expect(handler).toHaveBeenCalledWith({ slug: 'test' });
  });

  it('routes integrity:fail metric to event', () => {
    const obs = new EventEmitterObserver();
    const handler = vi.fn();
    obs.on('integrity:fail', handler);
    obs.metric('integrity', { action: 'fail', slug: 'test', chunkIndex: 0, expected: 'a', actual: 'b' });
    expect(handler).toHaveBeenCalledWith({ slug: 'test', chunkIndex: 0, expected: 'a', actual: 'b' });
  });
});

describe('EventEmitterObserver – error handling', () => {
  it('emits error only when listeners are attached', () => {
    const obs = new EventEmitterObserver();
    expect(() => obs.metric('error', { code: 'ERR', message: 'fail' })).not.toThrow();
    const handler = vi.fn();
    obs.on('error', handler);
    obs.metric('error', { code: 'ERR', message: 'fail' });
    expect(handler).toHaveBeenCalledWith({ code: 'ERR', message: 'fail' });
  });
});

describe('EventEmitterObserver – listener management', () => {
  it('removeListener removes the listener', () => {
    const obs = new EventEmitterObserver();
    const handler = vi.fn();
    obs.on('chunk:stored', handler);
    obs.removeListener('chunk:stored', handler);
    obs.metric('chunk', { action: 'stored', index: 0, size: 100 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('listenerCount returns correct count', () => {
    const obs = new EventEmitterObserver();
    expect(obs.listenerCount('chunk:stored')).toBe(0);
    const handler = vi.fn();
    obs.on('chunk:stored', handler);
    expect(obs.listenerCount('chunk:stored')).toBe(1);
  });

  it('log() and span() do not throw', () => {
    const obs = new EventEmitterObserver();
    expect(() => obs.log('info', 'test')).not.toThrow();
    const s = obs.span('op');
    expect(() => s.end()).not.toThrow();
  });
});
