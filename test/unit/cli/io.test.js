import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import { flushStdioAndExit, installBrokenPipeHandlers } from '../../../bin/io.js';

class FakeStream extends EventEmitter {
  constructor() {
    super();
    this.write = vi.fn((/** @type {string} */ _chunk, /** @type {(() => void) | undefined} */ callback) => {
      callback?.();
      return true;
    });
  }
}

describe('installBrokenPipeHandlers', () => {
  it('exits with the current exit code on EPIPE', () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    const exit = vi.fn();
    const handlers = installBrokenPipeHandlers({
      stdout,
      stderr,
      exit,
      getExitCode: () => 1,
    });

    stderr.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));

    expect(exit).toHaveBeenCalledWith(1);
    handlers.dispose();
  });
});

describe('flushStdioAndExit', () => {
  it('flushes stdout and stderr before exiting', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    const exit = vi.fn();

    await flushStdioAndExit({ stdout, stderr, exit, code: 7 });

    expect(stdout.write).toHaveBeenCalledWith('', expect.any(Function));
    expect(stderr.write).toHaveBeenCalledWith('', expect.any(Function));
    expect(exit).toHaveBeenCalledWith(7);
  });

  it('ignores EPIPE thrown during flush and still exits', async () => {
    const stdout = new FakeStream();
    const stderr = new FakeStream();
    const exit = vi.fn();

    stdout.write.mockImplementationOnce(() => {
      throw Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
    });

    await flushStdioAndExit({ stdout, stderr, exit, code: 0 });

    expect(stderr.write).toHaveBeenCalledWith('', expect.any(Function));
    expect(exit).toHaveBeenCalledWith(0);
  });
});
