import { describe, expect, it } from 'vitest';
import ExpiringSetMetadataCodec, {
  createExpiringSetState,
} from '../../../../src/domain/services/ExpiringSetMetadataCodec.js';

const KEY_DIGEST = '1'.repeat(64);
const VERIFICATION_DIGEST = '2'.repeat(64);
const CREATED_AT = '2026-07-13T12:00:00.000Z';
const EXPIRES_AT = '2026-07-13T12:01:00.000Z';

describe('ExpiringSetMetadataCodec', () => {
  it('encodes marker metadata canonically without a plaintext key', () => {
    const codec = new ExpiringSetMetadataCodec();
    const encoded = codec.encodeMarker({
      expiresAt: EXPIRES_AT,
      verificationDigest: VERIFICATION_DIGEST,
      keyDigest: KEY_DIGEST,
      createdAt: CREATED_AT,
      version: 1,
    });
    const text = Buffer.from(encoded).toString('utf8');

    expect(text).toBe(JSON.stringify({
      version: 1,
      keyDigest: KEY_DIGEST,
      verificationDigest: VERIFICATION_DIGEST,
      expiresAt: EXPIRES_AT,
      createdAt: CREATED_AT,
    }, null, 2));
    expect(codec.decodeMarker(encoded)).toEqual(JSON.parse(text));
    expect(text).not.toContain('key":');
  });
});

describe('ExpiringSet metadata rejection', () => {
  it('rejects non-canonical marker bytes and inconsistent state counts', () => {
    const codec = new ExpiringSetMetadataCodec();
    const marker = {
      version: 1,
      keyDigest: KEY_DIGEST,
      verificationDigest: VERIFICATION_DIGEST,
      expiresAt: EXPIRES_AT,
      createdAt: CREATED_AT,
    };
    const reordered = Buffer.from(JSON.stringify({ ...marker, extra: true }));

    expect(() => codec.decodeMarker(reordered))
      .toThrow(expect.objectContaining({ code: 'EXPIRING_SET_MARKER_INVALID' }));
    expect(() => codec.encodeMarker({
      ...marker,
      verificationDigest: KEY_DIGEST,
    })).toThrow(expect.objectContaining({ code: 'EXPIRING_SET_MARKER_INVALID' }));
    expect(() => codec.encodeState({
      version: 1,
      namespace: 'git-warp/replay',
      entryCount: 2,
      liveEntries: 1,
      expiredEntries: 0,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      nextExpiry: EXPIRES_AT,
    })).toThrow(expect.objectContaining({ code: 'EXPIRING_SET_STATE_INVALID' }));
  });
});

describe('ExpiringSet state snapshots', () => {
  it('builds deterministic state snapshots from streamed summaries', () => {
    const state = createExpiringSetState({
      namespace: 'git-warp/replay',
      summary: {
        entryCount: 1,
        liveEntries: 1,
        expiredEntries: 0,
        nextExpiry: EXPIRES_AT,
      },
      previous: null,
      now: CREATED_AT,
    });

    expect(new ExpiringSetMetadataCodec().normalizeState(state)).toEqual(state);
  });
});
