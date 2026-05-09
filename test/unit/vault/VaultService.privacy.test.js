import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import VaultService from '../../../src/domain/services/VaultService.js';
import CasError from '../../../src/domain/errors/CasError.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_KEY = Buffer.alloc(32, 0xab);
const PRIVACY_LABEL = 'git-cas-privacy-v1';

function derivePrivacyKey(encryptionKey) {
  return createHmac('sha256', encryptionKey).update(PRIVACY_LABEL).digest();
}

function hmacSlug(privacyKey, slug) {
  return createHmac('sha256', privacyKey).update(slug).digest('hex');
}

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

/**
 * Builds a realistic mock crypto adapter that supports HMAC, encrypt, and decrypt.
 */
function mockCrypto() {
  /** @type {Map<string, { plaintext: Buffer, meta: object }>} */
  const encryptedStore = new Map();
  let nonceCounter = 0;

  return {
      deriveKey: vi.fn().mockImplementation(async () => ({
        key: TEST_KEY,
        salt: Buffer.alloc(32, 0x11),
        params: { algorithm: 'pbkdf2', iterations: 100000, keyLength: 32 },
      })),

    hmacSha256(key, data) {
      return createHmac('sha256', key).update(data).digest();
    },

    encryptBuffer: vi.fn().mockImplementation(async (buffer) => {
      nonceCounter++;
      const nonce = Buffer.alloc(12, nonceCounter).toString('base64');
      const tag = Buffer.alloc(16, nonceCounter).toString('base64');
      const meta = { algorithm: 'aes-256-gcm', nonce, tag, encrypted: true };
      // Store plaintext keyed by nonce for retrieval during decrypt.
      encryptedStore.set(nonce, { plaintext: Buffer.from(buffer), meta });
      // Return "ciphertext" that is just the plaintext (for test simplicity).
      return { buf: Buffer.from(buffer), meta };
    }),

    decryptBuffer: vi.fn().mockImplementation(async (buffer, _key, meta) => {
      const stored = encryptedStore.get(meta.nonce);
      if (stored) {
        return stored.plaintext;
      }
      // Fallback: return buffer as-is (test simplification).
      return Buffer.from(buffer);
    }),
  };
}

function parseWrittenJsonArg(arg) {
  return JSON.parse(Buffer.from(arg).toString());
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

function setupNoVault(ref) {
  ref.resolveRef.mockRejectedValueOnce(Object.assign(
    new Error('refs/cas/vault is not defined'),
    { code: 'GIT_REF_NOT_FOUND' },
  ));
}

function setupPrivacyMismatchRead({ ref, persistence, crypto }) {
  const privacyKey = derivePrivacyKey(TEST_KEY);
  const hmacAlpha = hmacSlug(privacyKey, 'alpha');
  const unmatchedHmac = hmacSlug(privacyKey, 'missing-from-index');
  const indexJson = JSON.stringify({ alpha: hmacAlpha });
  const indexMeta = { algorithm: 'aes-256-gcm', nonce: 'nonce-idx', tag: 'tag-idx', encrypted: true };
  const meta = privacyMeta(indexMeta);

  ref.resolveRef.mockResolvedValueOnce('commit-oid');
  ref.resolveTree.mockResolvedValueOnce('tree-oid');
  persistence.readTree.mockResolvedValueOnce([
    { mode: '100644', type: 'blob', oid: 'meta-blob', name: '.vault.json' },
    { mode: '100644', type: 'blob', oid: 'index-blob', name: '.privacy-index' },
    { mode: '040000', type: 'tree', oid: 'tree-a', name: hmacAlpha },
    { mode: '040000', type: 'tree', oid: 'tree-unmatched', name: unmatchedHmac },
  ]);
  persistence.readBlob.mockResolvedValueOnce(Buffer.from(JSON.stringify(meta)));
  crypto.decryptBuffer.mockResolvedValueOnce(Buffer.from(indexJson));
  persistence.readBlob.mockResolvedValueOnce(Buffer.from(indexJson));
}


const ENCRYPTED_VAULT_META = {
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
};

function privacyMeta(indexMeta) {
  return {
    ...ENCRYPTED_VAULT_META,
    privacy: { enabled: true, indexMeta },
  };
}

// ---------------------------------------------------------------------------
// Privacy mode — initVault
// ---------------------------------------------------------------------------
describe('initVault — privacy mode', () => {
  it('sets privacy.enabled in metadata when privacy=true', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const crypto = mockCrypto();
    setupNoVault(ref);
    // initVault with privacy: writeBlob for metadata (no entries, but privacy index is empty).
    // For an empty vault, writeCommit writes metadata blob only (no entries → no privacy index needed).
    // Actually, with privacy enabled, writeCommit will still build privacy tree lines even if entries is empty.
    persistence.writeBlob.mockResolvedValueOnce('index-blob-oid'); // privacy index
    persistence.writeBlob.mockResolvedValueOnce('meta-blob-oid');  // .vault.json
    persistence.writeTree.mockResolvedValueOnce('new-tree-oid');
    ref.createCommit.mockResolvedValueOnce('new-commit-oid');
    ref.updateRef.mockResolvedValueOnce(undefined);

    const vault = createVault({ ref, persistence, crypto });
    const result = await vault.initVault({ passphrase: 'secret', privacy: true });

    expect(result.commitOid).toBe('new-commit-oid');

    // Check that the written metadata includes privacy.enabled.
    const metaWriteCall = persistence.writeBlob.mock.calls.find((c) => {
      try {
        return Boolean(parseWrittenJsonArg(c[0]).privacy);
      } catch {
        return false;
      }
    });
    expect(metaWriteCall).toBeTruthy();
    const written = parseWrittenJsonArg(metaWriteCall[0]);
    expect(written.privacy.enabled).toBe(true);
    expect(written.privacy.indexMeta).toBeDefined();
  });

  it('throws VAULT_PRIVACY_REQUIRES_ENCRYPTION without passphrase', async () => {
    const vault = createVault();

    await expect(vault.initVault({ privacy: true })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_PRIVACY_REQUIRES_ENCRYPTION',
    );
  });
});

// ---------------------------------------------------------------------------
// Privacy mode — tree entry names are HMAC hashes
// ---------------------------------------------------------------------------
describe('privacy mode — tree entry names are HMAC hashes', () => {
  it('uses 64-char hex HMAC names instead of encoded slugs', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const crypto = mockCrypto();

    // Setup existing encrypted+privacy vault with no entries.
    const meta = privacyMeta({ algorithm: 'aes-256-gcm', nonce: 'n', tag: 't', encrypted: true });

    // readState for the retry: vault has privacy but no entries yet.
    ref.resolveRef.mockResolvedValueOnce('commit-oid-1');
    ref.resolveTree.mockResolvedValueOnce('tree-oid-1');
    const emptyIndex = Buffer.from(JSON.stringify({}));
    // Tree: .vault.json + .privacy-index (no entries).
    persistence.readTree.mockResolvedValueOnce([
      { mode: '100644', type: 'blob', oid: 'meta-blob', name: '.vault.json' },
      { mode: '100644', type: 'blob', oid: 'index-blob', name: '.privacy-index' },
    ]);
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(JSON.stringify(meta))); // .vault.json
    persistence.readBlob.mockResolvedValueOnce(emptyIndex); // .privacy-index

    // writeCommit: privacy tree lines.
    persistence.writeBlob.mockResolvedValueOnce('new-index-blob-oid'); // privacy index
    persistence.writeBlob.mockResolvedValueOnce('new-meta-blob-oid');  // .vault.json
    persistence.writeTree.mockResolvedValueOnce('new-tree-oid');
    ref.createCommit.mockResolvedValueOnce('new-commit-oid');
    ref.updateRef.mockResolvedValueOnce(undefined);

    const vault = createVault({ ref, persistence, crypto });
    await vault.addToVault({
      slug: 'demo/hello',
      treeOid: 'entry-tree-1',
      encryptionKey: TEST_KEY,
    });

    // Inspect the tree lines passed to writeTree.
    const treeArg = persistence.writeTree.mock.calls[0][0];

    // Should NOT contain the encoded slug.
    expect(treeArg.some((l) => l.includes('demo'))).toBe(false);

    // Should contain a 64-char hex HMAC name.
    const privacyKey = derivePrivacyKey(TEST_KEY);
    const expectedHmac = hmacSlug(privacyKey, 'demo/hello');
    expect(treeArg.some((l) => l.includes(expectedHmac))).toBe(true);

    // HMAC name should be 64 chars hex.
    expect(expectedHmac).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Privacy mode — metadata
// ---------------------------------------------------------------------------
describe('privacy mode — metadata', () => {
  it('reads vault metadata without requiring the privacy encryption key', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const crypto = mockCrypto();
    const meta = privacyMeta({ algorithm: 'aes-256-gcm', nonce: 'n', tag: 't', encrypted: true });

    ref.resolveRef.mockResolvedValueOnce('commit-oid');
    ref.resolveTree.mockResolvedValueOnce('tree-oid');
    persistence.readTree.mockResolvedValueOnce([
      { mode: '100644', type: 'blob', oid: 'meta-blob', name: '.vault.json' },
      { mode: '100644', type: 'blob', oid: 'index-blob', name: '.privacy-index' },
    ]);
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(JSON.stringify(meta)));

    const vault = createVault({ ref, persistence, crypto });

    await expect(vault.getVaultMetadata()).resolves.toEqual(meta);
  });
});

// ---------------------------------------------------------------------------
// Privacy mode — listing returns original slugs
// ---------------------------------------------------------------------------
describe('privacy mode — listing returns original slugs', () => {
  it('decrypts privacy index to return original slug names', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const crypto = mockCrypto();

    const privacyKey = derivePrivacyKey(TEST_KEY);
    const hmac1 = hmacSlug(privacyKey, 'alpha');
    const hmac2 = hmacSlug(privacyKey, 'beta/deep');

    const indexJson = JSON.stringify({ alpha: hmac1, 'beta/deep': hmac2 });
    const indexMeta = { algorithm: 'aes-256-gcm', nonce: 'nonce-idx', tag: 'tag-idx', encrypted: true };
    const meta = privacyMeta(indexMeta);

    ref.resolveRef.mockResolvedValueOnce('commit-oid');
    ref.resolveTree.mockResolvedValueOnce('tree-oid');
    persistence.readTree.mockResolvedValueOnce([
      { mode: '100644', type: 'blob', oid: 'meta-blob', name: '.vault.json' },
      { mode: '100644', type: 'blob', oid: 'index-blob', name: '.privacy-index' },
      { mode: '040000', type: 'tree', oid: 'tree-a', name: hmac1 },
      { mode: '040000', type: 'tree', oid: 'tree-b', name: hmac2 },
    ]);
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(JSON.stringify(meta))); // .vault.json
    // decryptBuffer will be called for the index — mock returns the plaintext.
    crypto.decryptBuffer.mockResolvedValueOnce(Buffer.from(indexJson));
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(indexJson)); // .privacy-index blob

    const vault = createVault({ ref, persistence, crypto });
    const list = await vault.listVault({ encryptionKey: TEST_KEY });

    expect(list).toEqual([
      { slug: 'alpha', treeOid: 'tree-a' },
      { slug: 'beta/deep', treeOid: 'tree-b' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Privacy mode — resolve by slug
// ---------------------------------------------------------------------------
describe('privacy mode — resolve by slug', () => {
  it('resolves a slug to its tree OID through the privacy index', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const crypto = mockCrypto();

    const privacyKey = derivePrivacyKey(TEST_KEY);
    const hmac1 = hmacSlug(privacyKey, 'my-asset');
    const indexJson = JSON.stringify({ 'my-asset': hmac1 });
    const indexMeta = { algorithm: 'aes-256-gcm', nonce: 'n1', tag: 't1', encrypted: true };
    const meta = privacyMeta(indexMeta);

    ref.resolveRef.mockResolvedValueOnce('commit-oid');
    ref.resolveTree.mockResolvedValueOnce('tree-oid');
    persistence.readTree.mockResolvedValueOnce([
      { mode: '100644', type: 'blob', oid: 'meta-blob', name: '.vault.json' },
      { mode: '100644', type: 'blob', oid: 'index-blob', name: '.privacy-index' },
      { mode: '040000', type: 'tree', oid: 'the-tree-oid', name: hmac1 },
    ]);
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(JSON.stringify(meta)));
    crypto.decryptBuffer.mockResolvedValueOnce(Buffer.from(indexJson));
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(indexJson));

    const vault = createVault({ ref, persistence, crypto });
    const oid = await vault.resolveVaultEntry({ slug: 'my-asset', encryptionKey: TEST_KEY });
    expect(oid).toBe('the-tree-oid');
  });
});

// ---------------------------------------------------------------------------
// Privacy mode — remove entry
// ---------------------------------------------------------------------------
describe('privacy mode — remove entry', () => {
  it('removes an entry and updates the privacy index', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const crypto = mockCrypto();

    const privacyKey = derivePrivacyKey(TEST_KEY);
    const hmacA = hmacSlug(privacyKey, 'keep-me');
    const hmacB = hmacSlug(privacyKey, 'remove-me');
    const indexJson = JSON.stringify({ 'keep-me': hmacA, 'remove-me': hmacB });
    const indexMeta = { algorithm: 'aes-256-gcm', nonce: 'n1', tag: 't1', encrypted: true };
    const meta = privacyMeta(indexMeta);

    // readState
    ref.resolveRef.mockResolvedValueOnce('commit-oid');
    ref.resolveTree.mockResolvedValueOnce('tree-oid');
    persistence.readTree.mockResolvedValueOnce([
      { mode: '100644', type: 'blob', oid: 'meta-blob', name: '.vault.json' },
      { mode: '100644', type: 'blob', oid: 'index-blob', name: '.privacy-index' },
      { mode: '040000', type: 'tree', oid: 'tree-a', name: hmacA },
      { mode: '040000', type: 'tree', oid: 'tree-b', name: hmacB },
    ]);
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(JSON.stringify(meta)));
    crypto.decryptBuffer.mockResolvedValueOnce(Buffer.from(indexJson));
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(indexJson));

    // writeCommit (after removal, only 'keep-me' remains).
    persistence.writeBlob.mockResolvedValueOnce('new-index-blob'); // privacy index
    persistence.writeBlob.mockResolvedValueOnce('new-meta-blob');  // .vault.json
    persistence.writeTree.mockResolvedValueOnce('new-tree-oid');
    ref.createCommit.mockResolvedValueOnce('new-commit-oid');
    ref.updateRef.mockResolvedValueOnce(undefined);

    const vault = createVault({ ref, persistence, crypto });
    const result = await vault.removeFromVault({ slug: 'remove-me', encryptionKey: TEST_KEY });

    expect(result.commitOid).toBe('new-commit-oid');
    expect(result.removedTreeOid).toBe('tree-b');

    // Verify the written tree only has 'keep-me' (as HMAC).
    const treeArg = persistence.writeTree.mock.calls[0][0];
    expect(treeArg.some((l) => l.includes(hmacA))).toBe(true);
    expect(treeArg.some((l) => l.includes(hmacB))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Privacy mode — requires encryption key
// ---------------------------------------------------------------------------
describe('privacy mode — requires encryption key', () => {
  it('throws VAULT_PRIVACY_KEY_REQUIRED on readState without key', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();

    const meta = privacyMeta({ nonce: 'n', tag: 't', algorithm: 'aes-256-gcm', encrypted: true });
    ref.resolveRef.mockResolvedValueOnce('commit-oid');
    ref.resolveTree.mockResolvedValueOnce('tree-oid');
    persistence.readTree.mockResolvedValueOnce([
      { mode: '100644', type: 'blob', oid: 'meta-blob', name: '.vault.json' },
      { mode: '100644', type: 'blob', oid: 'index-blob', name: '.privacy-index' },
    ]);
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(JSON.stringify(meta)));

    const vault = createVault({ ref, persistence });
    await expect(vault.readState()).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_PRIVACY_KEY_REQUIRED',
    );
  });

  it('throws VAULT_PRIVACY_KEY_REQUIRED on writeCommit without key', async () => {
    const vault = createVault();
    const meta = privacyMeta({ nonce: 'n', tag: 't', algorithm: 'aes-256-gcm', encrypted: true });

    await expect(vault.writeCommit({
      entries: new Map(),
      metadata: meta,
      parentCommitOid: null,
      message: 'test',
    })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_PRIVACY_KEY_REQUIRED',
    );
  });
});

// ---------------------------------------------------------------------------
// Privacy mode — missing .privacy-index
// ---------------------------------------------------------------------------
describe('privacy mode — missing .privacy-index', () => {
  it('throws VAULT_PRIVACY_INDEX_MISSING when index blob is absent', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();

    const meta = privacyMeta({ nonce: 'n', tag: 't', algorithm: 'aes-256-gcm', encrypted: true });
    ref.resolveRef.mockResolvedValueOnce('commit-oid');
    ref.resolveTree.mockResolvedValueOnce('tree-oid');
    // Tree has privacy enabled in metadata but no .privacy-index entry.
    persistence.readTree.mockResolvedValueOnce([
      { mode: '100644', type: 'blob', oid: 'meta-blob', name: '.vault.json' },
      { mode: '040000', type: 'tree', oid: 'tree-a', name: 'some-hmac-name' },
    ]);
    persistence.readBlob.mockResolvedValueOnce(Buffer.from(JSON.stringify(meta)));

    const vault = createVault({ ref, persistence });
    await expect(vault.readState({ encryptionKey: TEST_KEY })).rejects.toSatisfy(
      (e) => e instanceof CasError && e.code === 'VAULT_PRIVACY_INDEX_MISSING',
    );
  });
});

// ---------------------------------------------------------------------------
// Privacy mode — index/tree mismatch
// ---------------------------------------------------------------------------
describe('privacy mode — index/tree mismatch', () => {
  it('fails closed when readState finds tree entries missing from .privacy-index', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const crypto = mockCrypto();
    setupPrivacyMismatchRead({ ref, persistence, crypto });

    const vault = createVault({ ref, persistence, crypto });

    await expect(vault.readState({ encryptionKey: TEST_KEY })).rejects.toMatchObject({
      code: 'VAULT_PRIVACY_INDEX_INVALID',
      meta: {
        unmatchedCount: 1,
        treeEntryCount: 2,
        resolvedCount: 1,
      },
    });
  });

  it('fails closed before listVault returns partial privacy-mode entries', async () => {
    const ref = mockRef();
    const persistence = mockPersistence();
    const crypto = mockCrypto();
    setupPrivacyMismatchRead({ ref, persistence, crypto });

    const vault = createVault({ ref, persistence, crypto });

    await expect(vault.listVault({ encryptionKey: TEST_KEY })).rejects.toMatchObject({
      code: 'VAULT_PRIVACY_INDEX_INVALID',
      meta: {
        unmatchedCount: 1,
        treeEntryCount: 2,
        resolvedCount: 1,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Without privacy — slugs remain visible (backward compat)
// ---------------------------------------------------------------------------
describe('without privacy — slugs remain visible', () => {
  let ref;
  let persistence;
  let vault;

  beforeEach(() => {
    ref = mockRef();
    persistence = mockPersistence();
    vault = createVault({ ref, persistence });
  });

  it('uses percent-encoded slugs as tree entry names', async () => {
    setupNoVault(ref);
    persistence.writeBlob.mockResolvedValueOnce('meta-blob-oid');
    persistence.writeTree.mockResolvedValueOnce('new-tree-oid');
    ref.createCommit.mockResolvedValueOnce('new-commit-oid');
    ref.updateRef.mockResolvedValueOnce(undefined);

    await vault.addToVault({ slug: 'demo/hello', treeOid: 'entry-tree-1' });

    const treeArg = persistence.writeTree.mock.calls[0][0];
    expect(treeArg.some((l) => l.includes('demo%2Fhello'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CryptoPort.hmacSha256 — basic sanity
// ---------------------------------------------------------------------------
describe('CryptoPort.hmacSha256', () => {
  it('returns deterministic 32-byte HMAC', () => {
    const crypto = mockCrypto();
    const result1 = crypto.hmacSha256(TEST_KEY, 'hello');
    const result2 = crypto.hmacSha256(TEST_KEY, 'hello');
    expect(Buffer.isBuffer(result1)).toBe(true);
    expect(result1.length).toBe(32);
    expect(Buffer.from(result1).equals(result2)).toBe(true);
  });

  it('produces different output for different data', () => {
    const crypto = mockCrypto();
    const a = crypto.hmacSha256(TEST_KEY, 'alpha');
    const b = crypto.hmacSha256(TEST_KEY, 'beta');
    expect(Buffer.from(a).equals(b)).toBe(false);
  });
});
