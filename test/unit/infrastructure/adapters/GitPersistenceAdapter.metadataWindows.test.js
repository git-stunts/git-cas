import { describe, expect, it, vi } from 'vitest';
import GitPersistenceAdapter from '../../../../src/infrastructure/adapters/GitPersistenceAdapter.js';

const noPolicy = { execute: (operation) => operation() };
const MAX_OBJECTS = 1000;
const MAX_COMMAND_BYTES = 64 * 1024;
const ENCODER = new globalThis.TextEncoder();

function oidAt(index, width) {
  return index.toString(16).padStart(width, '0');
}

function oids(count, width = 40, offset = 0) {
  return Array.from({ length: count }, (_, index) => oidAt(index + offset, width));
}

function infoFor(oid) {
  return { oid, type: 'blob', size: oid.length };
}

function infosFor(objectNames) {
  return objectNames.map(infoFor);
}

function commandBytes(objectNames) {
  return ENCODER.encode(objectNames.map((name) => `info ${name}\n`).join('')).length;
}

/** Mirrors the Plumbing cat-file session refusal for oversized requests. */
function boundedCatSession({ missing = new Set() } = {}) {
  const windows = [];
  const session = {
    info: vi.fn(async (oid) => infoFor(oid)),
    read: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
    infoMany: vi.fn(async (objectNames) => {
      windows.push([...objectNames]);
      if (objectNames.length > MAX_OBJECTS) {
        throw new Error(`A cat-file batch may contain at most ${MAX_OBJECTS} objects`);
      }
      if (commandBytes(objectNames) > MAX_COMMAND_BYTES) {
        throw new Error(`A cat-file batch command may contain at most ${MAX_COMMAND_BYTES} bytes`);
      }
      const absent = objectNames.find((name) => missing.has(name));
      if (absent !== undefined) {
        const error = new Error(`Git object not found: ${absent}`);
        error.details = { objectName: absent };
        error.code = 'GIT_OBJECT_NOT_FOUND';
        throw error;
      }
      return objectNames.map(infoFor);
    }),
  };
  return { session, windows };
}

async function commandFallbackOutput({ input }) {
  return input
    .trimEnd()
    .split('\n')
    .map((oid) => `${oid} blob ${oid.length}`)
    .join('\n');
}

function adapterFor(session) {
  const plumbing = {
    execute: vi.fn(),
    executeStream: vi.fn(),
    openCatFileSession: vi.fn().mockResolvedValue(session),
  };
  return new GitPersistenceAdapter({ plumbing, policy: noPolicy });
}

function expectBoundedWindows(windows) {
  for (const window of windows) {
    expect(window.length).toBeLessThanOrEqual(MAX_OBJECTS);
    expect(commandBytes(window)).toBeLessThanOrEqual(MAX_COMMAND_BYTES);
  }
}

describe('GitPersistenceAdapter bounded metadata windows', () => {
  it.each([999, 1000, 1001, 2500])('reads %i SHA-1 targets within bounded requests', async (count) => {
    const { session, windows } = boundedCatSession();
    const requested = oids(count);

    await expect(adapterFor(session).readObjectInfos(requested)).resolves.toEqual(
      requested.map(infoFor),
    );

    expectBoundedWindows(windows);
    expect(windows.flat()).toEqual(requested);
  });

  it.each([936, 937, 1001])('reads %i SHA-256 targets within the command byte bound', async (count) => {
    const { session, windows } = boundedCatSession();
    const requested = oids(count, 64);

    await expect(adapterFor(session).readObjectInfos(requested)).resolves.toEqual(
      requested.map(infoFor),
    );

    expectBoundedWindows(windows);
    expect(windows.flat()).toEqual(requested);
  });

});

describe('GitPersistenceAdapter metadata window results', () => {
  it('preserves request order and duplicate results across windows', async () => {
    const { session, windows } = boundedCatSession();
    const unique = oids(1500);
    const requested = [...unique, unique[3], unique[1200], unique[3]];

    await expect(adapterFor(session).readObjectInfos(requested)).resolves.toEqual(
      requested.map(infoFor),
    );

    expectBoundedWindows(windows);
    expect(windows.flat()).toEqual(unique);
  });

  it('serves cached entries without re-reading them in later windows', async () => {
    const { session, windows } = boundedCatSession();
    const adapter = adapterFor(session);
    const warmed = oids(600);
    await adapter.readObjectInfos(warmed);
    windows.length = 0;
    const requested = [...warmed, ...oids(1200, 40, 600)];

    await expect(adapter.readObjectInfos(requested)).resolves.toEqual(requested.map(infoFor));

    expectBoundedWindows(windows);
    expect(windows.flat()).toEqual(oids(1200, 40, 600));
  });

  it('returns no metadata for zero targets without opening a request', async () => {
    const { session, windows } = boundedCatSession();

    await expect(adapterFor(session).readObjectInfos([])).resolves.toEqual([]);

    expect(windows).toEqual([]);
  });

});

describe('GitPersistenceAdapter metadata window failures and fallback', () => {
  it('reports a missing target from a later window and keeps it uncached', async () => {
    const requested = oids(1500);
    const missingOid = requested[1300];
    const { session, windows } = boundedCatSession({ missing: new Set([missingOid]) });
    const adapter = adapterFor(session);

    await expect(adapter.readObjectInfos(requested)).rejects.toMatchObject({
      code: 'GIT_OBJECT_NOT_FOUND',
    });
    expectBoundedWindows(windows);
    windows.length = 0;
    session.infoMany.mockImplementation(async (objectNames) => {
      windows.push([...objectNames]);
      return infosFor(objectNames);
    });

    await expect(adapter.readObjectInfos([missingOid])).resolves.toEqual([infoFor(missingOid)]);
    expect(windows).toEqual([[missingOid]]);
  });

  it('bounds the command fallback input when no cat-file session exists', async () => {
    const inputs = [];
    const plumbing = {
      execute: vi.fn(async (request) => {
        inputs.push(request.input);
        return await commandFallbackOutput(request);
      }),
      executeStream: vi.fn(),
    };
    const requested = oids(2100);
    const adapter = new GitPersistenceAdapter({ plumbing, policy: noPolicy });

    await expect(adapter.readObjectInfos(requested)).resolves.toEqual(requested.map(infoFor));

    for (const input of inputs) {
      const lines = input.trimEnd().split('\n');
      expect(lines.length).toBeLessThanOrEqual(MAX_OBJECTS);
      expect(commandBytes(lines)).toBeLessThanOrEqual(MAX_COMMAND_BYTES);
    }
    expect(inputs.join('')).toBe(`${requested.join('\n')}\n`);
  });
});
