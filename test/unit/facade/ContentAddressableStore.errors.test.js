import { describe, expect, it } from 'vitest';
import ContentAddressableStore, * as packageApi from '../../../index.js';

describe('ContentAddressableStore error surface', () => {
  it('re-exports CasError for public instanceof checks', () => {
    expect(packageApi.CasError).toBeDefined();
    expect(new packageApi.CasError('boom', 'TEST_CODE')).toBeInstanceOf(Error);
  });

  it('explains how trusted callers can choose a restoreFile baseDirectory', async () => {
    const cas = new ContentAddressableStore({ plumbing: {} });

    await expect(cas.restoreFile({
      manifest: {},
      outputPath: 'restored.bin',
    })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
      message: expect.stringContaining('process.cwd()'),
    });
  });
});
