import { describe, expect, it, vi } from 'vitest';
import CasError from '../../../../src/domain/errors/CasError.js';
import { ErrorCodes } from '../../../../src/domain/errors/index.js';
import RootSetMetadataCodec from '../../../../src/domain/services/RootSetMetadataCodec.js';
import RootSetPersistence from '../../../../src/domain/services/RootSetPersistence.js';

const REF = 'refs/cas/rootsets/warp/state-cache';
const NEW_COMMIT_OID = 'c'.repeat(40);
const EXPECTED_HEAD_OID = 'd'.repeat(40);
const TREE_ENTRY = {
  name: 'snapshot:tree',
  oid: 'a'.repeat(40),
  type: 'tree',
  retention: 'evictable',
};
const BLOB_ENTRY = {
  name: 'snapshot:blob',
  oid: 'b'.repeat(40),
  type: 'blob',
  retention: 'pinned',
};

function mockPersistence(overrides = {}) {
  return {
    writeBlob: vi.fn(),
    writeTree: vi.fn(),
    readBlob: vi.fn(),
    readTree: vi.fn(),
    readObjectType: vi.fn().mockImplementation(async (oid) => (
      oid === BLOB_ENTRY.oid ? 'blob' : 'tree'
    )),
    ...overrides,
  };
}

function mockRef(overrides = {}) {
  return {
    resolveRef: vi.fn(),
    resolveTree: vi.fn(),
    resolveParents: vi.fn().mockResolvedValue([]),
    createCommit: vi.fn(),
    updateRef: vi.fn(),
    ...overrides,
  };
}

function exactUpdateRefArgs(ref = REF, expectedHeadOid = EXPECTED_HEAD_OID) {
  return [
    'update-ref',
    '--no-deref',
    ref,
    NEW_COMMIT_OID,
    expectedHeadOid ?? '0'.repeat(NEW_COMMIT_OID.length),
  ];
}

function structuredUpdateRefLock({
  ref = REF,
  args = exactUpdateRefArgs(ref),
  stderr = `fatal: cannot lock ref '${ref}': lock file exists`,
} = {}) {
  return Object.assign(new Error('Git command failed: repository is locked'), {
    details: {
      code: 'GIT_REPOSITORY_LOCKED',
      args,
      stderr,
    },
  });
}

function emptyUpdateRefFailure({
  args = exactUpdateRefArgs(),
  code = 128,
} = {}) {
  return Object.assign(new Error(`Git command failed with code ${code}`), {
    details: {
      code,
      args,
      stderr: '',
      stdout: '',
    },
  });
}

async function expectStructuredLockCode(error, expectedHeadOid, code) {
  const persistence = mockPersistence({
    writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)),
    writeTree: vi.fn().mockResolvedValue('b'.repeat(40)),
  });
  const ref = mockRef({
    createCommit: vi.fn().mockResolvedValue(NEW_COMMIT_OID),
    updateRef: vi.fn().mockRejectedValue(error),
  });
  const rootSet = new RootSetPersistence({ rootSetRef: REF, persistence, ref });

  await expect(rootSet.write({ entries: [], expectedHeadOid }))
    .rejects.toMatchObject({ code });
}

async function expectEmptyUpdateRefFailureCode({
  actualHeadOid,
  args = exactUpdateRefArgs(),
  gitExitCode = 128,
  expectedCode,
}) {
  const persistence = mockPersistence({
    writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)),
    writeTree: vi.fn().mockResolvedValue('b'.repeat(40)),
  });
  const ref = mockRef({
    resolveRef: vi.fn().mockResolvedValue(actualHeadOid),
    createCommit: vi.fn().mockResolvedValue(NEW_COMMIT_OID),
    updateRef: vi.fn().mockRejectedValue(emptyUpdateRefFailure({
      args,
      code: gitExitCode,
    })),
  });
  const rootSet = new RootSetPersistence({ rootSetRef: REF, persistence, ref });

  await expect(rootSet.write({ entries: [], expectedHeadOid: EXPECTED_HEAD_OID }))
    .rejects.toMatchObject({
      code: expectedCode,
      meta: { expectedHeadOid: EXPECTED_HEAD_OID, actualHeadOid },
    });
}

describe('RootSetPersistence snapshot writes', () => {
  it('writes real tree edges and a parentless current-generation commit', async () => {
    const persistence = mockPersistence({
      writeBlob: vi.fn().mockResolvedValue('c'.repeat(40)),
      writeTree: vi.fn().mockResolvedValue('d'.repeat(40)),
    });
    const ref = mockRef({
      createCommit: vi.fn().mockResolvedValue('e'.repeat(40)),
      updateRef: vi.fn().mockResolvedValue(undefined),
    });
    const rootSet = new RootSetPersistence({ rootSetRef: REF, persistence, ref });

    await rootSet.write({
      entries: [TREE_ENTRY, BLOB_ENTRY],
      expectedHeadOid: 'f'.repeat(40),
    });

    expect(persistence.writeTree).toHaveBeenCalledWith([
      `100644 blob ${'c'.repeat(40)}\t.rootset.json`,
      `100644 blob ${BLOB_ENTRY.oid}\troot-00000000`,
      `040000 tree ${TREE_ENTRY.oid}\troot-00000001`,
    ]);
    expect(ref.createCommit).toHaveBeenCalledWith({
      treeOid: 'd'.repeat(40),
      parentOid: null,
      message: 'root-set: replace current roots',
    });
    expect(ref.updateRef).toHaveBeenCalledWith({
      ref: REF,
      newOid: 'e'.repeat(40),
      expectedOldOid: 'f'.repeat(40),
    });
  });

});

describe('RootSetPersistence write conflicts', () => {
  it('normalizes compare-and-swap failures as ROOT_SET_CONFLICT', async () => {
    const conflict = new CasError('Ref changed', ErrorCodes.GIT_ERROR, {
      expectedOldOid: 'd'.repeat(40),
      actualOldOid: 'e'.repeat(40),
    });
    const persistence = mockPersistence({
      writeBlob: vi.fn().mockResolvedValue('a'.repeat(40)),
      writeTree: vi.fn().mockResolvedValue('b'.repeat(40)),
    });
    const ref = mockRef({
      createCommit: vi.fn().mockResolvedValue('c'.repeat(40)),
      updateRef: vi.fn().mockRejectedValue(conflict),
    });
    const rootSet = new RootSetPersistence({ rootSetRef: REF, persistence, ref });

    await expect(rootSet.write({ entries: [], expectedHeadOid: 'd'.repeat(40) }))
      .rejects.toMatchObject({
        code: 'ROOT_SET_CONFLICT',
        meta: {
          expectedHeadOid: 'd'.repeat(40),
          actualHeadOid: 'e'.repeat(40),
          newCommit: 'c'.repeat(40),
        },
      });
  });
});

describe('RootSetPersistence structured lock conflicts', () => {
  it('normalizes a structured lock for the exact managed update-ref command', async () => {
    await expectStructuredLockCode(
      structuredUpdateRefLock(),
      EXPECTED_HEAD_OID,
      'ROOT_SET_CONFLICT',
    );
  });

  it('normalizes an exact managed creation lock with a zero expected OID', async () => {
    await expectStructuredLockCode(
      structuredUpdateRefLock({ args: exactUpdateRefArgs(REF, null) }),
      null,
      'ROOT_SET_CONFLICT',
    );
  });

  it('keeps a structured lock for another ref as a non-conflict failure', async () => {
    await expectStructuredLockCode(
      structuredUpdateRefLock({ ref: 'refs/heads/other' }),
      EXPECTED_HEAD_OID,
      'ROOT_SET_REF_UPDATE_FAILED',
    );
  });
});

describe('RootSetPersistence observed compare-and-swap conflicts', () => {
  it('normalizes an empty fatal response when the exact managed ref advanced', async () => {
    await expectEmptyUpdateRefFailureCode({
      actualHeadOid: 'e'.repeat(40),
      expectedCode: 'ROOT_SET_CONFLICT',
    });
  });

  it.each([
    ['the managed ref did not advance', {
      args: exactUpdateRefArgs(),
      actualHeadOid: EXPECTED_HEAD_OID,
    }],
    ['the managed ref differed only by OID case', {
      args: exactUpdateRefArgs(),
      actualHeadOid: EXPECTED_HEAD_OID.toUpperCase(),
    }],
    ['the failed command targeted another ref', {
      args: exactUpdateRefArgs('refs/heads/other'),
      actualHeadOid: 'e'.repeat(40),
    }],
    ['the failure was not a fatal Git exit', {
      args: exactUpdateRefArgs(),
      actualHeadOid: 'e'.repeat(40),
      gitExitCode: 1,
    }],
  ])('keeps the failure terminal when %s', async (_label, options) => {
    await expectEmptyUpdateRefFailureCode({
      ...options,
      expectedCode: 'ROOT_SET_REF_UPDATE_FAILED',
    });
  });
});

describe('RootSetPersistence malformed structured locks', () => {
  const exactArgs = exactUpdateRefArgs();
  const conflictText =
    `fatal: cannot lock ref '${REF}': is at ${'e'.repeat(40)} but expected ${EXPECTED_HEAD_OID}`;
  it.each([
    ['missing OID operands', { args: exactArgs.slice(0, 3) }],
    ['missing expected OID', { args: exactArgs.slice(0, 4) }],
    ['altered new OID', { args: [...exactArgs.slice(0, 3), 'e'.repeat(40), EXPECTED_HEAD_OID] }],
    ['altered expected OID', { args: [...exactArgs.slice(0, 4), 'e'.repeat(40)] }],
    ['trailing operand despite conflict text', { args: [...exactArgs, 'extra'], stderr: conflictText }],
  ])('keeps %s terminal', async (_label, options) => {
    await expectStructuredLockCode(
      structuredUpdateRefLock(options),
      EXPECTED_HEAD_OID,
      'ROOT_SET_REF_UPDATE_FAILED',
    );
  });
});

describe('RootSetPersistence target validation', () => {
  it('rejects missing targets before writing metadata', async () => {
    const persistence = mockPersistence({
      readObjectType: vi.fn().mockRejectedValue(
        new CasError('missing object', ErrorCodes.GIT_OBJECT_NOT_FOUND),
      ),
    });
    const rootSet = new RootSetPersistence({
      rootSetRef: REF,
      persistence,
      ref: mockRef(),
    });

    await expect(rootSet.write({ entries: [TREE_ENTRY], expectedHeadOid: null }))
      .rejects.toMatchObject({ code: 'ROOT_SET_TARGET_MISSING' });
    expect(persistence.writeBlob).not.toHaveBeenCalled();
  });

  it('rejects target type mismatches before writing metadata', async () => {
    const persistence = mockPersistence({
      readObjectType: vi.fn().mockResolvedValue('blob'),
    });
    const rootSet = new RootSetPersistence({
      rootSetRef: REF,
      persistence,
      ref: mockRef(),
    });

    await expect(rootSet.write({ entries: [TREE_ENTRY], expectedHeadOid: null }))
      .rejects.toMatchObject({ code: 'ROOT_SET_TARGET_TYPE_MISMATCH' });
    expect(persistence.writeBlob).not.toHaveBeenCalled();
  });

  it('does not misclassify inspection failures as missing targets', async () => {
    const persistence = mockPersistence({
      readObjectType: vi.fn().mockRejectedValue(new Error('permission denied')),
    });
    const rootSet = new RootSetPersistence({
      rootSetRef: REF,
      persistence,
      ref: mockRef(),
    });

    await expect(rootSet.write({ entries: [TREE_ENTRY], expectedHeadOid: null }))
      .rejects.toMatchObject({ code: 'ROOT_SET_TARGET_UNREADABLE' });
  });
});

describe('RootSetPersistence reads', () => {
  it('returns an empty state when the root-set ref is absent', async () => {
    const missing = new CasError('missing', ErrorCodes.GIT_REF_NOT_FOUND);
    const rootSet = new RootSetPersistence({
      rootSetRef: REF,
      persistence: mockPersistence(),
      ref: mockRef({ resolveRef: vi.fn().mockRejectedValue(missing) }),
    });

    await expect(rootSet.read()).resolves.toEqual({
      ref: REF,
      headOid: null,
      treeOid: null,
      entries: [],
    });
  });

  it('rejects metadata whose slot does not match the Git tree edge', async () => {
    const codec = new RootSetMetadataCodec();
    const metadataOid = 'c'.repeat(40);
    const persistence = mockPersistence({
      readBlob: vi.fn().mockResolvedValue(codec.encode({ ref: REF, entries: [TREE_ENTRY] })),
      readTree: vi.fn().mockResolvedValue([
        { mode: '100644', type: 'blob', oid: metadataOid, name: '.rootset.json' },
        { mode: '040000', type: 'tree', oid: 'd'.repeat(40), name: 'root-00000000' },
      ]),
    });
    const ref = mockRef({
      resolveRef: vi.fn().mockResolvedValue('e'.repeat(40)),
      resolveTree: vi.fn().mockResolvedValue('f'.repeat(40)),
    });
    const rootSet = new RootSetPersistence({ rootSetRef: REF, persistence, ref });

    await expect(rootSet.read()).rejects.toMatchObject({ code: 'ROOT_SET_TREE_INVALID' });
  });
});

describe('RootSetPersistence head validation', () => {
  it('rejects a parentful head that would retain old generations', async () => {
    const persistence = mockPersistence();
    const ref = mockRef({
      resolveRef: vi.fn().mockResolvedValue('e'.repeat(40)),
      resolveParents: vi.fn().mockResolvedValue(['d'.repeat(40)]),
    });
    const rootSet = new RootSetPersistence({ rootSetRef: REF, persistence, ref });

    await expect(rootSet.read()).rejects.toMatchObject({
      code: 'ROOT_SET_HEAD_INVALID',
      meta: {
        commitOid: 'e'.repeat(40),
        parentOids: ['d'.repeat(40)],
      },
    });
    expect(persistence.readTree).not.toHaveBeenCalled();
  });
});
