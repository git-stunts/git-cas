import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildKeyOpts,
  listVaultEntries,
  migrateEntry,
  migrateFast,
  migrateFull,
} from '../../../../scripts/migrate-encryption.js';
import {
  isLegacyScheme, mapToCurrentScheme, isLegacyNoAad,
} from '../../../../src/domain/encryption/schemes.js';
import { encodeBase64 } from '../../../../src/domain/encoding/base64.js';
import CasService from '../../../../src/domain/services/CasService.js';
import JsonCodec from '../../../../src/infrastructure/codecs/JsonCodec.js';
import SilentObserver from '../../../../src/infrastructure/adapters/SilentObserver.js';
import FixedChunker from '../../../../src/infrastructure/chunkers/FixedChunker.js';
import NodeCompressionAdapter from '../../../../src/infrastructure/adapters/NodeCompressionAdapter.js';
import { getTestCryptoAdapter } from '../../../helpers/crypto-adapter.js';

const testCrypto = await getTestCryptoAdapter();

function oid(label) {
  return createHash('sha1').update(label).digest('hex');
}

// ---------------------------------------------------------------------------
// Migration classification — documents semantics used by
// scripts/migrate-encryption.js classifyEntry()
// ---------------------------------------------------------------------------

describe('migration classification: isLegacyNoAad semantics', () => {
  it('convergent-v1 returns true from isLegacyNoAad', () => {
    // convergent-v1 returns true because it IS a v1 scheme that had no AAD.
    // However, convergent encryption never used AAD binding at all (keys are
    // derived per-chunk from content), so it should be classified as a FAST
    // migration (rename-only) rather than a FULL migration (re-encrypt).
    //
    // The migration script's classifyEntry() must override this: even though
    // isLegacyNoAad('convergent-v1') === true, convergent-v1 entries need
    // only a scheme rename, not re-encryption.
    expect(isLegacyNoAad('convergent-v1')).toBe(true);
  });

  it('whole-v1 and framed-v1 return true (these DO need re-encryption)', () => {
    expect(isLegacyNoAad('whole-v1')).toBe(true);
    expect(isLegacyNoAad('framed-v1')).toBe(true);
  });

  it('v2 schemes return false (already had AAD)', () => {
    expect(isLegacyNoAad('whole-v2')).toBe(false);
    expect(isLegacyNoAad('framed-v2')).toBe(false);
  });

  it('current schemes return false', () => {
    expect(isLegacyNoAad('whole')).toBe(false);
    expect(isLegacyNoAad('framed')).toBe(false);
    expect(isLegacyNoAad('convergent')).toBe(false);
  });
});

describe('migration classification: mapToCurrentScheme covers all 5 legacy schemes', () => {
  it.each([
    ['whole-v1', 'whole'],
    ['whole-v2', 'whole'],
    ['framed-v1', 'framed'],
    ['framed-v2', 'framed'],
    ['convergent-v1', 'convergent'],
  ])('maps "%s" -> "%s"', (legacy, current) => {
    expect(mapToCurrentScheme(legacy)).toBe(current);
  });

  it('returns null for unrecognized schemes', () => {
    expect(mapToCurrentScheme('chacha20')).toBeNull();
    expect(mapToCurrentScheme('')).toBeNull();
  });
});

describe('migration classification: current schemes are not legacy', () => {
  it.each([
    'whole', 'framed', 'convergent',
  ])('isLegacyScheme("%s") returns false', (scheme) => {
    expect(isLegacyScheme(scheme)).toBe(false);
  });

  it.each([
    'whole-v1', 'whole-v2', 'framed-v1', 'framed-v2', 'convergent-v1',
  ])('isLegacyScheme("%s") returns true', (scheme) => {
    expect(isLegacyScheme(scheme)).toBe(true);
  });
});

describe('migration execution: fast-migrated manifests load in v6', () => {
  it('rewrites a whole-v2 manifest so normal readManifest accepts it', async () => {
    const codec = new JsonCodec();
    const raw = legacyWholeV2Manifest();
    const { persistence, treeOid } = inMemoryManifestPersistence(codec, raw);
    const service = buildService({ persistence, codec });
    const rawService = buildService({ persistence, codec, legacyMode: true });

    await expect(service.readManifest({ treeOid })).rejects.toMatchObject({
      code: 'LEGACY_SCHEME',
    });

    const newTreeOid = await migrateFast({
      service,
      rawService,
      raw: { ...raw, encryption: { ...raw.encryption } },
      treeOid,
      persistence,
      codec,
    });

    const migrated = await service.readManifest({ treeOid: newTreeOid });

    expect(migrated.encryption.scheme).toBe('whole');
    expect(migrated.formatVersion).toBe('6.0.0');
  });
});

describe('migration execution: full migration orchestration', () => {
  it('restores with the legacy service, re-stores with the current service, and updates vault with privacy key', async () => {
    const harness = createFullMigrationHarness();

    const result = await migrateEntry(
      harness.ctx,
      { slug: 'legacy-full', treeOid: oid('tree-old') },
      {
        execute: true,
        encryptionKey: harness.assetKey,
        vaultEncryptionKey: harness.vaultKey,
      },
    );

    expectFullMigrationResult(harness, result);
  });
});

describe('migration execution: recipient legacy manifests', () => {
  it('refuses full migration for recipient-encrypted legacy manifests', async () => {
    const manifest = recipientLegacyManifest();
    const legacyService = {
      readManifest: vi.fn(async () => manifest),
      restoreStream: vi.fn(),
    };

    await expect(migrateFull({
      legacyService,
      service: {},
      treeOid: oid('tree-old'),
      keyOpts: { encryptionKey: new Uint8Array(32).fill(1) },
      deps: {},
      codec: new JsonCodec(),
    })).rejects.toThrow(/recipient-encrypted legacy manifests/u);

    expect(legacyService.restoreStream).not.toHaveBeenCalled();
  });
});

describe('migration vault listing', () => {
  it('passes privacy vault keys through listVault', async () => {
    const encryptionKey = new Uint8Array(32).fill(9);
    const vault = {
      listVault: vi.fn(async () => []),
    };

    await expect(listVaultEntries(vault, { encryptionKey })).resolves.toEqual([]);
    expect(vault.listVault).toHaveBeenCalledWith({ encryptionKey });
  });
});

describe('migration credentials', () => {
  it('builds direct key options and rejects ambiguous full-migration credentials', () => {
    const encryptionKey = new Uint8Array(32).fill(3);
    const classification = { scheme: 'whole-v1', mode: 'full', reason: 'v1' };

    expect(buildKeyOpts({ encryptionKey }, classification)).toEqual({ encryptionKey });
    expect(() => buildKeyOpts({ passphrase: 'secret', encryptionKey }, classification))
      .toThrow(/Provide exactly one full-migration credential source/u);
  });

  it('reads full-migration passphrases from a file source', () => {
    const classification = { scheme: 'whole-v1', mode: 'full', reason: 'v1' };
    const fixture = createPassphraseFile('asset-secret\n');

    try {
      expect(buildKeyOpts({ passphraseFile: fixture.filePath }, classification))
        .toEqual({ passphrase: 'asset-secret' });
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects ambiguous passphrase file and inline passphrase sources', () => {
    const classification = { scheme: 'whole-v1', mode: 'full', reason: 'v1' };
    const fixture = createPassphraseFile('asset-secret\n');

    try {
      expect(() => buildKeyOpts({
        passphrase: 'inline-secret',
        passphraseFile: fixture.filePath,
      }, classification)).toThrow(/Provide exactly one full-migration credential source/u);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('migration help', () => {
  it('documents safer passphrase sources in migration help', () => {
    const help = execFileSync(process.execPath, [
      'scripts/migrate-encryption.js',
      '--help',
    ], { encoding: 'utf8' });

    expect(help).toContain('--passphrase-file <path>');
    expect(help).toContain('prefer --passphrase-file - or --key-file');
    expect(help).toContain('prefer --vault-passphrase-file - or --vault-key-file');
  });
});

function expectFullMigrationResult(harness, result) {
  const { assetKey, vaultKey, legacyService, sourceChunks, restored, vault, manifest } = harness;

    expect(result).toMatchObject({ mode: 'full', newTreeOid: oid('tree-new') });
    expect(legacyService.restoreStream).toHaveBeenCalledWith({
      manifest,
      encryptionKey: assetKey,
    });
    expect(sourceChunks).toEqual([restored]);
    expect(vault.addToVault).toHaveBeenCalledWith({
      slug: 'legacy-full',
      treeOid: oid('tree-new'),
      force: true,
      encryptionKey: vaultKey,
    });
}

function legacyWholeV2Manifest() {
  return {
    slug: 'legacy-fast',
    filename: 'legacy.bin',
    size: 1024,
    chunks: [
      {
        index: 0,
        size: 1024,
        digest: 'a'.repeat(64),
        blob: 'b'.repeat(40),
      },
    ],
    encryption: {
      scheme: 'whole-v2',
      algorithm: 'aes-256-gcm',
      encrypted: true,
      nonce: encodeBase64(new Uint8Array(12).fill(1)),
      tag: encodeBase64(new Uint8Array(16).fill(2)),
    },
  };
}

function buildService({ persistence, codec, legacyMode = false }) {
  return new CasService({
    persistence,
    codec,
    crypto: testCrypto,
    observability: new SilentObserver(),
    chunker: new FixedChunker({ chunkSize: 1024 }),
    compressionAdapter: new NodeCompressionAdapter(),
    chunkSize: 1024,
    formatVersion: '6.0.0',
    legacyMode,
  });
}

function oidForSequence(prefix, sequence) {
  return oid(`${prefix}-${sequence}`);
}

function inMemoryManifestPersistence(codec, raw) {
  const treeOid = oid('initial-tree');
  const manifestOid = oid('manifest-old');
  const blobs = new Map([[manifestOid, codec.encode(raw)]]);
  const trees = new Map([
    [
      treeOid,
      [{ mode: '100644', type: 'blob', oid: manifestOid, name: 'manifest.json' }],
    ],
  ]);

  let blobSeq = 0;
  let treeSeq = 0;
  const persistence = {
    writeBlob: vi.fn(async (content) => {
      const objectOid = oidForSequence('manifest-new', ++blobSeq);
      blobs.set(objectOid, content);
      return objectOid;
    }),
    writeTree: vi.fn(async (entries) => {
      const objectOid = oidForSequence('tree-new', ++treeSeq);
      trees.set(objectOid, entries.map(parseTreeEntry));
      return objectOid;
    }),
    readBlob: vi.fn(async (objectOid) => blobs.get(objectOid)),
    readBlobStream: vi.fn(async function* (objectOid) {
      yield blobs.get(objectOid);
    }),
    readTree: vi.fn(async (objectOid) => trees.get(objectOid)),
  };

  return { persistence, treeOid };
}

function createFullMigrationHarness() {
  const assetKey = new Uint8Array(32).fill(7);
  const vaultKey = new Uint8Array(32).fill(8);
  const restored = new Uint8Array([1, 2, 3, 4]);
  const manifest = legacyWholeManifest();
  const sourceChunks = [];
  const service = fullMigrationWriterService({ assetKey, sourceChunks });
  const legacyService = {
    readManifest: vi.fn(async () => manifest),
    restoreStream: vi.fn(() => asyncChunks([restored])),
  };
  const vault = {
    addToVault: vi.fn(async () => ({ commitOid: 'vault-commit' })),
  };

  return {
    assetKey,
    vaultKey,
    restored,
    manifest,
    sourceChunks,
    legacyService,
    vault,
    ctx: fullMigrationContext({ legacyService, service, vault }),
  };
}

function fullMigrationWriterService({ assetKey, sourceChunks }) {
  const newManifest = { slug: 'legacy-full', filename: 'legacy.bin' };
  return {
    store: vi.fn(async (opts) => {
      for await (const chunk of opts.source) {
        sourceChunks.push(chunk);
      }
      expect(opts.encryptionKey).toBe(assetKey);
      expect(opts.encryption).toEqual({ scheme: 'whole' });
      return newManifest;
    }),
    createTree: vi.fn(async ({ manifest: created }) => {
      expect(created).toBe(newManifest);
      return oid('tree-new');
    }),
  };
}

function fullMigrationContext({ legacyService, service, vault }) {
  return {
    persistence: manifestTreePersistence(),
    rawServices: {
      json: { readManifestRaw: vi.fn(async () => ({ encryption: { scheme: 'whole-v1' } })) },
    },
    legacyServices: { json: legacyService },
    services: { json: service },
    codecs: { json: new JsonCodec() },
    deps: {},
    vault,
  };
}

function legacyWholeManifest() {
  return {
    slug: 'legacy-full',
    filename: 'legacy.bin',
    encryption: { scheme: 'whole' },
    chunks: [],
  };
}

function recipientLegacyManifest() {
  return {
    slug: 'recipient-full',
    filename: 'recipient.bin',
    encryption: {
      scheme: 'whole',
      recipients: [{ label: 'alice', wrappedDek: 'x', nonce: 'n', tag: 't' }],
    },
    chunks: [],
  };
}

function manifestTreePersistence() {
  return {
    readTree: vi.fn(async () => [
      { mode: '100644', type: 'blob', oid: oid('manifest-oid'), name: 'manifest.json' },
    ]),
  };
}

async function* asyncChunks(chunks) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function parseTreeEntry(entry) {
  const tab = entry.indexOf('\t');
  const [mode, type, objectOid] = entry.slice(0, tab).split(' ');
  return { mode, type, oid: objectOid, name: entry.slice(tab + 1) };
}

function createPassphraseFile(content) {
  const dir = mkdtempSync(join(tmpdir(), 'git-cas-migrate-passphrase-'));
  const filePath = join(dir, 'passphrase.txt');
  writeFileSync(filePath, content);
  return {
    filePath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
