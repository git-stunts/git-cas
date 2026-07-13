import createCasError from '../errors/createCasError.js';
import { ErrorCodes } from '../errors/index.js';
import BundleHandle from '../value-objects/BundleHandle.js';
import PageHandle from '../value-objects/PageHandle.js';
import ExpiringSetMetadataCodec from './ExpiringSetMetadataCodec.js';

export const EXPIRING_SET_STATE_PATH = '.expiring/state';
export const EXPIRING_SET_MARKER_PREFIX = 'markers/';
const ROOT_ENTRY_PREFIX = 'expiring-index:';
const METADATA_PAGE_LIMIT = 64 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;

/** Streaming structured-bundle index for one ExpiringSet generation. */
export default class ExpiringSetIndex {
  #bundles;
  #codec;
  #pages;

  constructor({ bundles, pages, codec = new ExpiringSetMetadataCodec() }) {
    ExpiringSetIndex.#assertDependencies(bundles, pages);
    this.#bundles = bundles;
    this.#pages = pages;
    this.#codec = codec;
  }

  fromRootEntries(entries) {
    if (entries.length === 0) {
      return null;
    }
    if (entries.length !== 1 || !entries[0].name.startsWith(ROOT_ENTRY_PREFIX)) {
      throw invalid('ExpiringSet must anchor exactly one structured index', { entries });
    }
    const handle = BundleHandle.parse(entries[0].name.slice(ROOT_ENTRY_PREFIX.length));
    if (entries[0].oid !== handle.oid || entries[0].type !== 'tree') {
      throw invalid('ExpiringSet root entry does not match its index handle', {
        entry: entries[0],
      });
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
    const member = await this.#bundles.getMemberReference({
      handle,
      path: EXPIRING_SET_STATE_PATH,
    });
    if (!member || member.handle.kind !== 'page') {
      throw invalid('ExpiringSet index is missing its state page', {
        handle: handle.toString(),
      });
    }
    return this.#codec.decodeState(await this.#pages.get({
      handle: member.handle,
      maxBytes: METADATA_PAGE_LIMIT,
    }));
  }

  async getMarker(handle, digest) {
    assertDigest(digest);
    if (handle === null) {
      return null;
    }
    const member = await this.#bundles.getMemberReference({
      handle,
      path: markerPath(digest),
    });
    return member ? await this.#readMarker(member, digest) : null;
  }

  async *markers(handle) {
    if (handle === null) {
      return;
    }
    for await (const member of this.#bundles.iterateMemberReferences({ handle })) {
      if (member.path === EXPIRING_SET_STATE_PATH) {
        continue;
      }
      const digest = digestFromPath(member.path);
      yield await this.#readMarker(member, digest);
    }
  }

  async stageMarker(metadata) {
    const normalized = this.#codec.normalizeMarker(metadata);
    const staged = await this.#pages.put({ source: this.#codec.encodeMarker(normalized) });
    return Object.freeze({ metadata: normalized, handle: staged.handle });
  }

  async scan(handle, { now, excludeDigest = null, replacement = null } = {}) {
    const summary = emptySummary();
    for await (const marker of this.markers(handle)) {
      if (marker.metadata.keyDigest !== excludeDigest &&
          marker.metadata.keyDigest !== replacement?.metadata.keyDigest) {
        addToSummary(summary, marker.metadata, now);
      }
    }
    if (replacement !== null) {
      addToSummary(summary, replacement.metadata, now);
    }
    return Object.freeze({
      state: await this.getState(handle),
      summary: Object.freeze(summary),
    });
  }

  async rewrite({ handle, removeDigest = null, removeExpiredAt = null, replacement, state }) {
    const statePage = await this.#pages.put({ source: this.#codec.encodeState(state) });
    const staged = await this.#bundles.putOrderedReferences({
      members: this.#rewriteMembers({
        handle,
        removeDigest,
        removeExpiredAt,
        replacement,
        stateHandle: statePage.handle,
      }),
    });
    return staged.handle;
  }

  async *#rewriteMembers({
    handle,
    removeDigest,
    removeExpiredAt,
    replacement,
    stateHandle,
  }) {
    yield [EXPIRING_SET_STATE_PATH, stateHandle];
    let inserted = replacement === null;
    for await (const current of this.markers(handle)) {
      const digest = current.metadata.keyDigest;
      if (!inserted && digest > replacement.metadata.keyDigest) {
        yield [markerPath(replacement.metadata.keyDigest), replacement.handle];
        inserted = true;
      }
      const removed = digest === removeDigest ||
        (removeExpiredAt !== null && isExpired(current.metadata, removeExpiredAt));
      if (!removed && digest !== replacement?.metadata.keyDigest) {
        yield [markerPath(digest), current.handle];
      }
    }
    if (!inserted) {
      yield [markerPath(replacement.metadata.keyDigest), replacement.handle];
    }
  }

  async #readMarker(member, digest) {
    const handle = markerPageHandle(member);
    const metadata = this.#codec.decodeMarker(await this.#pages.get({
      handle,
      maxBytes: METADATA_PAGE_LIMIT,
    }));
    if (metadata.keyDigest !== digest) {
      throw invalid('Expiring marker digest does not match its index path', {
        digest,
        metadata,
      });
    }
    return Object.freeze({ metadata, handle });
  }

  static #assertDependencies(bundles, pages) {
    const bundleMethods = [
      'putOrderedReferences',
      'getMemberReference',
      'iterateMemberReferences',
    ];
    const missing = bundleMethods.filter((method) => typeof bundles?.[method] !== 'function');
    if (typeof pages?.put !== 'function' || typeof pages?.get !== 'function') {
      missing.push('pages.put/get');
    }
    if (missing.length > 0) {
      throw invalid('ExpiringSetIndex requires bundle and page services', { missing });
    }
  }
}

export function markerPath(digest) {
  assertDigest(digest);
  return `${EXPIRING_SET_MARKER_PREFIX}${digest}`;
}

function digestFromPath(path) {
  const digest = path.startsWith(EXPIRING_SET_MARKER_PREFIX)
    ? path.slice(EXPIRING_SET_MARKER_PREFIX.length)
    : '';
  assertDigest(digest, path);
  return digest;
}

function markerPageHandle(member) {
  if (member.handle.kind !== 'page') {
    throw invalid('ExpiringSet marker does not reference a page', {
      path: member.path,
      handle: member.handle.toString(),
    });
  }
  return PageHandle.from(member.handle);
}

function assertDigest(digest, path = null) {
  if (typeof digest !== 'string' || !DIGEST.test(digest)) {
    throw invalid('ExpiringSet index contains an invalid marker path', {
      digest,
      path,
    });
  }
}

function emptySummary() {
  return {
    entryCount: 0,
    liveEntries: 0,
    expiredEntries: 0,
    nextExpiry: null,
  };
}

function addToSummary(summary, marker, now) {
  if (summary.entryCount === Number.MAX_SAFE_INTEGER) {
    throw invalid('ExpiringSet entry count exceeds safe integer accounting');
  }
  summary.entryCount += 1;
  if (isExpired(marker, now)) {
    summary.expiredEntries += 1;
    return;
  }
  summary.liveEntries += 1;
  summary.nextExpiry = earlier(summary.nextExpiry, marker.expiresAt);
}

function earlier(current, candidate) {
  return current === null || candidate < current ? candidate : current;
}

function isExpired(marker, now) {
  return marker.expiresAt <= now;
}

function invalid(message, meta) {
  return createCasError(message, ErrorCodes.EXPIRING_SET_STATE_INVALID, meta);
}
