import { describe, it, expect, vi } from 'vitest';
import {
  RELEASE_STEPS,
  ReleaseVerifyError,
  extractVitestTestCount,
  renderMarkdownSummary,
  runReleaseVerify,
} from '../../../scripts/release/verify.js';

const QUIET_LOGGER = { line() {} };

function makeSuccessRunner(testCount = 5) {
  return vi.fn(async (step) => ({
    code: 0,
    signal: null,
    stdout: step.testCount ? `Tests  ${testCount} passed (${testCount})` : '',
    stderr: '',
  }));
}

function makeFailingRunner(failId, testCount = 5) {
  return vi.fn(async (step) => {
    if (step.id === failId) {
      return {
        code: 1,
        signal: null,
        stdout: `Tests  ${testCount} passed (${testCount})`,
        stderr: 'boom',
      };
    }

    return {
      code: 0,
      signal: null,
      stdout: step.testCount ? `Tests  ${testCount} passed (${testCount})` : '',
      stderr: '',
    };
  });
}

describe('release verify', () => {
  it('parses Vitest test counts from ANSI-colored output', () => {
    const output = '\u001b[32mTests\u001b[39m  147 passed (147)';
    expect(extractVitestTestCount(output)).toBe(147);
  });

  it('renders a markdown summary with total test counts', () => {
    const summary = renderMarkdownSummary({
      version: '5.3.3',
      totalTests: 12,
      results: [
        { label: 'Lint', passed: true, tests: null },
        { label: 'Unit Tests (Node)', passed: true, tests: 12 },
      ],
    });

    expect(summary).toContain('## Release Verification Summary');
    expect(summary).toContain('- Version: `5.3.3`');
    expect(summary).toContain('- Total tests observed: 12');
    expect(summary).toContain('| Unit Tests (Node) | PASS | 12 |');
  });

  it('runs the release steps in order and aggregates test counts', async () => {
    const runner = makeSuccessRunner();

    const report = await runReleaseVerify({ runner, logger: QUIET_LOGGER });

    expect(runner).toHaveBeenCalledTimes(RELEASE_STEPS.length);
    expect(report.totalTests).toBe(30);
    expect(report.results.every((result) => result.passed)).toBe(true);
  });

  it('stops on the first failure and exposes a partial summary', async () => {
    const runner = makeFailingRunner('unit-bun');

    await expect(runReleaseVerify({ runner, logger: QUIET_LOGGER })).rejects.toMatchObject({
      name: 'ReleaseVerifyError',
      step: expect.objectContaining({ id: 'unit-bun', passed: false }),
    });

    const failure = await runReleaseVerify({ runner, logger: QUIET_LOGGER }).catch((error) => error);
    expect(failure).toBeInstanceOf(ReleaseVerifyError);
    expect(failure.summary).toContain('| Unit Tests (Bun) | FAIL | 5 |');
    expect(runner).toHaveBeenCalledTimes(6);
  });
});
