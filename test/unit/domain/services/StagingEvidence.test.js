import { describe, expect, it } from 'vitest';
import StagingEvidence from '../../../../src/domain/services/StagingEvidence.js';

function handle(index) {
  return { toString: () => `handle-${index}` };
}

describe('StagingEvidence', () => {
  it('marks samples truncated only after evidence is omitted', () => {
    const evidence = new StagingEvidence();
    for (let index = 0; index < 32; index++) {
      evidence.recordHandle(handle(index));
    }

    expect(evidence.snapshot()).toMatchObject({
      stagedHandleCount: 32,
      stagedHandleSample: { length: 32 },
      sampleTruncated: false,
    });

    evidence.recordHandle(handle(32));
    expect(evidence.snapshot()).toMatchObject({
      stagedHandleCount: 33,
      stagedHandleSample: { length: 32 },
      sampleTruncated: true,
    });
  });
});
