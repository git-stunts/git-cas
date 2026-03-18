import { describe, it, expect } from 'vitest';
import {
  renderJsonReport,
  resolveOutputFormat,
} from '../../../scripts/release/verify.js';

describe('release verify CLI helpers', () => {
  it('uses json output when --json is present', () => {
    expect(resolveOutputFormat(['--json'])).toBe('json');
    expect(resolveOutputFormat([])).toBe('markdown');
  });

  it('renders machine-readable release output', () => {
    const output = renderJsonReport({
      version: '5.3.3',
      totalTests: 12,
      results: [
        { id: 'lint', label: 'Lint', passed: true, tests: null, code: 0, signal: null, errorMessage: null },
        { id: 'unit-node', label: 'Unit Tests (Node)', passed: true, tests: 12, code: 0, signal: null, errorMessage: null },
      ],
    });

    const report = JSON.parse(output);
    expect(report.version).toBe('5.3.3');
    expect(report.stepsPassed).toBe(2);
    expect(report.totalSteps).toBe(2);
    expect(report.totalTests).toBe(12);
    expect(report.results[1]).toMatchObject({
      id: 'unit-node',
      label: 'Unit Tests (Node)',
      tests: 12,
      passed: true,
    });
  });
});
