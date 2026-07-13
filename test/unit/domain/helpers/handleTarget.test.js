import { describe, expect, it } from 'vitest';
import { mapHandleTargetError } from '../../../../src/domain/helpers/handleTarget.js';
import PageHandle from '../../../../src/domain/value-objects/PageHandle.js';

describe('mapHandleTargetError', () => {
  it('uses a message from a non-Error throwable when mapping a missing target', () => {
    const handle = new PageHandle({ oid: 'a'.repeat(40) });
    const originalError = { message: `Object not found: ${handle.oid}` };

    expect(mapHandleTargetError(originalError, handle)).toMatchObject({
      code: 'HANDLE_TARGET_MISSING',
      meta: {
        handle: handle.toString(),
        targetOid: handle.oid,
        originalError,
      },
    });
  });
});
