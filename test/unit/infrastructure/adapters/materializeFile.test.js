import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { materializeFile } from '@git-stunts/git-cas/files';

let base;
beforeEach(async () => { base = await mkdtemp(path.join(os.tmpdir(), 'cas-materialize-')); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function* source(text = 'complete') { yield Buffer.from(text); }
const options = (extra = {}) => ({ source: source(), baseDirectory: base, outputPath: 'doc.md', ...extra });
const read = () => readFile(path.join(base, 'doc.md'), 'utf8');
const entries = () => readdir(base);
function gate() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe('optional file materialization', () => {
  it('keeps the destination unchanged until the source finishes', async () => {
    await writeFile(path.join(base, 'doc.md'), 'original');
    const entered = gate();
    const finish = gate();
    async function* slow() {
      yield Buffer.from('first');
      entered.resolve();
      await finish.promise;
      yield Buffer.from('last');
    }
    const pending = materializeFile(options({ source: slow() }));
    await entered.promise;
    expect(await read()).toBe('original');
    finish.resolve();
    expect(await pending).toEqual({ bytesWritten: 9 });
    expect(await read()).toBe('firstlast');
    expect(await entries()).toEqual(['doc.md']);
  });

  it.each([false, true])('preserves destination on late source failure, existing=%s', async (existing) => {
    if (existing) { await writeFile(path.join(base, 'doc.md'), 'original'); }
    const failure = new Error('late authentication failure');
    async function* broken() { yield Buffer.from('partial'); throw failure; }
    await expect(materializeFile(options({ source: broken() }))).rejects.toBe(failure);
    if (existing) { expect(await read()).toBe('original'); }
    expect(await entries()).toEqual(existing ? ['doc.md'] : []);
  });

  it('publishes an empty file', async () => {
    expect(await materializeFile(options({ source: source('') }))).toEqual({ bytesWritten: 0 });
    expect(await read()).toBe('');
  });

  it('optionally verifies the full plaintext SHA-256 before publication', async () => {
    const expectedSha256 = createHash('sha256').update('complete').digest('hex').toUpperCase();
    await expect(materializeFile(options({ expectedSha256 }))).resolves.toEqual({ bytesWritten: 8 });
    expect(await read()).toBe('complete');
    await expect(materializeFile(options({ expectedSha256: '0'.repeat(64) })))
      .rejects.toMatchObject({ code: 'INTEGRITY_ERROR' });
    expect(await read()).toBe('complete');
    expect(await entries()).toEqual(['doc.md']);
  });

});

describe('file materialization digest verification', () => {
  it('publishes the bytes whose digest was verified when the producer reuses its buffer', async () => {
    async function* reused() {
      const chunk = Uint8Array.of(65);
      yield chunk;
      chunk[0] = 66;
      yield chunk;
    }
    const expectedSha256 = createHash('sha256').update('AB').digest('hex');
    await materializeFile(options({ source: reused(), expectedSha256 }));
    expect(await read()).toBe('AB');
  });
});

describe('file materialization buffer reuse under backpressure', () => {
  it.each([false, true])('publishes every yielded chunk when the producer reuses one buffer, digest=%s', async (verify) => {
    const expected = Buffer.concat(Array.from({ length: 32 }, (_, index) => Buffer.alloc(32_768, index)));
    async function* reused() {
      const chunk = Buffer.alloc(32_768);
      for (let index = 0; index < 32; index++) {
        chunk.fill(index);
        yield chunk;
      }
    }
    const expectedSha256 = verify ? createHash('sha256').update(expected).digest('hex') : undefined;
    await materializeFile(options({ source: reused(), expectedSha256 }));
    expect((await readFile(path.join(base, 'doc.md'))).equals(expected)).toBe(true);
  });
});

describe('file materialization chunk copy', () => {
  it('copies the bytes of a Uint8Array without calling its valueOf', async () => {
    const chunk = Uint8Array.of(65);
    chunk.valueOf = () => 'B';
    async function* overridden() { yield chunk; }
    await materializeFile(options({ source: overridden() }));
    expect(await read()).toBe('A');
  });
});

describe('file materialization signal brand', () => {
  it('rejects an object that only inherits from AbortSignal.prototype', async () => {
    const signal = Object.create(globalThis.AbortSignal.prototype);
    await expect(materializeFile(options({ signal }))).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(await entries()).toEqual([]);
  });
});

describe('file materialization failure cleanup', () => {
  it('cleans up after the destination refuses rename', async () => {
    await mkdir(path.join(base, 'doc.md'));
    await expect(materializeFile(options())).rejects.toBeDefined();
    expect(await entries()).toEqual(['doc.md']);
    expect(await readdir(path.join(base, 'doc.md'))).toEqual([]);
  });

  it('cleans up and preserves the original after cancellation', async () => {
    const controller = new globalThis.AbortController();
    const entered = gate();
    const finish = gate();
    await writeFile(path.join(base, 'doc.md'), 'original');
    async function* slow() {
      yield Buffer.from('partial');
      entered.resolve();
      await finish.promise;
    }
    const pending = materializeFile(options({ source: slow(), signal: controller.signal }));
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    controller.abort();
    finish.resolve();
    await rejected;
    expect(await read()).toBe('original');
    expect(await entries()).toEqual(['doc.md']);
  });

  it('does not pull a source that was already cancelled', async () => {
    const controller = new globalThis.AbortController();
    controller.abort();
    let pulled = false;
    async function* untouched() { pulled = true; yield Buffer.from('no'); }
    await expect(materializeFile(options({ source: untouched(), signal: controller.signal })))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(pulled).toBe(false);
    expect(await entries()).toEqual([]);
  });

});

describe('file materialization input boundary', () => {
  it.each([
    { baseDirectory: undefined }, { outputPath: undefined }, { outputPath: '' },
    { source: null }, { expectedSha256: 'wrong' },
  ])('rejects invalid options before creating output: %j', async (invalid) => {
    await expect(materializeFile(options(invalid))).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(await entries()).toEqual([]);
  });

  it('accepts a file name that begins with two dots', async () => {
    await expect(materializeFile(options({ outputPath: '..cache' }))).resolves.toEqual({ bytesWritten: 8 });
    expect(await readFile(path.join(base, '..cache'), 'utf8')).toBe('complete');
  });

  it('rejects lexical escape', async () => {
    await expect(materializeFile(options({ outputPath: '../escape.md' })))
      .rejects.toMatchObject({ code: 'SECURITY_BOUNDARY_VIOLATION' });
    expect(await entries()).toEqual([]);
  });

  it('rejects a symlink escape without consuming the source', async () => {
    const inner = path.join(base, 'inner');
    await mkdir(inner);
    await symlink(base, path.join(inner, 'escape'));
    let pulled = false;
    async function* untouched() { pulled = true; yield Buffer.from('no'); }
    await expect(materializeFile({ source: untouched(), baseDirectory: inner, outputPath: 'escape/doc.md' }))
      .rejects.toMatchObject({ code: 'SECURITY_BOUNDARY_VIOLATION' });
    expect(pulled).toBe(false);
    expect(await readdir(inner)).toEqual(['escape']);
  });

  it.each([['.', []], ['self', ['self']]])(
    'rejects %j resolving to the base directory without consuming the source', async (outputPath, listing) => {
      const inner = path.join(base, 'inner');
      await mkdir(inner);
      if (outputPath === 'self') { await symlink(inner, path.join(inner, 'self')); }
      let pulled = false;
      async function* untouched() { pulled = true; yield Buffer.from('no'); }
      await expect(materializeFile({ source: untouched(), baseDirectory: inner, outputPath }))
        .rejects.toMatchObject({ code: 'SECURITY_BOUNDARY_VIOLATION' });
      expect(pulled).toBe(false);
      expect(await readdir(base)).toEqual(['inner']);
      expect(await readdir(inner)).toEqual(listing);
    }
  );
});

describe('file materialization source contract', () => {
  it.each([['a string', 'not bytes'], ['undefined', undefined], ['a number', 42]])(
    'rejects a source chunk that is %s and keeps the destination', async (_label, chunk) => {
      await writeFile(path.join(base, 'doc.md'), 'original');
      async function* invalid() { yield chunk; }
      await expect(materializeFile(options({ source: invalid() })))
        .rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
      expect(await read()).toBe('original');
      expect(await entries()).toEqual(['doc.md']);
    }
  );

  it.each([[null], [false], [0], [{}], [{ throwIfAborted() {} }]])(
    'rejects signal %j before creating output', async (signal) => {
      await expect(materializeFile(options({ signal })))
        .rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
      expect(await entries()).toEqual([]);
    }
  );
});

describe('file materialization cancellation and cleanup errors', () => {
  it('settles on cancellation while the producer is blocked', async () => {
    await writeFile(path.join(base, 'doc.md'), 'original');
    const controller = new globalThis.AbortController();
    const entered = gate();
    const blocked = gate();
    async function* stalled() {
      yield Buffer.from('partial');
      entered.resolve();
      await blocked.promise;
      yield Buffer.from('late');
    }
    const pending = materializeFile(options({ source: stalled(), signal: controller.signal }));
    await entered.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    blocked.resolve();
    expect(await read()).toBe('original');
    expect(await entries()).toEqual(['doc.md']);
  });

  it('reports the source failure when temporary cleanup also fails', async () => {
    const failure = new Error('source authentication failed');
    async function* broken() {
      yield Buffer.from('partial');
      await chmod(base, 0o500);
      throw failure;
    }
    try {
      await expect(materializeFile(options({ source: broken() }))).rejects.toBe(failure);
    } finally {
      await chmod(base, 0o700);
    }
  });
});

describe('file materialization source iteration edges', () => {
  it('reports a next failure when the source return throws synchronously', async () => {
    const failure = new Error('authentication failed');
    const throwing = {
      [Symbol.asyncIterator]() { return this; },
      next() { return Promise.reject(failure); },
      return() { throw new Error('cleanup failed'); },
    };
    await expect(materializeFile(options({ source: throwing }))).rejects.toBe(failure);
    expect(await entries()).toEqual([]);
  });

  it('validates the same chunk value that it publishes', async () => {
    let pulls = 0;
    let reads = 0;
    const changing = {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        if (pulls++) { return { done: true }; }
        return { done: false, get value() { reads += 1; return reads === 1 ? Uint8Array.of(65) : 'unchecked text'; } };
      },
    };
    await materializeFile(options({ source: changing }));
    expect(await read()).toBe('A');
    expect(reads).toBe(1);
  });

  it('accepts Uint8Array chunks created in another realm', async () => {
    async function* foreign() { yield runInNewContext('new Uint8Array([65])'); }
    await expect(materializeFile(options({ source: foreign() }))).resolves.toEqual({ bytesWritten: 1 });
    expect(await read()).toBe('A');
  });
});

describe('file materialization source failure values', () => {
  it.each([[null], [undefined], [false], [0], ['']])('propagates a source rejection of %j unchanged', async (failure) => {
    async function* broken() {
      yield Uint8Array.of(65);
      throw failure;
    }
    await expect(materializeFile(options({ source: broken() }))).rejects.toBe(failure);
    expect(await entries()).toEqual([]);
  });

  it('propagates a falsy failure from the source iterator factory unchanged', async () => {
    const refusing = { [Symbol.asyncIterator]() { throw 0; } };
    await expect(materializeFile(options({ source: refusing }))).rejects.toBe(0);
    expect(await entries()).toEqual([]);
  });
});

describe('file materialization abort race retention', () => {
  it('races a fresh abort promise for every pull, so completed pulls retain nothing', async () => {
    const controller = new globalThis.AbortController();
    const raced = new Set();
    let repeats = 0;
    const race = Promise.race.bind(Promise);
    const spy = vi.spyOn(Promise, 'race').mockImplementation((contenders) => {
      for (const contender of contenders) {
        if (raced.has(contender)) { repeats += 1; }
        raced.add(contender);
      }
      return race(contenders);
    });
    async function* many() { for (let index = 0; index < 100; index++) { yield Uint8Array.of(65); } }
    try {
      await materializeFile(options({ source: many(), signal: controller.signal }));
    } finally {
      spy.mockRestore();
    }
    expect(raced.size).toBeGreaterThanOrEqual(200);
    expect(repeats).toBe(0);
  });
});
