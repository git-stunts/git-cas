import { describe, expect, it } from 'vitest';
import { comparison } from '../../../scripts/diagnostics/measure-bounded-write-waves.js';

describe('bounded write-wave benchmark comparison', () => {
  it('rejects semantically unequal benchmark modes', () => {
    expect(() => comparison({
      left: sample('left-digest'),
      right: sample('right-digest'),
    })).toThrow(/semantic digest/u);
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
