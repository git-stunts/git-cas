import { describe, expect, it, vi } from 'vitest';
import GitRepositoryInspectionAdapter from '../../../../src/infrastructure/adapters/GitRepositoryInspectionAdapter.js';

function gitStream(chunks, result = { code: 0, stderr: '' }) {
  return {
    finished: Promise.resolve(result),
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function mockPlumbing(overrides = {}) {
  return {
    execute: vi.fn(),
    executeStream: vi.fn(),
    inspectPrunableObjects: vi.fn(),
    ...overrides,
  };
}

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

// eslint-disable-next-line max-lines-per-function
describe('GitRepositoryInspectionAdapter', () => {
  it('streams object metadata across arbitrary output chunk boundaries', async () => {
    const plumbing = mockPlumbing({
      executeStream: vi
        .fn()
        .mockResolvedValue(
          gitStream([
            Buffer.from(`${'a'.repeat(40)} blob 12 9\n${'b'.repeat(20)}`),
            Buffer.from(`${'b'.repeat(20)} tree 34 21\n`),
          ])
        ),
    });
    const adapter = new GitRepositoryInspectionAdapter({ plumbing });

    await expect(collect(adapter.iterateObjects())).resolves.toEqual([
      { oid: 'a'.repeat(40), type: 'blob', logicalBytes: 12, physicalBytes: 9 },
      { oid: 'b'.repeat(40), type: 'tree', logicalBytes: 34, physicalBytes: 21 },
    ]);
    expect(plumbing.executeStream).toHaveBeenCalledWith({
      args: [
        'cat-file',
        '--batch-all-objects',
        '--batch-check=%(objectname) %(objecttype) %(objectsize) %(objectsize:disk)',
      ],
    });
  });

  it('includes every ref and reflog root in the reachable inventory', async () => {
    const plumbing = mockPlumbing({
      executeStream: vi
        .fn()
        .mockResolvedValue(gitStream([`${'a'.repeat(40)}\n${'b'.repeat(40)}\n`])),
    });
    const adapter = new GitRepositoryInspectionAdapter({ plumbing });

    await expect(collect(adapter.iterateReachableObjectIds())).resolves.toEqual([
      'a'.repeat(40),
      'b'.repeat(40),
    ]);
    expect(plumbing.executeStream).toHaveBeenCalledWith({
      args: ['rev-list', '--all', '--reflog', '--objects', '--no-object-names'],
    });
  });

  it('uses plumbing safe-prune inspection and never constructs a mutating prune command', async () => {
    const expiresBefore = '2026-07-01T00:00:00.000Z';
    const plumbing = mockPlumbing({
      inspectPrunableObjects: vi.fn().mockResolvedValue(gitStream([`${'c'.repeat(40)} blob\n`])),
    });
    const adapter = new GitRepositoryInspectionAdapter({ plumbing });

    await expect(collect(adapter.iteratePrunableObjects({ expiresBefore }))).resolves.toEqual([
      { oid: 'c'.repeat(40), type: 'blob' },
    ]);
    expect(plumbing.inspectPrunableObjects).toHaveBeenCalledWith({ expiresBefore });
  });

  it('streams deterministic ref records and obtains reachable disk usage separately', async () => {
    const plumbing = mockPlumbing({
      executeStream: vi
        .fn()
        .mockResolvedValue(
          gitStream([`refs/cas/vault\t${'d'.repeat(40)}\nrefs/heads/main\t${'e'.repeat(40)}\n`])
        ),
      execute: vi.fn().mockResolvedValue('1234\n'),
    });
    const adapter = new GitRepositoryInspectionAdapter({ plumbing });

    await expect(collect(adapter.iterateRefs())).resolves.toEqual([
      { ref: 'refs/cas/vault', oid: 'd'.repeat(40) },
      { ref: 'refs/heads/main', oid: 'e'.repeat(40) },
    ]);
    await expect(adapter.reachablePhysicalBytes()).resolves.toBe(1234);
    expect(plumbing.executeStream).toHaveBeenCalledWith({
      args: ['for-each-ref', '--format=%(refname)%09%(objectname)', 'refs/'],
    });
    expect(plumbing.execute).toHaveBeenCalledWith({
      args: ['rev-list', '--all', '--reflog', '--objects', '--disk-usage'],
    });
  });

  it('rejects malformed Git output instead of guessing repository evidence', async () => {
    const plumbing = mockPlumbing({
      executeStream: vi.fn().mockResolvedValue(gitStream(['not-an-object\n'])),
    });
    const adapter = new GitRepositoryInspectionAdapter({ plumbing });

    await expect(collect(adapter.iterateObjects())).rejects.toMatchObject({
      code: 'REPOSITORY_INSPECTION_INVALID',
    });
  });

  it('rejects a nonzero streamed Git result after consuming its output', async () => {
    const plumbing = mockPlumbing({
      executeStream: vi.fn().mockResolvedValue(
        gitStream([`${'a'.repeat(40)}\n`], {
          code: 128,
          stderr: 'fatal: repository inspection failed',
        })
      ),
    });
    const adapter = new GitRepositoryInspectionAdapter({ plumbing });

    await expect(collect(adapter.iterateReachableObjectIds())).rejects.toMatchObject({
      code: 'REPOSITORY_INSPECTION_INVALID',
      meta: expect.objectContaining({
        operation: 'reachable object inventory',
        stderr: 'fatal: repository inspection failed',
      }),
    });
  });
});
