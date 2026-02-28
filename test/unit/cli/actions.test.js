import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAction, writeError, HINTS } from '../../../bin/actions.js';

describe('writeError — text mode', () => {
  let stderrSpy;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('writes error [CODE]: message for coded errors', () => {
    const err = Object.assign(new Error('key required'), { code: 'MISSING_KEY' });
    writeError(err, false);
    expect(stderrSpy).toHaveBeenCalledWith('error [MISSING_KEY]: key required\n');
  });

  it('appends hint for known codes', () => {
    const err = Object.assign(new Error('key required'), { code: 'MISSING_KEY' });
    writeError(err, false);
    expect(stderrSpy).toHaveBeenCalledWith('hint: Provide --key-file or --vault-passphrase\n');
  });

  it('no hint for unknown codes', () => {
    const err = Object.assign(new Error('something'), { code: 'UNKNOWN_CODE' });
    writeError(err, false);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('no [CODE] prefix when err.code is absent', () => {
    writeError(new Error('generic failure'), false);
    expect(stderrSpy).toHaveBeenCalledWith('error: generic failure\n');
  });

  it('no [CODE] prefix when err.code is not a string', () => {
    const err = Object.assign(new Error('oops'), { code: 42 });
    writeError(err, false);
    expect(stderrSpy).toHaveBeenCalledWith('error: oops\n');
  });
});

describe('writeError — JSON mode', () => {
  let stderrSpy;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('writes {"error","code"} to stderr', () => {
    const err = Object.assign(new Error('not found'), { code: 'MANIFEST_NOT_FOUND' });
    writeError(err, true);
    const output = JSON.parse(stderrSpy.mock.calls[0][0]);
    expect(output).toEqual({ error: 'not found', code: 'MANIFEST_NOT_FOUND' });
  });

  it('omits code when absent', () => {
    writeError(new Error('boom'), true);
    const output = JSON.parse(stderrSpy.mock.calls[0][0]);
    expect(output).toEqual({ error: 'boom' });
  });
});

describe('runAction', () => {
  let stderrSpy;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    stderrSpy.mockRestore();
  });

  it('does not set exitCode on success', async () => {
    const action = runAction(async () => {}, () => false);
    await action();
    expect(process.exitCode).toBeUndefined();
  });

  it('sets process.exitCode = 1 on error', async () => {
    const action = runAction(async () => { throw new Error('fail'); }, () => false);
    await action();
    expect(process.exitCode).toBe(1);
  });

  it('passes arguments through to the wrapped function', async () => {
    const spy = vi.fn();
    const action = runAction(spy, () => false);
    await action('a', 'b', 'c');
    expect(spy).toHaveBeenCalledWith('a', 'b', 'c');
  });

  it('uses JSON mode from getJson getter', async () => {
    const err = Object.assign(new Error('oops'), { code: 'MISSING_KEY' });
    const action = runAction(async () => { throw err; }, () => true);
    await action();
    const output = JSON.parse(stderrSpy.mock.calls[0][0]);
    expect(output).toEqual({ error: 'oops', code: 'MISSING_KEY' });
  });
});

describe('HINTS', () => {
  it('contains expected error codes', () => {
    expect(HINTS).toHaveProperty('MISSING_KEY');
    expect(HINTS).toHaveProperty('MANIFEST_NOT_FOUND');
    expect(HINTS).toHaveProperty('VAULT_ENTRY_NOT_FOUND');
    expect(HINTS).toHaveProperty('VAULT_ENTRY_EXISTS');
    expect(HINTS).toHaveProperty('INTEGRITY_ERROR');
  });

  it('contains envelope encryption error codes', () => {
    expect(HINTS).toHaveProperty('NO_MATCHING_RECIPIENT');
    expect(HINTS).toHaveProperty('DEK_UNWRAP_FAILED');
    expect(HINTS).toHaveProperty('RECIPIENT_NOT_FOUND');
    expect(HINTS).toHaveProperty('RECIPIENT_ALREADY_EXISTS');
    expect(HINTS).toHaveProperty('CANNOT_REMOVE_LAST_RECIPIENT');
  });
});
