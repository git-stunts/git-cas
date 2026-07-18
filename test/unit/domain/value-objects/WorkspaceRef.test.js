import { describe, expect, it } from 'vitest';
import WorkspaceRef, {
  WORKSPACE_REF_PREFIX,
} from '../../../../src/domain/value-objects/WorkspaceRef.js';

const CREATED_AT = '2026-07-17T20:00:00.000Z';
const NONCE = Uint8Array.from({ length: 16 }, (_, index) => index);

describe('WorkspaceRef', () => {
  it('creates and parses a canonical workspace ref', () => {
    const ref = WorkspaceRef.create({
      namespace: 'git-warp/materializations',
      createdAt: CREATED_AT,
      nonce: NONCE,
    });

    expect(ref.toString()).toMatch(
      /^refs\/cas\/workspaces\/git-warp\+materializations\/v1-[a-z0-9]+-[a-f0-9]{32}$/,
    );
    expect(ref.namespace).toBe('git-warp/materializations');
    expect(ref.id).toBe(ref.toString().slice(ref.toString().lastIndexOf('/') + 1));
    expect(WorkspaceRef.from(ref.toString()).toString()).toBe(ref.toString());
  });

  it.each([
    'refs/heads/main',
    WORKSPACE_REF_PREFIX,
    `${WORKSPACE_REF_PREFIX}git-warp/materializations/v1-abc-00000000000000000000000000000000`,
    `${WORKSPACE_REF_PREFIX}git-warp+materializations/not-a-workspace-id`,
    `${WORKSPACE_REF_PREFIX}git-warp++materializations/v1-abc-00000000000000000000000000000000`,
    `${WORKSPACE_REF_PREFIX}Git-warp+materializations/v1-abc-00000000000000000000000000000000`,
    `${WORKSPACE_REF_PREFIX}git-warp+materializations/v1-${Number.MAX_SAFE_INTEGER.toString(36)}-00000000000000000000000000000000`,
  ])('rejects malformed workspace ref %s', (ref) => {
    expect(() => WorkspaceRef.from(ref)).toThrowError(
      expect.objectContaining({ code: 'WORKSPACE_REF_INVALID' }),
    );
  });

  it('rejects malformed creation inputs', () => {
    expect(() => WorkspaceRef.create({
      namespace: 'Git-Warp',
      createdAt: CREATED_AT,
      nonce: NONCE,
    })).toThrowError(expect.objectContaining({ code: 'COLLECTION_NAMESPACE_INVALID' }));
    expect(() => WorkspaceRef.create({
      namespace: 'git-warp',
      createdAt: 'not-a-time',
      nonce: NONCE,
    })).toThrowError(expect.objectContaining({ code: 'WORKSPACE_REF_INVALID' }));
    expect(() => WorkspaceRef.create({
      namespace: 'git-warp',
      createdAt: CREATED_AT,
      nonce: new Uint8Array(15),
    })).toThrowError(expect.objectContaining({ code: 'WORKSPACE_REF_INVALID' }));
  });
});
