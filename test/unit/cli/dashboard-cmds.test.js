import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildRepoTreemapReport,
  loadDoctorCmd,
  readRefInventory,
  readSourceEntries,
} from '../../../bin/ui/dashboard-cmds.js';

function makePersistence(overrides = {}) {
  return {
    readBlob: vi.fn(),
    plumbing: { execute: vi.fn() },
    ...overrides,
  };
}

function makeRefPort(overrides = {}) {
  return {
    resolveRef: vi.fn(),
    resolveTree: vi.fn(),
    ...overrides,
  };
}

function makePlumbing(cwd, execute) {
  return {
    cwd,
    execute: vi.fn(execute),
  };
}

async function withTempRepo(run) {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), 'git-cas-dashboard-'));
  try {
    return await run(repoDir);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

function revParseResult(repoDir, args) {
  if (args[0] !== 'rev-parse') {
    return null;
  }
  if (args[1] === '--git-dir') {
    throw new Error('Prohibited git flag detected: --git-dir');
  }
  if (args[1] === '--is-bare-repository') {
    return 'false';
  }
  if (args[1] === '--show-toplevel') {
    return repoDir;
  }
  return null;
}

function repoExecResult(repoDir, options, args) {
  const {
    showRefOutput = '',
    trackedPaths = [],
    ignoredPaths = [],
  } = options;
  const revParse = revParseResult(repoDir, args);
  if (revParse !== null) {
    return revParse;
  }
  if (args[0] === 'show-ref') {
    return showRefOutput;
  }
  if (args[0] === 'ls-files' && args.includes('--others') && args.includes('--ignored')) {
    return ignoredPaths.join('\0');
  }
  if (args[0] === 'ls-files') {
    return trackedPaths.join('\0');
  }
  throw new Error(`unexpected git command: ${args.join(' ')}`);
}

function makeRepoExec(repoDir, options = {}) {
  return async ({ args }) => {
    return repoExecResult(repoDir, options, args);
  };
}

async function seedRepoLayout(repoDir) {
  await mkdir(path.join(repoDir, '.git', 'objects'), { recursive: true });
  await mkdir(path.join(repoDir, '.git', 'refs', 'heads'), { recursive: true });
  await mkdir(path.join(repoDir, 'src'), { recursive: true });
  await mkdir(path.join(repoDir, 'node_modules', 'leftpad'), { recursive: true });
  await mkdir(path.join(repoDir, 'coverage'), { recursive: true });
  await writeFile(path.join(repoDir, 'README.md'), 'hello world');
  await writeFile(path.join(repoDir, 'src', 'app.js'), 'export const app = true;\n');
  await writeFile(path.join(repoDir, 'node_modules', 'leftpad', 'index.js'), 'module.exports = () => 42;\n');
  await writeFile(path.join(repoDir, 'coverage', 'summary.txt'), 'ignored coverage\n');
  await writeFile(path.join(repoDir, '.git', 'objects', 'pack-1'), 'packdata');
  await writeFile(path.join(repoDir, '.git', 'refs', 'heads', 'main'), 'deadbeef');
}

function readTreemapManifest(treeOid) {
  if (treeOid === 'source-tree') {
    return { toJSON: () => ({ size: 4096, chunks: [{ size: 2048 }, { size: 2048 }] }) };
  }
  if (treeOid === 'vault-tree') {
    return { toJSON: () => ({ size: 2048, chunks: [{ size: 2048 }], encryption: { algorithm: 'aes-256-gcm' } }) };
  }
  if (treeOid === 'feedfacecafebeef') {
    return { toJSON: () => ({ size: 3072, chunks: [{ size: 1024 }, { size: 2048 }] }) };
  }
  throw new Error(`unknown tree ${treeOid}`);
}

function makeRepositoryTreemapCas(plumbing) {
  return {
    listVault: vi.fn().mockResolvedValue([{ slug: 'vault:alpha', treeOid: 'vault-tree' }]),
    getVaultMetadata: vi.fn().mockResolvedValue(null),
    readManifest: vi.fn().mockImplementation(async ({ treeOid }) => readTreemapManifest(treeOid)),
    getService: vi.fn().mockResolvedValue({
      persistence: {
        plumbing,
        readBlob: vi.fn(async (oid) => {
          if (oid === 'index-blob') {
            return Buffer.from(JSON.stringify({
              entries: {
                alpha: { treeOid: 'source-tree' },
                bravo: { treeOid: 'vault-tree' },
              },
            }));
          }
          throw new Error(`unknown blob ${oid}`);
        }),
      },
    }),
    getVaultService: vi.fn().mockResolvedValue({
      ref: {
        resolveRef: vi.fn(async (ref) => {
          if (ref === 'refs/heads/main') {
            return 'plain-commit';
          }
          if (ref === 'refs/warp/demo/seek-cache') {
            return 'index-blob';
          }
          throw new Error(`unknown ref ${ref}`);
        }),
        resolveTree: vi.fn().mockRejectedValue(new Error('not a cas tree')),
      },
    }),
  };
}

function makeSourceTreemapCas(plumbing) {
  return {
    readManifest: vi.fn().mockImplementation(async ({ treeOid }) => readTreemapManifest(treeOid)),
    getService: vi.fn().mockResolvedValue({ persistence: { plumbing } }),
  };
}

async function buildRepositoryReport({ source = { type: 'oid', treeOid: 'source-tree' }, worktreeMode = 'tracked' } = {}) {
  return withRepositoryTreemapCase(async ({ cas, repoDir }) => ({
    report: await buildRepoTreemapReport(cas, { source, scope: 'repository', worktreeMode }),
    repoDir,
  }));
}

async function buildSourceReport() {
  return withTempRepo(async (repoDir) => {
    const plumbing = makePlumbing(repoDir, makeRepoExec(repoDir));
    const cas = makeSourceTreemapCas(plumbing);
    return buildRepoTreemapReport(cas, {
      source: { type: 'oid', treeOid: 'feedfacecafebeef' },
      scope: 'source',
    });
  });
}

async function withRepositoryTreemapCase(run) {
  return withTempRepo(async (repoDir) => {
    await seedRepoLayout(repoDir);
    const plumbing = makePlumbing(repoDir, makeRepoExec(repoDir, {
      showRefOutput: [
        '1111111111111111111111111111111111111111 refs/heads/main',
        '2222222222222222222222222222222222222222 refs/warp/demo/seek-cache',
      ].join('\n'),
      trackedPaths: ['README.md', 'src/app.js'],
      ignoredPaths: ['node_modules/', 'coverage/'],
    }));
    const cas = makeRepositoryTreemapCas(plumbing);
    return run({ repoDir, plumbing, cas });
  });
}

describe('readSourceEntries vault and oid modes', () => {
  it('loads vault entries through the vault service facade', async () => {
    const entries = [{ slug: 'alpha', treeOid: 'deadbeef' }];
    const metadata = { version: 1 };
    const cas = {
      listVault: vi.fn().mockResolvedValue(entries),
      getVaultMetadata: vi.fn().mockResolvedValue(metadata),
    };

    await expect(readSourceEntries(cas, { type: 'vault' })).resolves.toEqual({ entries, metadata });
  });

  it('builds a single entry for a direct tree oid source', async () => {
    const cas = {};

    await expect(
      readSourceEntries(cas, { type: 'oid', treeOid: '0123456789abcdef' }),
    ).resolves.toEqual({
      entries: [{ slug: 'oid:0123456789ab', treeOid: '0123456789abcdef' }],
      metadata: null,
    });
  });
});

describe('readSourceEntries ref tree resolution', () => {
  it('treats a ref that resolves directly to a CAS tree as a single source entry', async () => {
    const persistence = makePersistence();
    const ref = makeRefPort({
      resolveRef: vi.fn().mockResolvedValue('tree-oid-123'),
    });
    const cas = {
      readManifest: vi.fn().mockResolvedValue({ slug: 'alpha' }),
      getService: vi.fn().mockResolvedValue({ persistence }),
      getVaultService: vi.fn().mockResolvedValue({ ref }),
    };

    await expect(
      readSourceEntries(cas, { type: 'ref', ref: 'refs/apps/direct' }),
    ).resolves.toEqual({
      entries: [{ slug: 'refs/apps/direct', treeOid: 'tree-oid-123' }],
      metadata: null,
    });
    expect(persistence.readBlob).not.toHaveBeenCalled();
  });
});

describe('readSourceEntries ref-backed JSON indexes', () => {
  it('extracts tree oids from a ref-backed JSON index blob', async () => {
    const persistence = makePersistence({
      readBlob: vi.fn().mockResolvedValue(Buffer.from(JSON.stringify({
        schemaVersion: 1,
        entries: {
          'v1:t10-bbb': { treeOid: 'tree-bbb' },
          'v1:t20-aaa': { treeOid: 'tree-aaa' },
        },
      }))),
    });
    const ref = makeRefPort({
      resolveRef: vi.fn().mockResolvedValue('blob-oid'),
      resolveTree: vi.fn().mockRejectedValue(new Error('not a commit')),
    });
    const cas = {
      readManifest: vi.fn().mockRejectedValue(new Error('not a manifest')),
      getService: vi.fn().mockResolvedValue({ persistence }),
      getVaultService: vi.fn().mockResolvedValue({ ref }),
    };

    await expect(
      readSourceEntries(cas, { type: 'ref', ref: 'refs/warp/demo/seek-cache' }),
    ).resolves.toEqual({
      entries: [
        { slug: 'v1:t10-bbb', treeOid: 'tree-bbb' },
        { slug: 'v1:t20-aaa', treeOid: 'tree-aaa' },
      ],
      metadata: null,
    });
  });
});

describe('loadDoctorCmd', () => {
  it('threads an unlocked vault encryption key into health inspection', async () => {
    const encryptionKey = Uint8Array.from({ length: 32 }, (_, index) => index);
    const readState = vi.fn().mockResolvedValue({
      entries: new Map(),
      parentCommitOid: 'commit-1',
      metadata: { version: 1, encryption: { kdf: { algorithm: 'pbkdf2' } } },
    });
    const cas = {
      getVaultService: vi.fn().mockResolvedValue({ readState }),
      readManifest: vi.fn(),
    };

    const message = await loadDoctorCmd(cas, {
      source: { type: 'vault' },
      entries: [],
      encryptionKey,
    })();

    expect(message.type).toBe('loaded-doctor');
    expect(readState).toHaveBeenCalledWith({ encryptionKey });
  });
});

describe('readSourceEntries commit message hints', () => {
  it('extracts a manifest tree hint from a ref-target commit message', async () => {
    const persistence = makePersistence({
      readBlob: vi.fn().mockRejectedValue(new Error('not a blob')),
      plumbing: {
        execute: vi.fn().mockResolvedValue('asset:image.png\n\nmanifest: feedfacecafebeef\n'),
      },
    });
    const ref = makeRefPort({
      resolveRef: vi.fn().mockResolvedValue('commit-oid'),
      resolveTree: vi.fn().mockRejectedValue(new Error('not a cas tree')),
    });
    const cas = {
      readManifest: vi.fn().mockRejectedValue(new Error('not a manifest')),
      getService: vi.fn().mockResolvedValue({ persistence }),
      getVaultService: vi.fn().mockResolvedValue({ ref }),
    };

    await expect(
      readSourceEntries(cas, { type: 'ref', ref: 'refs/git-cms/chunks/logo@current' }),
    ).resolves.toEqual({
      entries: [{ slug: 'refs/git-cms/chunks/logo@current', treeOid: 'feedfacecafebeef' }],
      metadata: null,
    });
  });
});

describe('buildRepoTreemapReport repository scope', () => {
  it('builds a repository-scope atlas from git ls-files instead of raw disk children', async () => {
    const { report, repoDir } = await buildRepositoryReport();
    expect(report.scope).toBe('repository');
    expect(report.worktreeMode).toBe('tracked');
    expect(report.cwd).toBe(repoDir);
    expect(report.summary.worktreeItems).toBeGreaterThan(0);
    expect(report.summary.worktreePaths).toBe(2);
    expect(report.summary.refCount).toBe(2);
    expect(report.summary.vaultEntries).toBe(1);
    expect(report.summary.sourceEntries).toBe(1);
    const labels = report.tiles.map((tile) => tile.label);
    expect(labels).toEqual(expect.arrayContaining([
      'README.md',
      'src',
      '.git/objects',
      'refs/heads',
      'refs/warp',
      'vault:alpha',
      'oid:source-tree',
    ]));
    expect(labels).not.toContain('node_modules');
    expect(report.notes).toEqual(expect.arrayContaining([
      expect.stringContaining('Press r to browse refs'),
      expect.stringContaining('git ls-files'),
    ]));
  });

  it('can switch repository scope to ignored worktree paths', async () => {
    const { report } = await buildRepositoryReport({
      source: { type: 'vault' },
      worktreeMode: 'ignored',
    });
    const labels = report.tiles.map((tile) => tile.label);
    expect(report.worktreeMode).toBe('ignored');
    expect(report.summary.worktreePaths).toBe(2);
    expect(labels).toEqual(expect.arrayContaining(['node_modules', 'coverage']));
    expect(labels).not.toContain('README.md');
    expect(report.notes).toEqual(expect.arrayContaining([
      expect.stringContaining('--others --ignored --exclude-standard'),
    ]));
  });
});

describe('buildRepoTreemapReport repository drilldown', () => {
  it('can drill into git objects and ref namespaces', async () => {
    await withRepositoryTreemapCase(async ({ cas }) => {
      const objectsReport = await buildRepoTreemapReport(cas, {
        source: { type: 'oid', treeOid: 'source-tree' },
        scope: 'repository',
        drillPath: [{ kind: 'git', segments: ['.git/objects'], label: '.git/objects' }],
      });
      expect(objectsReport.breadcrumb).toEqual(['repository', '.git/objects']);
      expect(objectsReport.tiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'pack-1', kind: 'git' }),
      ]));

      const refsReport = await buildRepoTreemapReport(cas, {
        source: { type: 'oid', treeOid: 'source-tree' },
        scope: 'repository',
        drillPath: [{ kind: 'ref', segments: ['refs/warp'], label: 'refs/warp' }],
      });
      expect(refsReport.tiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'demo', kind: 'ref', drillable: true }),
      ]));
    });
  });
});

describe('buildRepoTreemapReport source scope', () => {
  it('builds a source-scope treemap from logical source entries', async () => {
    const report = await buildSourceReport();
    expect(report.scope).toBe('source');
    expect(report.worktreeMode).toBe('tracked');
    expect(report.summary.sourceEntries).toBe(1);
    expect(report.tiles).toEqual([
      expect.objectContaining({
        label: 'oid:feedfacecafe',
        kind: 'cas',
      }),
    ]);
    expect(report.notes).toEqual(expect.arrayContaining([
      expect.stringContaining('Loaded 1 source entry'),
      expect.stringContaining('logical manifest size'),
    ]));
  });
});

describe('readRefInventory', () => {
  it('classifies refs by namespace and marks CAS-backed refs as browsable', async () => {
    const { report } = await buildRepositoryReport();
    const repoDir = report.cwd;
    const plumbing = makePlumbing(repoDir, makeRepoExec(repoDir, {
      showRefOutput: [
        '1111111111111111111111111111111111111111 refs/heads/main',
        '2222222222222222222222222222222222222222 refs/warp/demo/seek-cache',
      ].join('\n'),
      trackedPaths: ['README.md', 'src/app.js'],
      ignoredPaths: ['node_modules/', 'coverage/'],
    }));
    const cas = makeRepositoryTreemapCas(plumbing);

    const inventory = await readRefInventory(cas);

    expect(inventory.namespaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ namespace: 'refs/heads', count: 1 }),
      expect.objectContaining({ namespace: 'refs/warp', count: 1, browsable: 1 }),
    ]));
    expect(inventory.refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ref: 'refs/warp/demo/seek-cache',
        browsable: true,
        resolution: 'index',
        entryCount: 2,
      }),
      expect.objectContaining({
        ref: 'refs/heads/main',
        browsable: false,
      }),
    ]));
  });
});
