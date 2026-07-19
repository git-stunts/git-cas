import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function casServiceTypes() {
  return readFileSync(path.join(repoRoot, 'src/domain/services/CasService.d.ts'), 'utf8');
}

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function interfaceBody(source, name) {
  const match = source.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    throw new Error(`Missing interface ${name}`);
  }
  return match[1];
}

describe('Type declaration accuracy', () => {
  it('keeps direct CasService constructor-only runtime requirements non-optional', () => {
    const options = interfaceBody(casServiceTypes(), 'CasServiceOptions');

    expect(options).toMatch(/\n\s+chunker: ChunkingPort;/);
    expect(options).toMatch(/\n\s+compressionAdapter: CompressionPort;/);
    expect(options).not.toMatch(/\n\s+chunker\?: ChunkingPort;/);
    expect(options).not.toMatch(/\n\s+compressionAdapter\?: CompressionPort;/);
  });

  it('exposes all supported store-time encryption knobs', () => {
    const options = interfaceBody(casServiceTypes(), 'StoreEncryptionOptions');

    expect(options).toMatch(/\n\s+scheme\?: EncryptionScheme;/);
    expect(options).toMatch(/\n\s+frameBytes\?: number;/);
    expect(options).toMatch(/\n\s+convergent\?: boolean;/);
  });

  it('keeps runtime JSDoc store encryption shapes aligned with declarations', () => {
    const encryptionShape =
      /@param \{\{ scheme\?: 'whole'\|'framed'\|'convergent', frameBytes\?: number, convergent\?: boolean \}\} \[options\.encryption\]/;

    for (const relPath of [
      'src/domain/services/CasService.js',
      'src/infrastructure/adapters/FileIOHelper.js',
    ]) {
      expect(read(relPath), relPath).toMatch(encryptionShape);
    }
  });

  it('keeps ManifestDiff parameter typedefs resolvable', () => {
    const source = read('src/domain/services/ManifestDiff.js');

    expect(source).toMatch(
      /@typedef\s+\{import\(['"]\.\.\/value-objects\/Manifest\.js['"]\)\.default\}\s+Manifest/
    );
    expect(source).toMatch(/@param\s+\{Manifest\}\s+oldManifest/);
    expect(source).toMatch(/@param\s+\{Manifest\}\s+newManifest/);
  });
});

describe('Root-set declaration accuracy', () => {
  it('declares the public root-set namespace and doctor policy facts', () => {
    const declarations = read('index.d.ts');

    expect(declarations).toContain('readonly rootSets: {');
    expect(declarations).toContain('export declare class RootSet');
    expect(declarations).toContain('policyCounts?: { pinned: number; evictable: number };');
    expect(declarations).toContain("reachability: 'anchored' | 'missing' | 'unknown';");
    expect(declarations).toContain('expectedHeadOid?: string | null;');
    expect(declarations).toContain('readObjectType(oid: string): Promise<string>;');
    expect(declarations).toContain('resolveParents(commitOid: string): Promise<string[]>;');
  });
});

describe('Application-storage declaration accuracy', () => {
  it('declares opaque handles, witnesses, and frozen facade capabilities', () => {
    const declarations = read('index.d.ts');

    expect(declarations).toContain('export declare class AssetHandle');
    expect(declarations).toContain('export declare class BundleHandle');
    expect(declarations).toContain('export declare class PageHandle');
    expect(declarations).toContain('export declare class StagedAsset');
    expect(declarations).toContain('export declare class StagedBundle');
    expect(declarations).toContain('export declare class StagedPage');
    expect(declarations).toContain('export declare class RetentionWitness');
    expect(declarations).toContain('readonly assets: AssetCapability;');
    expect(declarations).toContain('readonly bundles: BundleCapability;');
    expect(declarations).toContain('readonly pages: PageCapability;');
    expect(declarations).toContain('putBatch(options: {');
    expect(declarations).toContain('readonly retention: RetentionCapability;');
    expect(declarations).toContain('readonly publications: PublicationCapability;');
    expect(declarations).toContain('export declare class CacheSet');
    expect(declarations).toContain('export declare class CacheHit');
    expect(declarations).toContain('export interface CacheAcquisition {');
    expect(declarations).toContain('acquire(key: string): Promise<CacheAcquisition | null>;');
    expect(declarations).toContain('inspectAcquisitions(options?: {');
    expect(declarations).toContain('releaseAcquisition(options: {');
    expect(declarations).toContain('readonly caches: CacheCapability;');
    expect(declarations).toContain('export declare class ExpiringSet');
    expect(declarations).toContain('export declare class ExpiringMarker');
    expect(declarations).toContain('readonly expiringSets: ExpiringSetCapability;');
    expect(declarations).toContain('readonly diagnostics: DiagnosticsCapability;');
    expect(declarations).toContain('export declare class RepositoryDoctor');
    expect(declarations).toContain('export declare class RepositoryInspectionPort');
    expect(declarations).toContain('export declare class GitRepositoryInspectionAdapter');
    expect(declarations).toContain('readonly detailed?: number;');
    expect(declarations).toContain("prunableInspection: 'dry-run';");
    expect(declarations).toContain('mutatesRepository: false;');
    expect(declarations).toContain(
      'addIfAbsent(key: string, options: { expiresAt: Date | string })'
    );
    expect(declarations).toContain('iterateMembers(options: { handle: BundleHandleInput })');
    expect(declarations).toContain('applicationRefPrefixes?: string[];');
    expect(declarations).toContain('pageCacheEntries?: number;');
    expect(declarations).toContain('pageCacheBytes?: number;');
    expect(declarations).toContain('parentOids?: string[];');
    expect(declarations).toContain('anchorRef?(options: {');
    expect(declarations).toContain('deleteRef?(options: {');
    expect(declarations).toContain('iterateRefs?(options: {');
    expect(declarations).toContain('readonly symref?: string | null;');
    expect(read('index.js')).not.toMatch(/export \{ default as CacheAcquisition \}/u);
  });
});

describe('Persistence lifecycle declaration accuracy', () => {
  it('declares bounded tree reuse and deterministic resource release', () => {
    const declarations = read('index.d.ts');

    expect(declarations).toContain('treeCacheEntries?: number;');
    expect(declarations).toContain('treeCacheBytes?: number;');
    expect(declarations).toContain('sessionIdleTimeoutMs?: number;');
    expect(declarations).toContain('close(): Promise<void>;');
    expect(declarations).toContain('[Symbol.asyncDispose](): Promise<void>;');
  });
});

describe('Bundle reference declaration accuracy', () => {
  it('declares direct bundle references and bounded Git metadata caching', () => {
    const declarations = read('index.d.ts');

    expect(declarations).toContain('export interface BundleMemberReference {');
    expect(declarations).toContain('Promise<BundleMemberReference | null>;');
    expect(declarations).toContain(
      'iterateMemberReferences(options: { handle: BundleHandleInput })'
    );
    expect(declarations).toContain('metadataCacheEntries?: number;');
  });
});
