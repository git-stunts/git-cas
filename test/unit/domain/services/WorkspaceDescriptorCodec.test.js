import { describe, expect, it } from 'vitest';
import WorkspaceDescriptorCodec, {
  MAX_WORKSPACE_TARGETS,
} from '../../../../src/domain/services/WorkspaceDescriptorCodec.js';
import WorkspaceRef from '../../../../src/domain/value-objects/WorkspaceRef.js';

const CREATED_AT = '2026-07-17T20:00:00.000Z';
const EXPIRES_AT = '2026-07-17T22:00:00.000Z';
const REF = WorkspaceRef.create({
  namespace: 'git-warp/materializations',
  createdAt: CREATED_AT,
  nonce: new Uint8Array(16),
}).toString();

function descriptor(overrides = {}) {
  return {
    version: 1,
    ref: REF,
    workspaceId: WorkspaceRef.from(REF).id,
    namespace: 'git-warp/materializations',
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    targetCount: 2,
    ...overrides,
  };
}

describe('WorkspaceDescriptorCodec', () => {
  it('round-trips one canonical lease descriptor', () => {
    const codec = new WorkspaceDescriptorCodec();
    const encoded = codec.encode(descriptor());

    expect(codec.decode(encoded, { expectedRef: REF })).toEqual(descriptor());
  });

  it.each([
    descriptor({ version: 2 }),
    descriptor({ workspaceId: 'wrong' }),
    descriptor({ namespace: 'another/namespace' }),
    descriptor({ ref: 'refs/cas/workspaces/not-a-workspace' }),
    descriptor({ createdAt: '2026-07-17T20:00:00Z' }),
    descriptor({ expiresAt: CREATED_AT }),
    descriptor({ targetCount: -1 }),
    descriptor({ targetCount: MAX_WORKSPACE_TARGETS + 1 }),
  ])('rejects an invalid descriptor %#', (value) => {
    const codec = new WorkspaceDescriptorCodec();

    expect(() => codec.encode(value)).toThrowError(
      expect.objectContaining({ code: 'WORKSPACE_DESCRIPTOR_INVALID' }),
    );
  });

  it('rejects non-canonical stored keys instead of silently normalizing them', () => {
    const codec = new WorkspaceDescriptorCodec();
    const value = { ...descriptor(), extra: true };

    expect(() => codec.decode(Buffer.from(JSON.stringify(value))))
      .toThrowError(expect.objectContaining({ code: 'WORKSPACE_DESCRIPTOR_INVALID' }));
  });

  it('rejects a valid JSON value that is not a descriptor object', () => {
    const codec = new WorkspaceDescriptorCodec();

    expect(() => codec.decode(Buffer.from('null'))).toThrowError(
      expect.objectContaining({ code: 'WORKSPACE_DESCRIPTOR_INVALID' }),
    );
  });
});
