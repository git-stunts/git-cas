import { describe, it, expect, vi, beforeEach } from 'vitest';
import VaultService from '../../../src/domain/services/VaultService.js';
import CasError from '../../../src/domain/errors/CasError.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockPersistence() {
  return {
    writeBlob: vi.fn(),
    writeTree: vi.fn(),
    readBlob: vi.fn(),
    readTree: vi.fn(),
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
      salt: Buffer.from('test-salt'),
      params: { algorithm: 'pbkdf2', iterations: 100000, keyLength: 32 },
    }),
  };
}

function createVault(overrides = {}) {
  return new VaultService({
    persistence: overrides.persistence || mockPersistence(),
    ref: overrides.ref || mockRef(),
    crypto: overrides.crypto || mockCrypto(),
  });
}

function treeEntries(metaOid, extras = []) {
  return [
    { mode: '100644', type: 'blob', oid: metaOid, name: '.vault.json' },
    ...extras,
  ];
}

function setupNoVault(ref) {
  ref.resolveRef.mockRejectedValueOnce(new Error('not found'));
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
    expect(treeArg.some((l) => l.includes('demo/hello'))).toBe(true);
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
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
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
    expect(treeArg.some((l) => l.includes('demo/hello'))).toBe(true);
    expect(treeArg.some((l) => l.includes('photos/beach'))).toBe(true);
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
    expect(treeArg.some((l) => l.includes('demo/hello'))).toBe(false);
    expect(treeArg.some((l) => l.includes('photos/beach'))).toBe(true);
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
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
    ] });
    const vault = createVault({ ref, persistence });
    expect(await vault.resolveVaultEntry({ slug: 'demo/hello' })).toBe('entry-tree-1');
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

    const writtenMetadata = persistence.writeBlob.mock.calls[0][0];
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
    const writtenMetadata = JSON.parse(persistence.writeBlob.mock.calls[0][0]);
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
        kdf: { algorithm: 'pbkdf2', salt: 'abc', iterations: 100000, keyLength: 32 },
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
});

// ---------------------------------------------------------------------------
// CAS retry – exhausted
// ---------------------------------------------------------------------------
describe('CAS retry – exhausted', () => {
  it('throws VAULT_CONFLICT after all retries', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();

    for (let i = 0; i < 3; i++) {
      setupNoVault(ref);
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
  });
});
