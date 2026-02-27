import { describe, it, expect } from 'vitest';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';

describe('SilentObserver', () => {
  it('metric() does not throw', () => {
    const obs = new SilentObserver();
    expect(() => obs.metric('chunk', { action: 'stored' })).not.toThrow();
  });

  it('log() does not throw', () => {
    const obs = new SilentObserver();
    expect(() => obs.log('info', 'hello')).not.toThrow();
  });

  it('span() returns object with end()', () => {
    const obs = new SilentObserver();
    const s = obs.span('op');
    expect(s).toHaveProperty('end');
    expect(() => s.end()).not.toThrow();
  });
});
