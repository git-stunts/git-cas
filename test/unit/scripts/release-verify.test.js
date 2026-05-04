import { describe, it, expect, vi } from 'vitest';
import {
  RELEASE_STEPS,
  ReleaseVerifyError,
  extractNpmPackFilePaths,
  extractVitestTestCount,
  releaseStepsFor,
  renderMarkdownSummary,
  runReleaseVerify,
} from '../../../scripts/release/verify.js';

const QUIET_LOGGER = { line() {} };

/**
 * Create a successful release-step runner.
 *
 * @param {number} [testCount]
 * @returns {ReturnType<typeof vi.fn>}
 */
function makeSuccessRunner(testCount = 5) {
  return vi.fn(async (step) => ({
    code: 0,
    signal: null,
    stdout: successfulStepStdout(step, testCount),
    stderr: '',
  }));
}

/**
 * Create a runner that returns a non-zero outcome for a specific step.
 *
 * @param {string} failId
 * @param {number} [testCount]
 * @returns {ReturnType<typeof vi.fn>}
 */
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
      stdout: successfulStepStdout(step, testCount),
      stderr: '',
    };
  });
}

/**
 * Create a runner that throws for a specific step.
 *
 * @param {string} failId
 * @returns {ReturnType<typeof vi.fn>}
 */
function makeThrowingRunner(failId) {
  return vi.fn(async (step) => {
    if (step.id === failId) {
      throw new Error('runner exploded');
    }

    return {
      code: 0,
      signal: null,
      stdout: successfulStepStdout(step),
      stderr: '',
    };
  });
}

/**
 * Create a runner that omits signal values from successful outcomes.
 *
 * @returns {ReturnType<typeof vi.fn>}
 */
function makeUndefinedSignalRunner() {
  return vi.fn(async (step) => ({
    code: 0,
    stdout: successfulStepStdout(step),
    stderr: '',
  }));
}

/**
 * @param {typeof RELEASE_STEPS[number]} step
 * @param {number} [testCount]
 * @returns {string}
 */
function successfulStepStdout(step, testCount = 5) {
  if (step.testCount) {
    return `Tests  ${testCount} passed (${testCount})`;
  }
  if (step.requiredFiles) {
    return JSON.stringify([
      {
        files: step.requiredFiles.map((file) => ({ path: file })),
      },
    ]);
  }
  return '';
}

describe('release verify helpers', () => {
  it('parses Vitest test counts from ANSI-colored output', () => {
    const output = '\u001b[32mTests\u001b[39m  147 passed (147)';
    expect(extractVitestTestCount(output)).toBe(147);
  });

  it('extracts npm pack file paths from dry-run JSON', () => {
    const output = JSON.stringify([
      {
        files: [
          { path: 'index.js' },
          { path: 'build-info.json' },
        ],
      },
    ]);

    expect(extractNpmPackFilePaths(output)).toEqual(['index.js', 'build-info.json']);
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

  it('renders skipped release steps when provided', () => {
    const summary = renderMarkdownSummary({
      version: '6.0.0',
      totalTests: 0,
      skippedSteps: ['JSR publish dry-run'],
      results: [{ label: 'Lint', passed: true, tests: null }],
    });

    expect(summary).toContain('- Skipped steps: JSR publish dry-run');
  });
});

describe('release verify execution', () => {
  it('runs the release steps in order and aggregates test counts', async () => {
    const runner = makeSuccessRunner();

    const report = await runReleaseVerify({ runner, logger: QUIET_LOGGER });

    expect(runner).toHaveBeenCalledTimes(RELEASE_STEPS.length);
    expect(report.totalTests).toBe(30);
    expect(report.results.every((result) => result.passed)).toBe(true);
  });

  it('can skip the JSR publish dry-run for externally blocked releases', async () => {
    const runner = makeSuccessRunner();

    const report = await runReleaseVerify({ runner, logger: QUIET_LOGGER, skipJsr: true });

    expect(runner).toHaveBeenCalledTimes(RELEASE_STEPS.length - 1);
    expect(report.results.map((result) => result.id)).toEqual(
      releaseStepsFor({ skipJsr: true }).map((step) => step.id),
    );
    expect(report.results.some((result) => result.id === 'jsr-publish')).toBe(false);
    expect(report.skippedSteps).toEqual(['JSR publish dry-run']);
    expect(report.summary).toContain('- Skipped steps: JSR publish dry-run');
  });
});

describe('release verify failures', () => {
  it('treats missing signal values as a successful exit', async () => {
    const runner = makeUndefinedSignalRunner();

    const report = await runReleaseVerify({ runner, logger: QUIET_LOGGER });

    expect(report.results.every((result) => result.passed)).toBe(true);
    expect(report.results.every((result) => result.signal === null)).toBe(true);
  });

  it('stops on the first failure and exposes a partial summary', async () => {
    const runner = makeFailingRunner('unit-bun');
    const failure = await runReleaseVerify({ runner, logger: QUIET_LOGGER }).catch((error) => error);

    expect(failure).toBeInstanceOf(ReleaseVerifyError);
    expect(failure.name).toBe('ReleaseVerifyError');
    expect(failure.step).toMatchObject({ id: 'unit-bun', passed: false });
    expect(failure.summary).toContain('| Unit Tests (Bun) | FAIL | 5 |');
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it('converts thrown runner errors into structured release failures', async () => {
    const runner = makeThrowingRunner('unit-bun');
    const failure = await runReleaseVerify({ runner, logger: QUIET_LOGGER }).catch((error) => error);

    expect(failure).toBeInstanceOf(ReleaseVerifyError);
    expect(failure.step).toMatchObject({
      id: 'unit-bun',
      passed: false,
      code: 1,
      errorMessage: 'runner exploded',
    });
    expect(failure.summary).toContain('| Unit Tests (Bun) | FAIL |');
    expect(runner).toHaveBeenCalledTimes(3);
  });

});

describe('release verify package assertions', () => {
  it('fails npm pack when build-info.json is missing from the package file list', async () => {
    const runner = vi.fn(async (step) => ({
      code: 0,
      signal: null,
      stdout: step.id === 'npm-pack'
        ? JSON.stringify([{ files: [{ path: 'index.js' }] }])
        : successfulStepStdout(step),
      stderr: '',
    }));

    const failure = await runReleaseVerify({ runner, logger: QUIET_LOGGER }).catch((error) => error);

    expect(failure).toBeInstanceOf(ReleaseVerifyError);
    expect(failure.step).toMatchObject({
      id: 'npm-pack',
      passed: false,
      errorMessage: 'Package dry-run missing required file(s): build-info.json',
    });
  });
});
