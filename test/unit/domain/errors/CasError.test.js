import { describe, it, expect } from 'vitest';
import CasError from '../../../../src/domain/errors/CasError.js';

describe('CasError', () => {
  it('sets name, code, and meta properties', () => {
    const err = new CasError('boom', 'TEST_CODE', { foo: 'bar' });
    expect(err.name).toBe('CasError');
    expect(err.message).toBe('boom');
    expect(err.code).toBe('TEST_CODE');
    expect(err.meta).toEqual({ foo: 'bar' });
  });

  it('defaults meta to empty object', () => {
    const err = new CasError('msg', 'CODE');
    expect(err.meta).toEqual({});
  });

  it('accepts structured options with a documentation URL', () => {
    const err = new CasError({
      message: 'msg',
      code: 'CODE',
      documentationUrl: 'https://example.test/docs',
    });
    expect(JSON.parse(JSON.stringify(err))).toMatchObject({
      message: 'msg',
      code: 'CODE',
      documentationUrl: 'https://example.test/docs',
    });
  });

  it('is an instance of Error', () => {
    const err = new CasError('msg', 'CODE');
    expect(err).toBeInstanceOf(Error);
  });

  it('constructs correctly when Error.captureStackTrace is unavailable', () => {
    const original = Error.captureStackTrace;
    Error.captureStackTrace = undefined;
    try {
      const err = new CasError('no-stack', 'NO_STACK', { x: 1 });
      expect(err.name).toBe('CasError');
      expect(err.code).toBe('NO_STACK');
      expect(err.meta).toEqual({ x: 1 });
      expect(err.message).toBe('no-stack');
      expect(err).toBeInstanceOf(Error);
    } finally {
      Error.captureStackTrace = original;
    }
  });
});
