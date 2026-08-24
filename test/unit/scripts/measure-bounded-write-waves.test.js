import { describe, expect, it } from 'vitest';
import { MAX_WORKSPACE_COMPOUND_OPERATIONS } from '../../../index.js';
import {
  comparison,
  compoundComparison,
  compoundOperationCount,
} from '../../../scripts/diagnostics/measure-bounded-write-waves.js';

describe('bounded write-wave benchmark comparison', () => {
  it('rejects semantically unequal benchmark modes', () => {
    expect(() => comparison({
      left: sample('left-digest'),
      right: sample('right-digest'),
    })).toThrow(/semantic digest/u);
  });

  it('rejects semantically unequal compound admission modes', () => {
    expect(() => compoundComparison({
      left: sample('per-wave-digest'),
      right: sample('compound-digest'),
    })).toThrow(/semantic digest/u);
  });

  it('uses the public compound-operation ceiling', () => {
    const maximumGroups = Math.floor((MAX_WORKSPACE_COMPOUND_OPERATIONS - 1) / 2);

    expect(compoundOperationCount(maximumGroups)).toBe(maximumGroups * 2 + 1);
    expect(() => compoundOperationCount(maximumGroups + 1)).toThrow(/workspace operation ceiling/u);
  });
});

function sample(semanticDigest) {
  return {
    semanticDigest,
    processCount: 1,
    gitInteractionCount: 1,
    wallMs: 1,
    workerCpuMs: 1,
  };
}
