import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import { utf8Encode } from '../encoding/utf8.js';
import parseApplicationHandle from '../value-objects/ApplicationHandle.js';
import BundleHandle from '../value-objects/BundleHandle.js';
import CacheMetadataCodec from './CacheMetadataCodec.js';
import CacheCandidateHeap from './CacheCandidateHeap.js';

export const CACHE_STATE_PATH = '.cache/state';
export const CACHE_ENTRY_PREFIX = 'entries/';
const ROOT_ENTRY_PREFIX = 'cache-index:';
const DEFAULT_CANDIDATE_LIMIT = 1024;
const METADATA_PAGE_LIMIT = 64 * 1024;

/** Streaming structured-bundle index for one CacheSet generation. */
export default class CacheIndex {
  #bundles;
  #codec;
  #crypto;
  #pages;

  constructor({ bundles, pages, crypto, codec = new CacheMetadataCodec() }) {
    CacheIndex.#assertDependencies(bundles, pages, crypto);
    this.#bundles = bundles;
    this.#pages = pages;
    this.#crypto = crypto;
    this.#codec = codec;
  }

  fromRootEntries(entries) {
    if (entries.length === 0) {
      return null;
    }
    if (entries.length !== 1 || !entries[0].name.startsWith(ROOT_ENTRY_PREFIX)) {
      throw invalid('CacheSet must anchor exactly one structured index', { entries });
    }
    const handle = BundleHandle.parse(entries[0].name.slice(ROOT_ENTRY_PREFIX.length));
    if (entries[0].oid !== handle.oid || entries[0].type !== 'tree') {
      throw invalid('CacheSet root entry does not match its index handle', { entry: entries[0] });
    }
    return handle;
  }

  toRootEntry(handle) {
    const normalized = BundleHandle.from(handle);
    return Object.freeze({
      name: `${ROOT_ENTRY_PREFIX}${normalized}`,
      oid: normalized.oid,
      type: 'tree',
      retention: 'pinned',
    });
  }

  async getState(handle) {
    if (handle === null) {
      return null;
    }
    const member = await this.#bundles.getMemberReference({ handle, path: CACHE_STATE_PATH });
    if (!member || member.handle.kind !== 'page') {
      throw invalid('Cache index is missing its state page', { handle: handle.toString() });
    }
    return this.#codec.decodeState(await this.#pages.get({
      handle: member.handle,
      maxBytes: METADATA_PAGE_LIMIT,
    }));
  }

  async getEntry(handle, digest) {
    if (handle === null) {
      return null;
    }
    const member = await this.#bundles.getMemberReference({ handle, path: entryPath(digest) });
    return member ? await this.#readEntryBundle(member.handle, digest) : null;
  }

  async *entries(handle) {
    if (handle === null) {
      return;
    }
    for await (const member of this.#bundles.iterateMemberReferences({ handle })) {
      if (member.path === CACHE_STATE_PATH) {
        continue;
      }
      const digest = digestFromPath(member.path);
      const entry = await this.#readEntryBundle(member.handle, digest);
      yield Object.freeze({ ...entry, entryHandle: member.handle });
    }
  }

  async stageEntry(metadata) {
    const normalized = this.#codec.normalizeEntry(metadata);
    const staged = await this.#bundles.putOrderedReferences({
      members: [
        ['meta', this.#codec.encodeEntry(normalized)],
        ['target', targetReference(normalized)],
      ],
    });
    return Object.freeze({ metadata: normalized, handle: staged.handle });
  }

  async scan(handle, options = {}) {
    const {
      now,
      protectedDigest = null,
      candidateLimit = DEFAULT_CANDIDATE_LIMIT,
      excludeDigests = new Set(),
      replacement = null,
    } = options;
    const summary = emptySummary();
    const expired = new CacheCandidateHeap(candidateLimit);
    const evictable = new CacheCandidateHeap(candidateLimit);
    for await (const entry of this.entries(handle)) {
      if (shouldScan(entry.metadata, excludeDigests, replacement)) {
        addScannedEntry({ summary, expired, evictable }, entry.metadata, {
          now,
          protectedDigest,
        });
      }
    }
    if (replacement !== null) {
      addScannedEntry({ summary, expired, evictable }, replacement.metadata, {
        now,
        protectedDigest,
      });
    }
    return Object.freeze({
      state: await this.getState(handle),
      summary: freezeSummary(summary),
      expiredCandidates: Object.freeze(expired.sorted()),
      evictionCandidates: Object.freeze(evictable.sorted()),
    });
  }

  async rewrite({ handle, removeDigests, replacement, state }) {
    const statePage = await this.#pages.put({ source: this.#codec.encodeState(state) });
    const staged = await this.#bundles.putOrderedReferences({
      members: this.#rewriteMembers({
        handle,
        removeDigests,
        replacement,
        stateHandle: statePage.handle,
      }),
    });
    return staged.handle;
  }

  async build({ entries, state }) {
    const statePage = await this.#pages.put({ source: this.#codec.encodeState(state) });
    const staged = await this.#bundles.putOrderedReferences({
      members: buildMembers(entries, statePage.handle),
    });
    return staged.handle;
  }

  async *#rewriteMembers({ handle, removeDigests, replacement, stateHandle }) {
    yield [CACHE_STATE_PATH, stateHandle];
    let inserted = replacement === null;
    for await (const current of this.entries(handle)) {
      const digest = current.metadata.keyDigest;
      if (!inserted && digest > replacement.metadata.keyDigest) {
        yield [entryPath(replacement.metadata.keyDigest), replacement.handle];
        inserted = true;
      }
      if (!removeDigests.has(digest) && digest !== replacement?.metadata.keyDigest) {
        yield [entryPath(digest), current.entryHandle];
      }
    }
    if (!inserted) {
      yield [entryPath(replacement.metadata.keyDigest), replacement.handle];
    }
  }

  async #readEntryBundle(value, digest) {
    const handle = BundleHandle.from(value);
    const metadataMember = await this.#bundles.getMemberReference({ handle, path: 'meta' });
    const targetMember = await this.#bundles.getMemberReference({ handle, path: 'target' });
    if (!metadataMember || metadataMember.handle.kind !== 'page' || !targetMember) {
      throw invalid('Cache entry bundle is incomplete', { handle: handle.toString() });
    }
    const metadata = this.#codec.decodeEntry(await this.#pages.get({
      handle: metadataMember.handle,
      maxBytes: METADATA_PAGE_LIMIT,
    }));
    const computedDigest = await this.#crypto.sha256(utf8Encode(metadata.key));
    assertEntryIdentity({
      metadata,
      targetHandle: targetMember.handle,
      digest,
      computedDigest,
    });
    return Object.freeze({ metadata, targetHandle: targetMember.handle });
  }

  static #assertDependencies(bundles, pages, crypto) {
    const bundleMethods = [
      'putOrderedReferences',
      'getMemberReference',
      'iterateMemberReferences',
    ];
    const missing = bundleMethods.filter((method) => typeof bundles?.[method] !== 'function');
    if (typeof pages?.put !== 'function' || typeof pages?.get !== 'function') {
      missing.push('pages.put/get');
    }
    if (typeof crypto?.sha256 !== 'function') {
      missing.push('crypto.sha256');
    }
    if (missing.length > 0) {
      throw invalid('CacheIndex requires bundle and page services', { missing });
    }
  }
}

function entryPath(digest) {
  return `${CACHE_ENTRY_PREFIX}${digest}`;
}

function targetReference(metadata) {
  const handle = parseApplicationHandle(metadata.handle);
  return Object.freeze({
    handle,
    size: handle.kind === 'bundle' ? null : metadata.logicalBytes,
  });
}

function digestFromPath(path) {
  const digest = path.startsWith(CACHE_ENTRY_PREFIX) ? path.slice(CACHE_ENTRY_PREFIX.length) : '';
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw invalid('Cache index contains an invalid entry path', { path });
  }
  return digest;
}

function assertEntryIdentity({ metadata, targetHandle, digest, computedDigest }) {
  if (metadata.keyDigest !== digest ||
      metadata.keyDigest !== computedDigest ||
      metadata.handle !== targetHandle.toString()) {
    throw invalid('Cache entry metadata does not match its bundle edges', {
      digest,
      computedDigest,
      metadata,
      targetHandle: targetHandle.toString(),
    });
  }
}

function emptySummary() {
  return {
    entryCount: 0,
    logicalBytes: 0,
    pinnedEntries: 0,
    evictableEntries: 0,
    expiredEntries: 0,
    oldestAccessedAt: null,
    nextExpiry: null,
  };
}

function addToSummary(summary, entry, now) {
  summary.entryCount += 1;
  summary.logicalBytes = safeAdd(summary.logicalBytes, entry.logicalBytes);
  summary[`${entry.policy}Entries`] += 1;
  summary.expiredEntries += isExpired(entry, now) ? 1 : 0;
  summary.oldestAccessedAt = earlier(summary.oldestAccessedAt, entry.accessedAt);
  summary.nextExpiry = earlier(summary.nextExpiry, entry.expiresAt);
}

function addScannedEntry(heaps, metadata, options) {
  addToSummary(heaps.summary, metadata, options.now);
  const candidate = candidateFrom(metadata);
  if (isExpired(metadata, options.now)) {
    heaps.expired.add({ ...candidate, sortKey: metadata.expiresAt });
  } else if (metadata.policy === 'evictable' && metadata.keyDigest !== options.protectedDigest) {
    heaps.evictable.add({ ...candidate, sortKey: metadata.accessedAt });
  }
}

function shouldScan(metadata, excludeDigests, replacement) {
  return !excludeDigests.has(metadata.keyDigest) &&
    metadata.keyDigest !== replacement?.metadata.keyDigest;
}

function freezeSummary(summary) {
  return Object.freeze({ ...summary });
}

function safeAdd(left, right) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw createCasError(
      'Cache logical size exceeds safe integer accounting',
      ErrorCodes.CACHE_LOGICAL_SIZE_UNKNOWN,
      { left, right },
    );
  }
  return sum;
}

function earlier(current, candidate) {
  if (candidate === null) {
    return current;
  }
  return current === null || candidate < current ? candidate : current;
}

function isExpired(entry, now) {
  return entry.expiresAt !== null && entry.expiresAt <= now;
}

function candidateFrom(metadata) {
  return Object.freeze({
    digest: metadata.keyDigest,
    logicalBytes: metadata.logicalBytes,
    policy: metadata.policy,
    expiresAt: metadata.expiresAt,
    accessedAt: metadata.accessedAt,
  });
}

function invalid(message, meta) {
  return createCasError(message, ErrorCodes.CACHE_STATE_INVALID, meta);
}

async function* buildMembers(entries, stateHandle) {
  yield [CACHE_STATE_PATH, stateHandle];
  for (const entry of entries) {
    yield [entryPath(entry.metadata.keyDigest), entry.handle];
  }
}
