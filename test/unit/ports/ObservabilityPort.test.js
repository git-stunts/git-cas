import { describe, it, expect } from 'vitest';
import ObservabilityPort from '../../../src/ports/ObservabilityPort.js';

describe('ObservabilityPort (abstract)', () => {
  it('metric() throws Not implemented', () => {
    const port = new ObservabilityPort();
    expect(() => port.metric('chunk', {})).toThrow('Not implemented');
  });

  it('log() throws Not implemented', () => {
    const port = new ObservabilityPort();
    expect(() => port.log('info', 'hello')).toThrow('Not implemented');
  });

  it('span() throws Not implemented', () => {
    const port = new ObservabilityPort();
    expect(() => port.span('op')).toThrow('Not implemented');
  });
});
