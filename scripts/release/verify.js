#!/usr/bin/env node

/**
 * @fileoverview Release verification runner for maintainers. Executes the full
 * multi-runtime release checklist and emits a Markdown summary suitable for
 * changelog or release-note preparation.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CWD = path.resolve(__dirname, '../..');
const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`, 'gu');
const DEFAULT_LOGGER = {
  /**
   * Print a single log line.
   *
   * @param {string} [text]
   * @returns {void}
   */
  line(text = '') {
    process.stdout.write(`${text}\n`);
  },
};

export const RELEASE_STEPS = [
  {
    id: 'lint',
    label: 'Lint',
    command: 'pnpm',
    args: ['run', 'lint'],
  },
  {
    id: 'unit-node',
    label: 'Unit Tests (Node)',
    command: 'pnpm',
    args: ['test'],
    testCount: true,
  },
  {
    id: 'example-store-and-restore',
    label: 'Example: store-and-restore',
    command: 'node',
    args: ['examples/store-and-restore.js'],
  },
  {
    id: 'example-encrypted-workflow',
    label: 'Example: encrypted-workflow',
    command: 'node',
    args: ['examples/encrypted-workflow.js'],
  },
  {
    id: 'example-progress-tracking',
    label: 'Example: progress-tracking',
    command: 'node',
    args: ['examples/progress-tracking.js'],
  },
  {
    id: 'unit-bun',
    label: 'Unit Tests (Bun)',
    command: 'docker',
    args: ['compose', 'run', '--build', '--rm', 'test-bun', 'bunx', 'vitest', 'run', 'test/unit'],
    testCount: true,
  },
  {
    id: 'unit-deno',
    label: 'Unit Tests (Deno)',
    command: 'docker',
    args: ['compose', 'run', '--build', '--rm', 'test-deno', 'deno', 'run', '-A', 'npm:vitest', 'run', 'test/unit'],
    testCount: true,
  },
  {
    id: 'integration-node',
    label: 'Integration Tests (Node)',
    command: 'pnpm',
    args: ['run', 'test:integration:node'],
    testCount: true,
  },
  {
    id: 'integration-bun',
    label: 'Integration Tests (Bun)',
    command: 'pnpm',
    args: ['run', 'test:integration:bun'],
    testCount: true,
  },
  {
    id: 'integration-deno',
    label: 'Integration Tests (Deno)',
    command: 'pnpm',
    args: ['run', 'test:integration:deno'],
    testCount: true,
  },
  {
    id: 'stamp-build',
    label: 'Build metadata stamp',
    command: 'pnpm',
    args: ['run', 'stamp'],
  },
  {
    id: 'npm-pack',
    label: 'npm pack dry-run',
    command: 'npm',
    args: ['pack', '--dry-run', '--json'],
    requiredFiles: ['build-info.json'],
  },
  {
    id: 'jsr-publish',
    label: 'JSR publish dry-run',
    command: 'npx',
    args: ['jsr', 'publish', '--dry-run', '--allow-dirty'],
  },
];

export class ReleaseVerifyError extends Error {
  constructor(message, { step, results, summary, version, totalTests, skippedSteps } = {}) {
    super(message);
    this.name = 'ReleaseVerifyError';
    this.step = step;
    this.results = results ?? [];
    this.summary = summary ?? '';
    this.version = version ?? '';
    this.totalTests = totalTests ?? 0;
    this.skippedSteps = skippedSteps ?? [];
  }
}

export function stripAnsi(text = '') {
  return `${text}`.replace(ANSI_RE, '');
}

export function extractVitestTestCount(output = '') {
  const normalized = stripAnsi(output);
  const match = normalized.match(/Tests\s+(\d+)\s+passed/iu);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Extract package file paths from `npm pack --json` output.
 *
 * @param {string} output
 * @returns {string[]}
 */
export function extractNpmPackFilePaths(output = '') {
  const normalized = stripAnsi(output).trim();
  if (!normalized) { return []; }
  const parsed = JSON.parse(normalized);
  const packEntries = Array.isArray(parsed) ? parsed : [parsed];
  return packEntries.flatMap((entry) =>
    Array.isArray(entry.files)
      ? entry.files.map((file) => file.path)
      : []
  );
}

export function renderMarkdownSummary({ version, results, totalTests, skippedSteps = [] }) {
  const lines = [
    '## Release Verification Summary',
    '',
    `- Version: \`${version}\``,
    `- Steps passed: ${results.filter((result) => result.passed).length}/${results.length}`,
    `- Total tests observed: ${totalTests}`,
  ];

  if (skippedSteps.length > 0) {
    lines.push(`- Skipped steps: ${skippedSteps.join(', ')}`);
  }

  lines.push('', '| Step | Status | Tests |', '| --- | --- | ---: |');

  for (const result of results) {
    lines.push(`| ${result.label} | ${result.passed ? 'PASS' : 'FAIL'} | ${result.tests ?? '—'} |`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Render the report as machine-readable JSON.
 *
 * @param {{ version: string, results: Array<Record<string, any>>, totalTests: number, step?: Record<string, any>, skippedSteps?: string[] }} report
 * @returns {string}
 */
export function renderJsonReport({ version, results, totalTests, step, skippedSteps = [] }) {
  return `${JSON.stringify({
    version,
    stepsPassed: results.filter((result) => result.passed).length,
    totalSteps: results.length,
    skippedSteps,
    totalTests,
    failedStep: step ? { id: step.id, label: step.label } : null,
    results,
  }, null, 2)}\n`;
}

/**
 * Sum every observed test count across all executed steps.
 *
 * @param {Array<{ tests: number | null | undefined }>} results
 * @returns {number}
 */
function totalObservedTests(results) {
  return results.reduce((sum, item) => sum + (item.tests ?? 0), 0);
}

/**
 * Select release steps for this run.
 *
 * @param {{ skipJsr?: boolean }} [options]
 * @returns {typeof RELEASE_STEPS}
 */
export function releaseStepsFor({ skipJsr = false } = {}) {
  if (!skipJsr) {
    return RELEASE_STEPS;
  }
  return RELEASE_STEPS.filter((step) => step.id !== 'jsr-publish');
}

/**
 * Normalize a runner outcome into the release-step shape used by summaries.
 *
 * @param {typeof RELEASE_STEPS[number]} step
 * @param {{ code?: number | null, signal?: NodeJS.Signals | null, stdout?: string, stderr?: string, errorMessage?: string | null }} outcome
 * @returns {{ id: string, label: string, command: string, args: string[], testCount?: boolean, code: number | null | undefined, signal: NodeJS.Signals | null, passed: boolean, tests: number | null, errorMessage: string | null }}
 */
function buildStepResult(step, outcome) {
  const combinedOutput = `${outcome.stdout ?? ''}${outcome.stderr ?? ''}`;
  const signal = outcome.signal ?? null;
  const fileAssertionError = validateRequiredFiles(step, combinedOutput);
  return {
    ...step,
    code: outcome.code,
    signal,
    passed: outcome.code === 0 && signal === null && fileAssertionError === null,
    tests: step.testCount ? extractVitestTestCount(combinedOutput) : null,
    errorMessage: outcome.errorMessage ?? fileAssertionError,
  };
}

/**
 * @param {typeof RELEASE_STEPS[number]} step
 * @param {string} output
 * @returns {string|null}
 */
function validateRequiredFiles(step, output) {
  if (!step.requiredFiles) { return null; }
  try {
    const paths = new Set(extractNpmPackFilePaths(output));
    const missing = step.requiredFiles.filter((file) => !paths.has(file));
    return missing.length === 0
      ? null
      : `Package dry-run missing required file(s): ${missing.join(', ')} (run 'pnpm run stamp' to generate build-info.json)`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Could not parse npm pack JSON output: ${message}`;
  }
}

/**
 * Execute a single step with live stdout/stderr passthrough.
 *
 * @param {typeof RELEASE_STEPS[number]} step
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{ code: number, signal: NodeJS.Signals | null, stdout: string, stderr: string }>}
 */
export async function defaultRunner(step, { cwd = DEFAULT_CWD } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({
        code: code ?? 1,
        signal: signal ?? null,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Read the package version from the repository root.
 *
 * @param {string} cwd
 * @returns {string}
 */
function readVersion(cwd) {
  const packageJson = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  return packageJson.version;
}

/**
 * Print the heading for a release step.
 *
 * @param {typeof RELEASE_STEPS[number]} step
 * @param {{ line: (text?: string) => void }} logger
 * @returns {void}
 */
function printStepBanner(step, logger) {
  logger.line(`\n==> ${step.label}`);
  logger.line(`$ ${step.command} ${step.args.join(' ')}`);
}

/**
 * Execute a step and normalize thrown runner errors into step results.
 *
 * @param {typeof RELEASE_STEPS[number]} step
 * @param {{ cwd: string, runner: typeof defaultRunner }} options
 * @returns {Promise<ReturnType<typeof buildStepResult>>}
 */
async function runStep(step, { cwd, runner }) {
  try {
    const outcome = await runner(step, { cwd });
    return buildStepResult(step, outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildStepResult(step, {
      code: 1,
      signal: null,
      stdout: '',
      stderr: `${message}\n`,
      errorMessage: message,
    });
  }
}

/**
 * Execute the full release checklist and return a Markdown summary.
 *
 * @param {{ cwd?: string, runner?: typeof defaultRunner, logger?: { line: (text?: string) => void }, skipJsr?: boolean }} [options]
 * @returns {Promise<{ version: string, results: Array<ReturnType<typeof buildStepResult>>, totalTests: number, skippedSteps: string[], summary: string }>}
 */
export async function runReleaseVerify({
  cwd = DEFAULT_CWD,
  runner = defaultRunner,
  logger = DEFAULT_LOGGER,
  skipJsr = false,
} = {}) {
  const version = readVersion(cwd);
  const results = [];
  const skippedSteps = skipJsr ? ['JSR publish dry-run'] : [];

  for (const step of releaseStepsFor({ skipJsr })) {
    printStepBanner(step, logger);
    const result = await runStep(step, { cwd, runner });
    results.push(result);

    if (!result.passed) {
      const totalTests = totalObservedTests(results);
      const summary = renderMarkdownSummary({ version, results, totalTests, skippedSteps });
      throw new ReleaseVerifyError(`Release verification failed at ${step.label}`, {
        step: result,
        results,
        summary,
        version,
        totalTests,
        skippedSteps,
      });
    }
  }

  const totalTests = totalObservedTests(results);
  return {
    version,
    results,
    totalTests,
    skippedSteps,
    summary: renderMarkdownSummary({ version, results, totalTests, skippedSteps }),
  };
}

/**
 * Resolve the CLI output format from argv.
 *
 * @param {string[]} [argv]
 * @returns {'markdown' | 'json'}
 */
export function resolveOutputFormat(argv = process.argv.slice(2)) {
  return argv.includes('--json') ? 'json' : 'markdown';
}

/**
 * Resolve release verification behavior from argv.
 *
 * @param {string[]} [argv]
 * @returns {{ skipJsr: boolean }}
 */
export function resolveReleaseOptions(argv = process.argv.slice(2)) {
  return {
    skipJsr: argv.includes('--skip-jsr'),
  };
}

/**
 * CLI entry point for `pnpm release:verify`.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const argv = process.argv.slice(2);
  const format = resolveOutputFormat(argv);
  const options = resolveReleaseOptions(argv);
  try {
    const report = await runReleaseVerify(options);
    if (format === 'json') {
      process.stdout.write(renderJsonReport(report));
    } else {
      process.stdout.write(`\n${report.summary}`);
    }
  } catch (error) {
    if (error instanceof ReleaseVerifyError) {
      if (format === 'json') {
        process.stderr.write(renderJsonReport(error));
      } else {
        process.stderr.write(`\n${error.summary}`);
      }
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
