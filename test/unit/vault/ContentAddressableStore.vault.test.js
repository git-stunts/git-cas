import { describe, it, expect, vi, beforeEach } from 'vitest';
import ContentAddressableStore from '../../../index.js';
import CasError from '../../../src/domain/errors/CasError.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockPlumbing() {
  return { execute: vi.fn(), executeStream: vi.fn() };
}

function createCas(plumbing) {
  return new ContentAddressableStore({ plumbing });
}

function lsTreeOutput(entries) {
  return entries.map((e) => `${e.mode} ${e.type} ${e.oid}\t${e.name}`).join('\0');
}

const VAULT_REF = ContentAddressableStore.VAULT_REF;

function vaultTreeWithMeta(metaOid, extra = []) {
  return lsTreeOutput([
    { mode: '100644', type: 'blob', oid: metaOid, name: '.vault.json' },
    ...extra,
  ]);
}

function setupExistingVault(plumbing, metaJson, entries = []) {
  plumbing.execute.mockResolvedValueOnce('commit-oid-1');
  plumbing.execute.mockResolvedValueOnce('tree-oid-1');
  plumbing.execute.mockResolvedValueOnce(vaultTreeWithMeta('meta-blob-oid', entries));
  plumbing.execute.mockResolvedValueOnce(metaJson);
}

function setupWriteSuccess(plumbing) {
  plumbing.execute.mockResolvedValueOnce('meta-blob-oid');
  plumbing.execute.mockResolvedValueOnce('new-tree-oid');
  plumbing.execute.mockResolvedValueOnce('new-commit-oid');
  plumbing.execute.mockResolvedValueOnce('');
}

function setupNoVault(plumbing) {
  plumbing.execute.mockRejectedValueOnce(new Error('not found'));
}

// ---------------------------------------------------------------------------
// _validateSlug – valid
// ---------------------------------------------------------------------------
describe('_validateSlug – valid slugs', () => {
  let cas;
  beforeEach(() => { cas = createCas(mockPlumbing()); });

  it('accepts simple slug', () => {
    expect(() => cas._validateSlug('a')).not.toThrow();
  });

  it('accepts slug with slash', () => {
    expect(() => cas._validateSlug('demo/hello')).not.toThrow();
  });

  it('accepts slug with dashes and numbers', () => {
    expect(() => cas._validateSlug('photos/beach-2024')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// _validateSlug – invalid
// ---------------------------------------------------------------------------
describe('_validateSlug – invalid slugs', () => {
  let cas;
  beforeEach(() => { cas = createCas(mockPlumbing()); });

  function expectInvalidSlug(slug) {
    try {
      cas._validateSlug(slug);
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
// _readVaultState – no vault
// ---------------------------------------------------------------------------
describe('_readVaultState – no vault', () => {
  it('returns empty state when rev-parse fails', async () => {
    const plumbing = mockPlumbing();
    setupNoVault(plumbing);
    const cas = createCas(plumbing);

    const state = await cas._readVaultState();
    expect(state.entries.size).toBe(0);
    expect(state.parentCommitOid).toBeNull();
    expect(state.metadata).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// _readVaultState – existing vault
// ---------------------------------------------------------------------------
describe('_readVaultState – existing vault', () => {
  it('parses vault with entries and metadata', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }), [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
      { mode: '040000', type: 'tree', oid: 'entry-tree-2', name: 'photos/beach' },
    ]);

    const cas = createCas(plumbing);
    const state = await cas._readVaultState();

    expect(state.parentCommitOid).toBe('commit-oid-1');
    expect(state.entries.size).toBe(2);
    expect(state.entries.get('demo/hello')).toBe('entry-tree-1');
    expect(state.metadata).toEqual({ version: 1 });
  });
});

// ---------------------------------------------------------------------------
// _readVaultState – metadata errors
// ---------------------------------------------------------------------------
describe('_readVaultState – metadata errors', () => {
  it('throws VAULT_METADATA_INVALID for unknown version', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 99 }));
    const cas = createCas(plumbing);

    await expect(cas._readVaultState()).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_METADATA_INVALID',
    );
  });

  it('throws VAULT_METADATA_INVALID for non-JSON blob', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, 'not-json');
    const cas = createCas(plumbing);

    await expect(cas._readVaultState()).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_METADATA_INVALID',
    );
  });

  it('throws when encryption fields are incomplete', async () => {
    const plumbing = mockPlumbing();
    const bad = JSON.stringify({
      version: 1,
      encryption: { cipher: 'aes-256-gcm', kdf: { algorithm: 'pbkdf2' } },
    });
    setupExistingVault(plumbing, bad);
    const cas = createCas(plumbing);

    await expect(cas._readVaultState()).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_METADATA_INVALID',
    );
  });
});

// ---------------------------------------------------------------------------
// addToVault – first entry
// ---------------------------------------------------------------------------
describe('addToVault – first entry (auto-init)', () => {
  it('adds first entry and auto-inits vault', async () => {
    const plumbing = mockPlumbing();
    setupNoVault(plumbing);
    setupWriteSuccess(plumbing);
    const cas = createCas(plumbing);

    const result = await cas.addToVault({ slug: 'demo/hello', treeOid: 'entry-tree-1' });
    expect(result.commitOid).toBe('new-commit-oid');

    const mktreeCall = plumbing.execute.mock.calls.find((c) => c[0].args[0] === 'mktree');
    expect(mktreeCall[0].input).toContain('.vault.json');
    expect(mktreeCall[0].input).toContain('demo/hello');
  });
});

// ---------------------------------------------------------------------------
// addToVault – duplicate handling
// ---------------------------------------------------------------------------
describe('addToVault – duplicate handling', () => {
  it('throws VAULT_ENTRY_EXISTS without force', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }), [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
    ]);
    const cas = createCas(plumbing);

    await expect(cas.addToVault({ slug: 'demo/hello', treeOid: 'x' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENTRY_EXISTS',
    );
  });

  it('overwrites existing entry with force', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }), [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
    ]);
    setupWriteSuccess(plumbing);
    const cas = createCas(plumbing);

    const result = await cas.addToVault({ slug: 'demo/hello', treeOid: 'entry-tree-2', force: true });
    expect(result.commitOid).toBe('new-commit-oid');
  });
});

// ---------------------------------------------------------------------------
// addToVault – second entry
// ---------------------------------------------------------------------------
describe('addToVault – second entry', () => {
  it('preserves first entry when adding second', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }), [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
    ]);
    setupWriteSuccess(plumbing);
    const cas = createCas(plumbing);

    const result = await cas.addToVault({ slug: 'photos/beach', treeOid: 'entry-tree-2' });
    expect(result.commitOid).toBe('new-commit-oid');

    const mktreeCall = plumbing.execute.mock.calls.find((c) => c[0].args[0] === 'mktree');
    expect(mktreeCall[0].input).toContain('demo/hello');
    expect(mktreeCall[0].input).toContain('photos/beach');
  });
});

// ---------------------------------------------------------------------------
// listVault
// ---------------------------------------------------------------------------
describe('listVault – empty', () => {
  it('returns empty array when no vault', async () => {
    const plumbing = mockPlumbing();
    setupNoVault(plumbing);
    const cas = createCas(plumbing);
    expect(await cas.listVault()).toEqual([]);
  });
});

describe('listVault – populated', () => {
  it('returns sorted entries', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }), [
      { mode: '040000', type: 'tree', oid: 'tree-b', name: 'photos/beach' },
      { mode: '040000', type: 'tree', oid: 'tree-a', name: 'demo/hello' },
    ]);
    const cas = createCas(plumbing);

    expect(await cas.listVault()).toEqual([
      { slug: 'demo/hello', treeOid: 'tree-a' },
      { slug: 'photos/beach', treeOid: 'tree-b' },
    ]);
  });

  it('preserves slugs with slashes', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }), [
      { mode: '040000', type: 'tree', oid: 'tree-a', name: 'a/b/c' },
    ]);
    const cas = createCas(plumbing);
    const entries = await cas.listVault();
    expect(entries[0].slug).toBe('a/b/c');
  });
});

// ---------------------------------------------------------------------------
// removeFromVault
// ---------------------------------------------------------------------------
describe('removeFromVault – existing entry', () => {
  it('removes entry and returns removed tree OID', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }), [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
      { mode: '040000', type: 'tree', oid: 'entry-tree-2', name: 'photos/beach' },
    ]);
    setupWriteSuccess(plumbing);
    const cas = createCas(plumbing);

    const result = await cas.removeFromVault({ slug: 'demo/hello' });
    expect(result.commitOid).toBe('new-commit-oid');
    expect(result.removedTreeOid).toBe('entry-tree-1');

    const mktreeCall = plumbing.execute.mock.calls.find((c) => c[0].args[0] === 'mktree');
    expect(mktreeCall[0].input).not.toContain('demo/hello');
    expect(mktreeCall[0].input).toContain('photos/beach');
  });
});

describe('removeFromVault – missing entry', () => {
  it('throws VAULT_ENTRY_NOT_FOUND', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }));
    const cas = createCas(plumbing);

    await expect(cas.removeFromVault({ slug: 'missing' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENTRY_NOT_FOUND',
    );
  });
});

describe('removeFromVault – last entry', () => {
  it('handles removing last entry (empty tree)', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }), [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'only-entry' },
    ]);
    setupWriteSuccess(plumbing);
    const cas = createCas(plumbing);

    const result = await cas.removeFromVault({ slug: 'only-entry' });
    expect(result.removedTreeOid).toBe('entry-tree-1');

    const mktreeCall = plumbing.execute.mock.calls.find((c) => c[0].args[0] === 'mktree');
    expect(mktreeCall[0].input).toContain('.vault.json');
    expect(mktreeCall[0].input).not.toContain('only-entry');
  });
});

// ---------------------------------------------------------------------------
// resolveVaultEntry
// ---------------------------------------------------------------------------
describe('resolveVaultEntry – found', () => {
  it('returns tree OID', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }), [
      { mode: '040000', type: 'tree', oid: 'entry-tree-1', name: 'demo/hello' },
    ]);
    const cas = createCas(plumbing);
    expect(await cas.resolveVaultEntry({ slug: 'demo/hello' })).toBe('entry-tree-1');
  });
});

describe('resolveVaultEntry – not found', () => {
  it('throws VAULT_ENTRY_NOT_FOUND', async () => {
    const plumbing = mockPlumbing();
    setupNoVault(plumbing);
    const cas = createCas(plumbing);

    await expect(cas.resolveVaultEntry({ slug: 'missing' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENTRY_NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// initVault – without encryption
// ---------------------------------------------------------------------------
describe('initVault – without encryption', () => {
  it('creates vault with { version: 1 }', async () => {
    const plumbing = mockPlumbing();
    setupNoVault(plumbing);
    setupWriteSuccess(plumbing);
    const cas = createCas(plumbing);

    const result = await cas.initVault();
    expect(result.commitOid).toBe('new-commit-oid');

    const hashObjCall = plumbing.execute.mock.calls.find(
      (c) => c[0].args?.[0] === 'hash-object',
    );
    expect(hashObjCall[0].input).toContain('"version": 1');
  });
});

// ---------------------------------------------------------------------------
// initVault – with passphrase
// ---------------------------------------------------------------------------
describe('initVault – with passphrase', () => {
  it('stores KDF params in metadata', async () => {
    const plumbing = mockPlumbing();
    setupNoVault(plumbing);
    setupWriteSuccess(plumbing);
    const cas = createCas(plumbing);

    await cas.initVault({
      passphrase: 'my-secret',
      kdfOptions: { algorithm: 'pbkdf2' },
    });

    const hashObjCall = plumbing.execute.mock.calls.find(
      (c) => c[0].args?.[0] === 'hash-object',
    );
    const written = JSON.parse(hashObjCall[0].input);
    expect(written.version).toBe(1);
    expect(written.encryption.cipher).toBe('aes-256-gcm');
    expect(written.encryption.kdf.algorithm).toBe('pbkdf2');
    expect(written.encryption.kdf.salt).toBeTruthy();
    expect(written.encryption.kdf.keyLength).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// initVault – already encrypted
// ---------------------------------------------------------------------------
describe('initVault – already encrypted', () => {
  it('throws VAULT_ENCRYPTION_ALREADY_CONFIGURED', async () => {
    const plumbing = mockPlumbing();
    const meta = JSON.stringify({
      version: 1,
      encryption: {
        cipher: 'aes-256-gcm',
        kdf: { algorithm: 'pbkdf2', salt: 'abc', iterations: 100000, keyLength: 32 },
      },
    });
    setupExistingVault(plumbing, meta);
    const cas = createCas(plumbing);

    await expect(cas.initVault({ passphrase: 'new' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_ENCRYPTION_ALREADY_CONFIGURED',
    );
  });
});

// ---------------------------------------------------------------------------
// getVaultMetadata
// ---------------------------------------------------------------------------
describe('getVaultMetadata', () => {
  it('returns null when no vault', async () => {
    const plumbing = mockPlumbing();
    setupNoVault(plumbing);
    const cas = createCas(plumbing);
    expect(await cas.getVaultMetadata()).toBeNull();
  });

  it('returns metadata when vault exists', async () => {
    const plumbing = mockPlumbing();
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }));
    const cas = createCas(plumbing);
    expect(await cas.getVaultMetadata()).toEqual({ version: 1 });
  });
});

// ---------------------------------------------------------------------------
// CAS retry – succeeds on second attempt
// ---------------------------------------------------------------------------
describe('CAS retry – succeeds on retry', () => {
  it('retries on VAULT_CONFLICT and succeeds', async () => {
    const plumbing = mockPlumbing();

    // First attempt: no vault → write fails
    setupNoVault(plumbing);
    plumbing.execute.mockResolvedValueOnce('meta-blob-oid');
    plumbing.execute.mockResolvedValueOnce('new-tree-oid');
    plumbing.execute.mockResolvedValueOnce('commit-1');
    plumbing.execute.mockRejectedValueOnce(new Error('lock failed'));

    // Second attempt: vault now exists → write succeeds
    setupExistingVault(plumbing, JSON.stringify({ version: 1 }));
    setupWriteSuccess(plumbing);

    const cas = createCas(plumbing);
    const result = await cas.addToVault({ slug: 'demo/hello', treeOid: 'entry-tree-1' });
    expect(result.commitOid).toBe('new-commit-oid');
  });
});

// ---------------------------------------------------------------------------
// CAS retry – exhausted
// ---------------------------------------------------------------------------
describe('CAS retry – exhausted', () => {
  it('throws VAULT_CONFLICT after all retries', async () => {
    const plumbing = mockPlumbing();

    for (let i = 0; i < 3; i++) {
      setupNoVault(plumbing);
      plumbing.execute.mockResolvedValueOnce('meta-blob-oid');
      plumbing.execute.mockResolvedValueOnce('new-tree-oid');
      plumbing.execute.mockResolvedValueOnce(`commit-${i}`);
      plumbing.execute.mockRejectedValueOnce(new Error('lock failed'));
    }

    const cas = createCas(plumbing);

    await expect(cas.addToVault({ slug: 'demo/hello', treeOid: 'x' })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_CONFLICT',
    );
  });
});

// ---------------------------------------------------------------------------
// _writeVaultCommit – parent handling
// ---------------------------------------------------------------------------
describe('_writeVaultCommit – with parent', () => {
  it('uses parent OID for CAS update-ref', async () => {
    const plumbing = mockPlumbing();
    setupWriteSuccess(plumbing);
    const cas = createCas(plumbing);

    await cas._writeVaultCommit({
      entries: new Map([['demo/hello', 'entry-tree-1']]),
      metadata: { version: 1 },
      parentCommitOid: 'parent-oid',
      message: 'vault: add demo/hello',
    });

    const updateRef = plumbing.execute.mock.calls.find((c) => c[0].args?.[0] === 'update-ref');
    expect(updateRef[0].args).toEqual(['update-ref', VAULT_REF, 'new-commit-oid', 'parent-oid']);

    const commitTree = plumbing.execute.mock.calls.find((c) => c[0].args?.[0] === 'commit-tree');
    expect(commitTree[0].args).toContain('-p');
    expect(commitTree[0].args).toContain('parent-oid');
  });
});

describe('_writeVaultCommit – without parent', () => {
  it('omits parent when null', async () => {
    const plumbing = mockPlumbing();
    setupWriteSuccess(plumbing);
    const cas = createCas(plumbing);

    await cas._writeVaultCommit({
      entries: new Map(),
      metadata: { version: 1 },
      parentCommitOid: null,
      message: 'vault: init',
    });

    const updateRef = plumbing.execute.mock.calls.find((c) => c[0].args?.[0] === 'update-ref');
    expect(updateRef[0].args).toEqual(['update-ref', VAULT_REF, 'new-commit-oid']);

    const commitTree = plumbing.execute.mock.calls.find((c) => c[0].args?.[0] === 'commit-tree');
    expect(commitTree[0].args).not.toContain('-p');
  });
});

// ---------------------------------------------------------------------------
// VAULT_REF static
// ---------------------------------------------------------------------------
describe('VAULT_REF', () => {
  it('is refs/cas/vault', () => {
    expect(ContentAddressableStore.VAULT_REF).toBe('refs/cas/vault');
  });
});
