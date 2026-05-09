import { describe, it, expect, vi, beforeEach } from 'vitest';
import VaultService from '../../../src/domain/services/VaultService.js';
import CasError from '../../../src/domain/errors/CasError.js';

const LONG_TEST_TIMEOUT_MS = 60000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockPersistence() {
  return {
    writeBlob: vi.fn(),
    writeTree: vi.fn(),
    readBlob: vi.fn(),
    readTree: vi.fn(),
    readTreeEntry: vi.fn(),
    iterateTree: vi.fn(),
  };
}

function mockRef() {
  return {
    resolveRef: vi.fn(),
    resolveTree: vi.fn(),
    createCommit: vi.fn(),
    updateRef: vi.fn(),
  };
}

function mockCrypto() {
  return {
    deriveKey: vi.fn().mockResolvedValue({
      key: Buffer.alloc(32),
      salt: Buffer.alloc(32, 0x11),
      params: { algorithm: 'pbkdf2', iterations: 100000, keyLength: 32 },
    }),
    encryptBuffer: vi.fn().mockResolvedValue({
      buf: Buffer.from('git-cas-vault-verifier-v1'),
      meta: {
        algorithm: 'aes-256-gcm',
        nonce: 'AAAAAAAAAAAAAAAA',
        tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
        encrypted: true,
      },
    }),
    decryptBuffer: vi.fn().mockResolvedValue(Buffer.from('git-cas-vault-verifier-v1')),
    hmacSha256: vi.fn().mockReturnValue(Buffer.alloc(32, 0xab)),
  };
}

function mockObservability() {
  return { metric: vi.fn(), log: vi.fn(), span: vi.fn().mockReturnValue({ end: vi.fn() }) };
}

function createVault(overrides = {}) {
  return new VaultService({
    persistence: overrides.persistence || mockPersistence(),
    ref: overrides.ref || mockRef(),
    crypto: overrides.crypto || mockCrypto(),
    observability: overrides.observability || mockObservability(),
  });
}

function treeEntries(metaOid, extras = []) {
  return [
    { mode: '100644', type: 'blob', oid: metaOid, name: '.vault.json' },
    ...extras,
  ];
}

function setupNoVault(ref) {
  ref.resolveRef.mockRejectedValueOnce(Object.assign(
    new Error('refs/cas/vault is not defined'),
    { code: 'GIT_REF_NOT_FOUND' },
  ));
}

function setupExistingVault({ ref, persistence, metaJson, entries = [] }) {
  ref.resolveRef.mockResolvedValueOnce('commit-oid-1');
  ref.resolveTree.mockResolvedValueOnce('tree-oid-1');
  persistence.readTree.mockResolvedValueOnce(treeEntries('meta-blob-oid', entries));
  persistence.readBlob.mockResolvedValueOnce(Buffer.from(metaJson));
}

function setupWriteSuccess(persistence, ref) {
  persistence.writeBlob.mockResolvedValueOnce('meta-blob-oid');
  persistence.writeTree.mockResolvedValueOnce('new-tree-oid');
  ref.createCommit.mockResolvedValueOnce('new-commit-oid');
  ref.updateRef.mockResolvedValueOnce(undefined);
}

function parseWrittenMetadata(persistence, index = 0) {
  return JSON.parse(Buffer.from(persistence.writeBlob.mock.calls[index][0]).toString());
}

const VAULT_REF = VaultService.VAULT_REF;

// ---------------------------------------------------------------------------
// validateSlug – valid
// ---------------------------------------------------------------------------
describe('validateSlug – valid slugs', () => {
  let vault;
  beforeEach(() => { vault = createVault(); });

  it('accepts simple slug', () => {
    expect(() => vault.validateSlug('a')).not.toThrow();
  });

  it('accepts slug with slash', () => {
    expect(() => vault.validateSlug('demo/hello')).not.toThrow();
  });

  it('accepts slug with dashes and numbers', () => {
    expect(() => vault.validateSlug('photos/beach-2024')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateSlug – invalid
// ---------------------------------------------------------------------------
describe('validateSlug – invalid slugs', () => {
  let vault;
  beforeEach(() => { vault = createVault(); });

  function expectInvalidSlug(slug) {
    try {
      vault.validateSlug(slug);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CasError);
      expect(e.code).toBe('INVALID_SLUG');
    }
  }

  it('rejects empty string', () => { expectInvalidSlug(''); });
  it('rejects non-string', () => { expectInvalidSlug(null); });
  it('rejects leading slash', () => { expectInvalidSlug('/a'); });
  it('rejects trailing slash', () => { expectInvalidSlug('a/'); });
  it('rejects double slash', () => { expectInvalidSlug('a//b'); });
  it('rejects "." segment', () => { expectInvalidSlug('a/./b'); });
  it('rejects ".." segment', () => { expectInvalidSlug('a/../b'); });
  it('rejects tab', () => { expectInvalidSlug('a/b\tc'); });
  it('rejects NUL', () => { expectInvalidSlug('a/b\x00c'); });
  it('rejects newline', () => { expectInvalidSlug('a/b\nc'); });
  it('rejects >1024 bytes total', () => { expectInvalidSlug('a'.repeat(1025)); });
  it('rejects segment >255 bytes', () => { expectInvalidSlug('a'.repeat(256)); });
});

// ---------------------------------------------------------------------------
// readState – no vault
// ---------------------------------------------------------------------------
describe('readState – no vault', () => {
  it('returns empty state when resolveRef fails', async () => {
    const ref = mockRef();
    setupNoVault(ref);
    const vault = createVault({ ref });

    const state = await vault.readState();
    expect(state.entries.size).toBe(0);
    expect(state.parentCommitOid).toBeNull();
    expect(state.metadata).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readState – existing vault
// ---------------------------------------------------------------------------
describe('readState – existing vault', () => {
  it('parses vault with entries and metadata', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }), entries: [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
      { mode: '040000', type: 'tree', oid: 'entry-tree-2', name: 'photos/beach' },
    ] });

    const vault = createVault({ ref, persistence });
    const state = await vault.readState();

    expect(state.parentCommitOid).toBe('commit-oid-1');
    expect(state.entries.size).toBe(2);
    expect(state.entries.get('demo/hello')).toBe('entry-tree-1');
    expect(state.metadata).toEqual({ version: 1 });
  });
});

// ---------------------------------------------------------------------------
// readState – decodes percent-encoded slugs
// ---------------------------------------------------------------------------
describe('readState – decodes percent-encoded slugs', () => {
  it('decodes percent-encoded tree entry names', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }), entries: [
      { mode: '040000', type: 'tree', oid: 'tree-a', name: 'demo%2Fhello' },
      { mode: '040000', type: 'tree', oid: 'tree-b', name: 'a%2Fb%2Fc' },
    ] });
    const vault = createVault({ ref, persistence });
    const state = await vault.readState();
    expect(state.entries.get('demo/hello')).toBe('tree-a');
    expect(state.entries.get('a/b/c')).toBe('tree-b');
  });
});

describe('readState – cache unchanged tree', () => {
  it('reuses parsed state for unchanged vault tree OIDs while preserving current commit parent', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    ref.resolveRef
      .mockResolvedValueOnce('commit-oid-1')
      .mockResolvedValueOnce('commit-oid-2');
    ref.resolveTree.mockResolvedValue('tree-oid-1');
    persistence.readTree.mockResolvedValue(treeEntries('meta-blob-oid', [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo%2Fhello' },
    ]));
    persistence.readBlob.mockResolvedValue(Buffer.from(JSON.stringify({ version: 1 })));

    const vault = createVault({ ref, persistence });
    const first = await vault.readState();
    const second = await vault.readState();

    expect(first.parentCommitOid).toBe('commit-oid-1');
    expect(second.parentCommitOid).toBe('commit-oid-2');
    expect(second.entries.get('demo/hello')).toBe('entry-tree-1');
    expect(persistence.readTree).toHaveBeenCalledOnce();
    expect(persistence.readBlob).toHaveBeenCalledOnce();
  });
});

describe('readState – cache invalidation', () => {
  it('invalidates parsed state when the vault tree OID changes', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    ref.resolveRef
      .mockResolvedValueOnce('commit-oid-1')
      .mockResolvedValueOnce('commit-oid-2');
    ref.resolveTree
      .mockResolvedValueOnce('tree-oid-1')
      .mockResolvedValueOnce('tree-oid-2');
    persistence.readTree
      .mockResolvedValueOnce(treeEntries('meta-blob-oid-1', [
        { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'old' },
      ]))
      .mockResolvedValueOnce(treeEntries('meta-blob-oid-2', [
        { mode: '040000', type: 'tree', oid: 'entry-tree-2', name: 'new' },
      ]));
    persistence.readBlob
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ version: 1 })))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ version: 1 })));

    const vault = createVault({ ref, persistence });
    const first = await vault.readState();
    const second = await vault.readState();

    expect(first.entries.get('old')).toBe('entry-tree-1');
    expect(second.entries.get('new')).toBe('entry-tree-2');
    expect(second.entries.has('old')).toBe(false);
    expect(persistence.readTree).toHaveBeenCalledTimes(2);
    expect(persistence.readBlob).toHaveBeenCalledTimes(2);
  });
});

describe('readState – cache defensive copies', () => {
  it('returns defensive copies from cached vault state', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    ref.resolveRef.mockResolvedValue('commit-oid-1');
    ref.resolveTree.mockResolvedValue('tree-oid-1');
    persistence.readTree.mockResolvedValue(treeEntries('meta-blob-oid', [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo%2Fhello' },
    ]));
    persistence.readBlob.mockResolvedValue(Buffer.from(JSON.stringify({ version: 1 })));

    const vault = createVault({ ref, persistence });
    const first = await vault.readState();
    first.entries.set('mutated', 'tree-mutated');
    first.metadata.version = 99;

    const second = await vault.readState();
    expect(second.entries.has('mutated')).toBe(false);
    expect(second.metadata).toEqual({ version: 1 });
  });
});

// ---------------------------------------------------------------------------
// readState – metadata errors
// ---------------------------------------------------------------------------
describe('readState – metadata errors', () => {
  it('throws VAULT_METADATA_INVALID for unknown version', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 99 }) });
    const vault = createVault({ ref, persistence });

    await expect(vault.readState()).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_METADATA_INVALID',
    );
  });

  it('throws VAULT_METADATA_INVALID for non-JSON blob', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: 'not-json' });
    const vault = createVault({ ref, persistence });

    await expect(vault.readState()).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_METADATA_INVALID',
    );
  });

  it('throws when encryption fields are incomplete', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const bad = JSON.stringify({
      version: 1,
      encryption: { cipher: 'aes-256-gcm', kdf: { algorithm: 'pbkdf2' } },
    });
    setupExistingVault({ ref, persistence, metaJson: bad });
    const vault = createVault({ ref, persistence });

    await expect(vault.readState()).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_METADATA_INVALID',
    );
  });

});

// ---------------------------------------------------------------------------
// readState – missing kdf.keyLength
// ---------------------------------------------------------------------------
describe('readState – missing kdf.keyLength', () => {
  it('throws VAULT_METADATA_INVALID when kdf.keyLength is missing', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const bad = JSON.stringify({
      version: 1,
      encryption: {
        cipher: 'aes-256-gcm',
        kdf: { algorithm: 'pbkdf2', salt: 'abc', iterations: 100000 },
      },
    });
    setupExistingVault({ ref, persistence, metaJson: bad });
    const vault = createVault({ ref, persistence });

    await expect(vault.readState()).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_METADATA_INVALID',
    );
  });
});

describe('readState – malformed kdf.salt', () => {
  it('throws VAULT_METADATA_INVALID when kdf.salt is not canonical base64', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const bad = JSON.stringify({
      version: 1,
      encryption: {
        cipher: 'aes-256-gcm',
        kdf: {
          algorithm: 'pbkdf2',
          salt: '%%%bad-base64%%%',
          iterations: 100000,
          keyLength: 32,
        },
      },
    });
    setupExistingVault({ ref, persistence, metaJson: bad });
    const vault = createVault({ ref, persistence });

    await expect(vault.readState()).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_METADATA_INVALID',
    );
  });
});

describe('initVault – KDF policy', () => {
  it('rejects out-of-policy explicit KDF parameters before deriveKey', async () => {
    const ref = mockRef();
    setupNoVault(ref);
    const crypto = mockCrypto();
    const vault = createVault({ ref, crypto });

    await expect(vault.initVault({
      passphrase: 'vault-passphrase',
      kdfOptions: { algorithm: 'pbkdf2', iterations: 99_999 },
    })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'KDF_POLICY_VIOLATION',
    );
    expect(crypto.deriveKey).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addToVault – first entry
// ---------------------------------------------------------------------------
describe('addToVault – first entry (auto-init)', () => {
  it('adds first entry and auto-inits vault', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupNoVault(ref);
    setupWriteSuccess(persistence, ref);
    const vault = createVault({ ref, persistence });

    const result = await vault.addToVault({ slug: 'demo/hello', treeOid: 'entry-tree-1' });
    expect(result.commitOid).toBe('new-commit-oid');

    expect(persistence.writeTree).toHaveBeenCalledOnce();
    const treeArg = persistence.writeTree.mock.calls[0][0];
    expect(treeArg.some((l) => l.includes('.vault.json'))).toBe(true);
    expect(treeArg.some((l) => l.includes('demo%2Fhello'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addToVault – duplicate handling
// ---------------------------------------------------------------------------
describe('addToVault – duplicate handling', () => {
  it('throws VAULT_ENTRY_EXISTS without force', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }), entries: [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo%2Fhello' },
    ] });
    const vault = createVault({ ref, persistence });

    await expect(vault.addToVault({ slug: 'demo/hello', treeOid: 'x' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENTRY_EXISTS',
    );
  });

  it('overwrites existing entry with force', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }), entries: [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
    ] });
    setupWriteSuccess(persistence, ref);
    const vault = createVault({ ref, persistence });

    const result = await vault.addToVault({ slug: 'demo/hello', treeOid: 'entry-tree-2', force: true });
    expect(result.commitOid).toBe('new-commit-oid');
  });
});

// ---------------------------------------------------------------------------
// addToVault – second entry
// ---------------------------------------------------------------------------
describe('addToVault – second entry', () => {
  it('preserves first entry when adding second', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }), entries: [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
    ] });
    setupWriteSuccess(persistence, ref);
    const vault = createVault({ ref, persistence });

    const result = await vault.addToVault({ slug: 'photos/beach', treeOid: 'entry-tree-2' });
    expect(result.commitOid).toBe('new-commit-oid');

    const treeArg = persistence.writeTree.mock.calls[0][0];
    expect(treeArg.some((l) => l.includes('demo%2Fhello'))).toBe(true);
    expect(treeArg.some((l) => l.includes('photos%2Fbeach'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listVault
// ---------------------------------------------------------------------------
describe('listVault – empty', () => {
  it('returns empty array when no vault', async () => {
    const ref = mockRef();
    setupNoVault(ref);
    const vault = createVault({ ref });
    expect(await vault.listVault()).toEqual([]);
  });
});

describe('listVault – populated', () => {
  it('returns sorted entries', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }), entries: [
      { mode: '040000', type: 'tree', oid: 'tree-b', name: 'photos/beach' },
      { mode: '040000', type: 'tree', oid: 'tree-a', name: 'demo/hello' },
    ] });
    const vault = createVault({ ref, persistence });

    expect(await vault.listVault()).toEqual([
      { slug: 'demo/hello', treeOid: 'tree-a' },
      { slug: 'photos/beach', treeOid: 'tree-b' },
    ]);
  });

  it('preserves slugs with slashes', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }), entries: [
      { mode: '040000', type: 'tree', oid: 'tree-a', name: 'a/b/c' },
    ] });
    const vault = createVault({ ref, persistence });
    const entries = await vault.listVault();
    expect(entries[0].slug).toBe('a/b/c');
  });
});

describe('iterateVault – streaming', () => {
  it('yields entries from the persistence iterator without loading the full tree map', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    ref.resolveRef.mockResolvedValueOnce('commit-oid-1');
    ref.resolveTree.mockResolvedValueOnce('tree-oid-1');
    persistence.readTree.mockRejectedValue(new Error('full tree should not be read'));
    persistence.iterateTree.mockImplementation(async function* iterateTree() {
      yield { mode: '100644', type: 'blob', oid: 'meta-blob-oid', name: '.vault.json' };
      yield { mode: '040000', type: 'tree', oid: 'tree-b', name: 'photos%2Fbeach' };
      yield { mode: '040000', type: 'tree', oid: 'tree-a', name: 'demo%2Fhello' };
    });
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(JSON.stringify({ version: 1 })));
    const vault = createVault({ ref, persistence });

    const entries = [];
    for await (const entry of vault.iterateVault()) {
      entries.push(entry);
    }

    expect(entries).toEqual([
      { slug: 'photos/beach', treeOid: 'tree-b' },
      { slug: 'demo/hello', treeOid: 'tree-a' },
    ]);
    expect(persistence.readTree).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeFromVault
// ---------------------------------------------------------------------------
describe('removeFromVault – existing entry', () => {
  it('removes entry and returns removed tree OID', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }), entries: [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
      { mode: '040000', type: 'tree', oid: 'entry-tree-2', name: 'photos/beach' },
    ] });
    setupWriteSuccess(persistence, ref);
    const vault = createVault({ ref, persistence });

    const result = await vault.removeFromVault({ slug: 'demo/hello' });
    expect(result.commitOid).toBe('new-commit-oid');
    expect(result.removedTreeOid).toBe('entry-tree-1');

    const treeArg = persistence.writeTree.mock.calls[0][0];
    expect(treeArg.some((l) => l.includes('demo%2Fhello'))).toBe(false);
    expect(treeArg.some((l) => l.includes('photos%2Fbeach'))).toBe(true);
  });
});

describe('removeFromVault – missing entry', () => {
  it('throws VAULT_ENTRY_NOT_FOUND', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }) });
    const vault = createVault({ ref, persistence });

    await expect(vault.removeFromVault({ slug: 'missing' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENTRY_NOT_FOUND',
    );
  });
});

describe('removeFromVault – last entry', () => {
  it('handles removing last entry (empty tree)', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }), entries: [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'only-entry' },
    ] });
    setupWriteSuccess(persistence, ref);
    const vault = createVault({ ref, persistence });

    const result = await vault.removeFromVault({ slug: 'only-entry' });
    expect(result.removedTreeOid).toBe('entry-tree-1');

    const treeArg = persistence.writeTree.mock.calls[0][0];
    expect(treeArg.some((l) => l.includes('.vault.json'))).toBe(true);
    expect(treeArg.some((l) => l.includes('only-entry'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveVaultEntry
// ---------------------------------------------------------------------------
describe('resolveVaultEntry – found', () => {
  it('returns tree OID', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }), entries: [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo%2Fhello' },
    ] });
    const vault = createVault({ ref, persistence });
    expect(await vault.resolveVaultEntry({ slug: 'demo/hello' })).toBe('entry-tree-1');
  });

  it('uses a path-targeted tree lookup instead of reading the full vault tree', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    ref.resolveRef.mockResolvedValueOnce('commit-oid-1');
    ref.resolveTree.mockResolvedValueOnce('tree-oid-1');
    persistence.readTree.mockRejectedValue(new Error('full tree should not be read'));
    persistence.readTreeEntry.mockImplementation(async (_treeOid, treePath) => {
      if (treePath === '.vault.json') {
        return { mode: '100644', type: 'blob', oid: 'meta-blob-oid', name: '.vault.json' };
      }
      if (treePath === 'demo%2Fhello') {
        return { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo%2Fhello' };
      }
      return null;
    });
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(JSON.stringify({ version: 1 })));
    const vault = createVault({ ref, persistence });

    expect(await vault.resolveVaultEntry({ slug: 'demo/hello' })).toBe('entry-tree-1');
    expect(persistence.readTreeEntry).toHaveBeenCalledWith('tree-oid-1', 'demo%2Fhello');
    expect(persistence.readTree).not.toHaveBeenCalled();
  });
});

describe('resolveVaultEntry – not found', () => {
  it('throws VAULT_ENTRY_NOT_FOUND', async () => {
    const ref = mockRef();
    setupNoVault(ref);
    const vault = createVault({ ref });

    await expect(vault.resolveVaultEntry({ slug: 'missing' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENTRY_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// initVault – without encryption
// ---------------------------------------------------------------------------
describe('initVault – without encryption', () => {
  it('creates vault with { version: 1 }', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupNoVault(ref);
    setupWriteSuccess(persistence, ref);
    const vault = createVault({ ref, persistence });

    const result = await vault.initVault();
    expect(result.commitOid).toBe('new-commit-oid');

    const writtenMetadata = Buffer.from(persistence.writeBlob.mock.calls[0][0]).toString();
    expect(writtenMetadata).toContain('"version": 1');
  });
});

// ---------------------------------------------------------------------------
// initVault – with passphrase
// ---------------------------------------------------------------------------
describe('initVault – with passphrase', () => {
  it('stores KDF params in metadata', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const crypto = mockCrypto();
    setupNoVault(ref);
    setupWriteSuccess(persistence, ref);
    const vault = createVault({ ref, persistence, crypto });

    await vault.initVault({
      passphrase: 'my-secret',
      kdfOptions: { algorithm: 'pbkdf2' },
    });

    expect(crypto.deriveKey).toHaveBeenCalledOnce();
    const writtenMetadata = parseWrittenMetadata(persistence);
    expect(writtenMetadata.version).toBe(1);
    expect(writtenMetadata.encryption.cipher).toBe('aes-256-gcm');
    expect(writtenMetadata.encryption.kdf.algorithm).toBe('pbkdf2');
    expect(writtenMetadata.encryption.kdf.salt).toBeTruthy();
    expect(writtenMetadata.encryption.kdf.keyLength).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// initVault – already encrypted
// ---------------------------------------------------------------------------
describe('initVault – already encrypted', () => {
  it('throws VAULT_ENCRYPTION_ALREADY_CONFIGURED', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const meta = JSON.stringify({
      version: 1,
      encryption: {
        cipher: 'aes-256-gcm',
        kdf: {
          algorithm: 'pbkdf2',
          salt: Buffer.alloc(32, 0x11).toString('base64'),
          iterations: 100000,
          keyLength: 32,
        },
      },
    });
    setupExistingVault({ ref, persistence, metaJson: meta });
    const vault = createVault({ ref, persistence });

    await expect(vault.initVault({ passphrase: 'new' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENCRYPTION_ALREADY_CONFIGURED',
    );
  });
});

// ---------------------------------------------------------------------------
// getVaultMetadata
// ---------------------------------------------------------------------------
describe('getVaultMetadata', () => {
  it('returns null when no vault', async () => {
    const ref = mockRef();
    setupNoVault(ref);
    const vault = createVault({ ref });
    expect(await vault.getVaultMetadata()).toBeNull();
  });

  it('returns metadata when vault exists', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }) });
    const vault = createVault({ ref, persistence });
    expect(await vault.getVaultMetadata()).toEqual({ version: 1 });
  });
});

// ---------------------------------------------------------------------------
// CAS retry – succeeds on second attempt
// ---------------------------------------------------------------------------
describe('CAS retry – succeeds on retry', () => {
  it('retries on VAULT_CONFLICT and succeeds', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();

    // First attempt: no vault → write fails (updateRef rejects)
    setupNoVault(ref);
    persistence.writeBlob.mockResolvedValueOnce('meta-blob-oid');
    persistence.writeTree.mockResolvedValueOnce('new-tree-oid');
    ref.createCommit.mockResolvedValueOnce('commit-1');
    ref.updateRef.mockRejectedValueOnce(new Error('lock failed'));

    // Second attempt: vault now exists → write succeeds
    setupExistingVault({ ref, persistence, metaJson: JSON.stringify({ version: 1 }) });
    setupWriteSuccess(persistence, ref);

    const vault = createVault({ ref, persistence });
    const result = await vault.addToVault({ slug: 'demo/hello', treeOid: 'entry-tree-1' });
    expect(result.commitOid).toBe('new-commit-oid');
  });

  it('retries initVault() on VAULT_CONFLICT and succeeds', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();

    setupNoVault(ref);
    setupNoVault(ref);
    setupNoVault(ref);
    persistence.writeBlob.mockResolvedValueOnce('meta-blob-oid-1');
    persistence.writeBlob.mockResolvedValueOnce('meta-blob-oid-2');
    persistence.writeTree.mockResolvedValueOnce('tree-oid-1');
    persistence.writeTree.mockResolvedValueOnce('tree-oid-2');
    ref.createCommit.mockResolvedValueOnce('commit-1');
    ref.createCommit.mockResolvedValueOnce('commit-2');
    ref.updateRef.mockRejectedValueOnce(new Error('lock failed'));
    ref.updateRef.mockResolvedValueOnce(undefined);

    const vault = createVault({ ref, persistence });
    const result = await vault.initVault();

    expect(result.commitOid).toBe('commit-2');
    expect(ref.updateRef).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// CAS retry – exhausted
// ---------------------------------------------------------------------------
describe('CAS retry – exhausted', () => {
  it('throws VAULT_CONFLICT after all retries', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();

    for (let i = 0; i < 6; i++) {
      setupNoVault(ref);
    }
    for (let i = 0; i < 3; i++) {
      persistence.writeBlob.mockResolvedValueOnce('meta-blob-oid');
      persistence.writeTree.mockResolvedValueOnce('new-tree-oid');
      ref.createCommit.mockResolvedValueOnce(`commit-${i}`);
      ref.updateRef.mockRejectedValueOnce(new Error('lock failed'));
    }

    const vault = createVault({ ref, persistence });

    await expect(vault.addToVault({ slug: 'demo/hello', treeOid: 'x' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_CONFLICT',
    );
  });
});

// ---------------------------------------------------------------------------
// VAULT_CONFLICT – preserves original error
// ---------------------------------------------------------------------------
describe('VAULT_CONFLICT – preserves original error', () => {
  it('includes originalError in VAULT_CONFLICT meta', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupWriteSuccess(persistence, ref);
    ref.updateRef.mockReset();
    const rootCause = new Error('permission denied');
    ref.updateRef.mockRejectedValueOnce(rootCause);
    const vault = createVault({ ref, persistence });

    try {
      await vault.writeCommit({
        entries: new Map(),
        metadata: { version: 1 },
        parentCommitOid: null,
        message: 'test',
      });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CasError);
      expect(e.code).toBe('VAULT_CONFLICT');
      expect(e.meta.originalError).toBe(rootCause);
    }
  });
});

// ---------------------------------------------------------------------------
// writeCommit – parent handling
// ---------------------------------------------------------------------------
describe('writeCommit – with parent', () => {
  it('uses parent OID for CAS update-ref', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupWriteSuccess(persistence, ref);
    const vault = createVault({ ref, persistence });

    await vault.writeCommit({
      entries: new Map([['demo/hello', 'entry-tree-1']]),
      metadata: { version: 1 },
      parentCommitOid: 'parent-oid',
      message: 'vault: add demo/hello',
    });

    expect(ref.updateRef).toHaveBeenCalledWith({
      ref: VAULT_REF,
      newOid: 'new-commit-oid',
      expectedOldOid: 'parent-oid',
    });

    expect(ref.createCommit).toHaveBeenCalledWith({
      treeOid: 'new-tree-oid',
      parentOid: 'parent-oid',
      message: 'vault: add demo/hello',
    });
  });
});

describe('writeCommit – without parent', () => {
  it('omits parent when null', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    setupWriteSuccess(persistence, ref);
    const vault = createVault({ ref, persistence });

    await vault.writeCommit({
      entries: new Map(),
      metadata: { version: 1 },
      parentCommitOid: null,
      message: 'vault: init',
    });

    expect(ref.updateRef).toHaveBeenCalledWith({
      ref: VAULT_REF,
      newOid: 'new-commit-oid',
      expectedOldOid: null,
    });

    expect(ref.createCommit).toHaveBeenCalledWith({
      treeOid: 'new-tree-oid',
      parentOid: null,
      message: 'vault: init',
    });
  });
});

// ---------------------------------------------------------------------------
// VAULT_REF static
// ---------------------------------------------------------------------------
describe('VAULT_REF', () => {
  it('is refs/cas/vault', () => {
    expect(VaultService.VAULT_REF).toBe('refs/cas/vault');
  });
});

// ---------------------------------------------------------------------------
// Facade delegation smoke test
// ---------------------------------------------------------------------------
describe('ContentAddressableStore vault delegation', () => {
  it('VAULT_REF matches VaultService', async () => {
    const { default: ContentAddressableStore } = await import('../../../index.js');
    expect(ContentAddressableStore.VAULT_REF).toBe(VaultService.VAULT_REF);
  }, LONG_TEST_TIMEOUT_MS);
});
