import { describe, expect, it, vi } from 'vitest';
import CasError from '../../../../src/domain/errors/CasError.js';
import { ErrorCodes } from '../../../../src/domain/errors/index.js';
import VaultPersistence from '../../../../src/domain/services/VaultPersistence.js';
import { utf8Encode } from '../../../../src/domain/encoding/utf8.js';

function mockPersistence(overrides = {}) {
  return {
    writeBlob: vi.fn(),
    writeTree: vi.fn(),
    readBlob: vi.fn(),
    readTree: vi.fn(),
    readTreeEntry: vi.fn(),
    iterateTree: vi.fn(),
    ...overrides,
  };
}

function mockRef(overrides = {}) {
  return {
    resolveRef: vi.fn(),
    resolveTree: vi.fn(),
    createCommit: vi.fn(),
    updateRef: vi.fn(),
    ...overrides,
  };
}

function metadataBytes(metadata = { version: 1 }) {
  return utf8Encode(JSON.stringify(metadata));
}

describe('VaultPersistence head reads', () => {
  it('resolves no vault as null', async () => {
    const ref = mockRef({
      resolveRef: vi.fn(async () => {
        const error = new Error('refs/cas/vault is not defined');
        error.code = ErrorCodes.GIT_REF_NOT_FOUND;
        throw error;
      }),
    });
    const vaultPersistence = new VaultPersistence({ persistence: mockPersistence(), ref });

    await expect(vaultPersistence.resolveHead()).resolves.toBeNull();
  });

  it('resolves plumbing missing-ref errors as null', async () => {
    const rootCause = Object.assign(new Error('Git command failed with code 128'), {
      details: {
        stderr: "fatal: ambiguous argument 'refs/cas/vault': unknown revision",
      },
    });
    const ref = mockRef({ resolveRef: vi.fn().mockRejectedValue(rootCause) });
    const vaultPersistence = new VaultPersistence({ persistence: mockPersistence(), ref });

    await expect(vaultPersistence.resolveHead()).resolves.toBeNull();
  });

  it('resolves the current vault head', async () => {
    const ref = mockRef({
      resolveRef: vi.fn().mockResolvedValue('commit-oid'),
      resolveTree: vi.fn().mockResolvedValue('tree-oid'),
    });
    const vaultPersistence = new VaultPersistence({ persistence: mockPersistence(), ref });

    await expect(vaultPersistence.resolveHead()).resolves.toEqual({
      commitOid: 'commit-oid',
      treeOid: 'tree-oid',
    });
  });
});

describe('VaultPersistence corrupt head reads', () => {
  it('surfaces resolved vault heads whose tree cannot be resolved', async () => {
    const rootCause = new Error('object database cannot read tree');
    const ref = mockRef({
      resolveRef: vi.fn().mockResolvedValue('commit-oid'),
      resolveTree: vi.fn().mockRejectedValue(rootCause),
    });
    const vaultPersistence = new VaultPersistence({ persistence: mockPersistence(), ref });

    await expect(vaultPersistence.resolveHead()).rejects.toMatchObject({
      code: 'VAULT_HEAD_INVALID',
      meta: {
        commitOid: 'commit-oid',
        originalError: rootCause,
      },
    });
  });

  it('surfaces vault ref resolution failures that are not missing-ref errors', async () => {
    const rootCause = new Error('permission denied while reading refs/cas/vault');
    const ref = mockRef({ resolveRef: vi.fn().mockRejectedValue(rootCause) });
    const vaultPersistence = new VaultPersistence({ persistence: mockPersistence(), ref });

    await expect(vaultPersistence.resolveHead()).rejects.toMatchObject({
      code: 'VAULT_HEAD_INVALID',
      meta: {
        originalError: rootCause,
      },
    });
  });
});

describe('VaultPersistence missing-ref classification', () => {
  it('does not hide object database failures behind missing-ref text', async () => {
    const rootCause = new Error('object not found while reading refs/cas/vault');
    const ref = mockRef({ resolveRef: vi.fn().mockRejectedValue(rootCause) });
    const vaultPersistence = new VaultPersistence({ persistence: mockPersistence(), ref });

    await expect(vaultPersistence.resolveHead()).rejects.toMatchObject({
      code: 'VAULT_HEAD_INVALID',
      meta: {
        originalError: rootCause,
      },
    });
  });

  it('does not treat corrupt vault head stderr as an absent vault ref', async () => {
    const rootCause = Object.assign(new Error('Git command failed with code 128'), {
      details: {
        stderr: 'fatal: bad object refs/cas/vault\nobject not found',
      },
    });
    const ref = mockRef({ resolveRef: vi.fn().mockRejectedValue(rootCause) });
    const vaultPersistence = new VaultPersistence({ persistence: mockPersistence(), ref });

    await expect(vaultPersistence.resolveHead()).rejects.toMatchObject({
      code: 'VAULT_HEAD_INVALID',
      meta: {
        originalError: rootCause,
      },
    });
  });
});

describe('VaultPersistence tree reads', () => {
  it('reads metadata through targeted tree lookup without materializing the tree', async () => {
    const persistence = mockPersistence({
      readTree: vi.fn(async () => { throw new Error('full tree should not be read'); }),
      readTreeEntry: vi.fn(async () => ({
        mode: '100644',
        type: 'blob',
        oid: 'meta-oid',
        name: '.vault.json',
      })),
      readBlob: vi.fn(async () => metadataBytes({ version: 1 })),
    });
    const vaultPersistence = new VaultPersistence({ persistence, ref: mockRef() });

    await expect(vaultPersistence.readMetadata('tree-oid')).resolves.toEqual({ version: 1 });
    expect(persistence.readTree).not.toHaveBeenCalled();
  });
});

describe('VaultPersistence entry reads', () => {
  it('resolves one persisted entry through targeted lookup without materializing the tree', async () => {
    const persistence = mockPersistence({
      readTree: vi.fn(async () => { throw new Error('full tree should not be read'); }),
      readTreeEntry: vi.fn(async () => ({
        mode: '040000',
        type: 'tree',
        oid: 'entry-tree',
        name: 'demo%2Fhello',
      })),
    });
    const vaultPersistence = new VaultPersistence({ persistence, ref: mockRef() });

    await expect(vaultPersistence.readEntry('tree-oid', 'demo%2Fhello')).resolves.toMatchObject({
      oid: 'entry-tree',
    });
    expect(persistence.readTree).not.toHaveBeenCalled();
  });

  it('streams entries through iterateTree without materializing the tree', async () => {
    const persistence = mockPersistence({
      readTree: vi.fn(async () => { throw new Error('full tree should not be read'); }),
      iterateTree: vi.fn(async function* iterateTree() {
        yield { mode: '040000', type: 'tree', oid: 'entry-tree', name: 'demo%2Fhello' };
      }),
    });
    const vaultPersistence = new VaultPersistence({ persistence, ref: mockRef() });
    const entries = [];

    for await (const entry of vaultPersistence.iterateEntries('tree-oid')) {
      entries.push(entry);
    }

    expect(entries).toEqual([
      { mode: '040000', type: 'tree', oid: 'entry-tree', name: 'demo%2Fhello' },
    ]);
    expect(persistence.readTree).not.toHaveBeenCalled();
  });
});

describe('VaultPersistence generic ref update failures', () => {
  it('does not classify generic ref update failures as retryable vault conflicts', async () => {
    const rootCause = new Error('permission denied while updating refs/cas/vault');
    const persistence = mockPersistence({
      writeBlob: vi.fn().mockResolvedValueOnce('meta-oid'),
      writeTree: vi.fn().mockResolvedValueOnce('tree-oid'),
    });
    const ref = mockRef({
      createCommit: vi.fn().mockResolvedValueOnce('commit-new'),
      updateRef: vi.fn().mockRejectedValueOnce(rootCause),
      resolveRef: vi.fn().mockResolvedValueOnce('commit-current'),
    });
    const vaultPersistence = new VaultPersistence({ persistence, ref });

    await expect(vaultPersistence.writeCommit({
      entries: new Map([['demo/hello', 'entry-tree']]),
      metadata: { version: 1 },
      parentCommitOid: 'commit-expected',
      message: 'vault: test',
    })).rejects.toMatchObject({
      code: 'VAULT_REF_UPDATE_FAILED',
      meta: {
        expectedOldOid: 'commit-expected',
        actualOldOid: 'commit-current',
        newCommit: 'commit-new',
        originalError: rootCause,
      },
    });
  });
});

describe('VaultPersistence conflict writes', () => {
  it('writes a vault commit and normalizes ref update failures as VAULT_CONFLICT', async () => {
    const rootCause = new CasError(
      'Ref update rejected for refs/cas/vault',
      ErrorCodes.GIT_ERROR,
      {
        ref: 'refs/cas/vault',
        expectedOldOid: 'commit-expected',
        actualOldOid: 'commit-actual',
        newOid: 'commit-new',
      },
    );
    const persistence = mockPersistence({
      writeBlob: vi.fn().mockResolvedValueOnce('meta-oid'),
      writeTree: vi.fn().mockResolvedValueOnce('tree-oid'),
    });
    const ref = mockRef({
      createCommit: vi.fn().mockResolvedValueOnce('commit-new'),
      updateRef: vi.fn().mockRejectedValueOnce(rootCause),
      resolveRef: vi.fn(async () => {
        throw new Error('actual OID should come from structured conflict metadata');
      }),
    });
    const vaultPersistence = new VaultPersistence({ persistence, ref });

    await expect(vaultPersistence.writeCommit({
      entries: new Map([['demo/hello', 'entry-tree']]),
      metadata: { version: 1 },
      parentCommitOid: 'commit-expected',
      message: 'vault: test',
    })).rejects.toMatchObject({
      code: 'VAULT_CONFLICT',
      meta: {
        expectedOldOid: 'commit-expected',
        actualOldOid: 'commit-actual',
        newCommit: 'commit-new',
        originalError: rootCause,
      },
    });
    expect(ref.updateRef).toHaveBeenCalledWith({
      ref: 'refs/cas/vault',
      newOid: 'commit-new',
      expectedOldOid: 'commit-expected',
    });
  });
});

describe('VaultPersistence privacy writes', () => {
  it('writes privacy index bytes without knowing privacy crypto policy', async () => {
    const persistence = mockPersistence({
      writeBlob: vi.fn()
        .mockResolvedValueOnce('privacy-oid')
        .mockResolvedValueOnce('meta-oid'),
      writeTree: vi.fn().mockResolvedValueOnce('tree-oid'),
    });
    const ref = mockRef({
      createCommit: vi.fn().mockResolvedValueOnce('commit-new'),
      updateRef: vi.fn().mockResolvedValueOnce(undefined),
    });
    const vaultPersistence = new VaultPersistence({ persistence, ref });

    await vaultPersistence.writeCommit({
      entries: new Map([['demo/hello', 'entry-tree']]),
      persistedNameBySlug: new Map([['demo/hello', 'a'.repeat(64)]]),
      privacyIndexBytes: Uint8Array.from([1, 2, 3]),
      metadata: { version: 1, privacy: { enabled: true } },
      parentCommitOid: null,
      message: 'vault: test',
    });

    expect(persistence.writeTree.mock.calls[0][0]).toEqual([
      '100644 blob meta-oid\t.vault.json',
      `040000 tree entry-tree\t${'a'.repeat(64)}`,
      '100644 blob privacy-oid\t.privacy-index',
    ]);
  });
});

describe('VaultPersistence constructor', () => {
  it('uses CasError for invalid constructor dependencies', () => {
    expect(() => new VaultPersistence({ persistence: {}, ref: mockRef() })).toThrow(CasError);
  });
});
