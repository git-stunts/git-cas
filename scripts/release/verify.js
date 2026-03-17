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
    id: 'npm-pack',
    label: 'npm pack dry-run',
    command: 'npm',
    args: ['pack', '--dry-run'],
  },
  {
    id: 'jsr-publish',
    label: 'JSR publish dry-run',
    command: 'npx',
    args: ['jsr', 'publish', '--dry-run', '--allow-dirty'],
  },
];

export class ReleaseVerifyError extends Error {
  constructor(message, { step, results, summary } = {}) {
    super(message);
    this.name = 'ReleaseVerifyError';
    this.step = step;
    this.results = results ?? [];
    this.summary = summary ?? '';
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

export function renderMarkdownSummary({ version, results, totalTests }) {
  const lines = [
    '## Release Verification Summary',
    '',
    `- Version: \`${version}\``,
    `- Steps passed: ${results.filter((result) => result.passed).length}/${results.length}`,
    `- Total tests observed: ${totalTests}`,
    '',
    '| Step | Status | Tests |',
    '| --- | --- | ---: |',
  ];

  for (const result of results) {
    lines.push(`| ${result.label} | ${result.passed ? 'PASS' : 'FAIL'} | ${result.tests ?? '—'} |`);
  }

  return `${lines.join('\n')}\n`;
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
 * Normalize a runner outcome into the release-step shape used by summaries.
 *
 * @param {typeof RELEASE_STEPS[number]} step
 * @param {{ code?: number | null, signal?: NodeJS.Signals | null, stdout?: string, stderr?: string, errorMessage?: string | null }} outcome
 * @returns {{ id: string, label: string, command: string, args: string[], testCount?: boolean, code: number | null | undefined, signal: NodeJS.Signals | null, passed: boolean, tests: number | null, errorMessage: string | null }}
 */
function buildStepResult(step, outcome) {
  const combinedOutput = `${outcome.stdout ?? ''}${outcome.stderr ?? ''}`;
  return {
    ...step,
    code: outcome.code,
    signal: outcome.signal ?? null,
    passed: outcome.code === 0 && outcome.signal === null,
    tests: step.testCount ? extractVitestTestCount(combinedOutput) : null,
    errorMessage: outcome.errorMessage ?? null,
  };
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
 * Execute the full release checklist and return a Markdown summary.
 *
 * @param {{ cwd?: string, runner?: typeof defaultRunner, logger?: { line: (text?: string) => void } }} [options]
 * @returns {Promise<{ version: string, results: Array<ReturnType<typeof buildStepResult>>, totalTests: number, summary: string }>}
 */
export async function runReleaseVerify({
  cwd = DEFAULT_CWD,
  runner = defaultRunner,
  logger = DEFAULT_LOGGER,
} = {}) {
  const version = readVersion(cwd);
  const results = [];

  for (const step of RELEASE_STEPS) {
    printStepBanner(step, logger);
    let outcome;

    try {
      outcome = await runner(step, { cwd });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = {
        code: 1,
        signal: null,
        stdout: '',
        stderr: `${message}\n`,
        errorMessage: message,
      };
    }

    const result = buildStepResult(step, outcome);
    results.push(result);

    if (!result.passed) {
      const totalTests = totalObservedTests(results);
      const summary = renderMarkdownSummary({ version, results, totalTests });
      throw new ReleaseVerifyError(`Release verification failed at ${step.label}`, {
        step: result,
        results,
        summary,
      });
    }
  }

  const totalTests = totalObservedTests(results);
  return {
    version,
    results,
    totalTests,
    summary: renderMarkdownSummary({ version, results, totalTests }),
  };
}

/**
 * CLI entry point for `pnpm release:verify`.
 *
 * @returns {Promise<void>}
 */
async function main() {
  try {
    const report = await runReleaseVerify();
    process.stdout.write(`\n${report.summary}`);
  } catch (error) {
    if (error instanceof ReleaseVerifyError) {
      process.stderr.write(`\n${error.summary}`);
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
