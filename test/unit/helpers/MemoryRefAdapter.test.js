import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../src/domain/errors/index.js';
import MemoryRefAdapter from '../../helpers/MemoryRefAdapter.js';

const VAULT_REF = 'refs/cas/vault';

describe('MemoryRefAdapter missing refs', () => {
  it('resolves commit trees and reports missing refs with the vault-compatible code', async () => {
    const ref = new MemoryRefAdapter();
    const commitOid = await createCommit(ref, {
      treeOid: 'tree-a',
      parentOid: null,
      message: 'vault: init',
    });

    await expect(ref.resolveRef(VAULT_REF)).rejects.toMatchObject({
      code: ErrorCodes.GIT_REF_NOT_FOUND,
    });

    await ref.updateRef({
      ref: VAULT_REF,
      newOid: commitOid,
      expectedOldOid: null,
    });

    await expect(ref.resolveRef(VAULT_REF)).resolves.toBe(commitOid);
    await expect(ref.resolveTree(commitOid)).resolves.toBe('tree-a');
    await expect(ref.resolveParents(commitOid)).resolves.toEqual([]);
  });
});

describe('MemoryRefAdapter CAS updates', () => {
  it('enforces compare-and-swap ref updates for vault mutation tests', async () => {
    const ref = new MemoryRefAdapter();
    const first = await createCommit(ref, {
      treeOid: 'tree-a',
      parentOid: null,
      message: 'vault: init',
    });
    const second = await createCommit(ref, {
      treeOid: 'tree-b',
      parentOid: first,
      message: 'vault: add asset',
    });

    await ref.updateRef({
      ref: VAULT_REF,
      newOid: first,
      expectedOldOid: null,
    });

    await expect(ref.updateRef({
      ref: VAULT_REF,
      newOid: second,
      expectedOldOid: null,
    })).rejects.toMatchObject({
      code: 'GIT_ERROR',
    });

    await ref.updateRef({
      ref: VAULT_REF,
      newOid: second,
      expectedOldOid: first,
    });

    await expect(ref.resolveRef(VAULT_REF)).resolves.toBe(second);
    await expect(ref.resolveParents(second)).resolves.toEqual([first]);
  });
});

async function createCommit(ref, options) {
  return await ref.createCommit(options);
}
