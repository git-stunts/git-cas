import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDockerExecution } from '../testing/DockerExecutionBoundary.js';
import {
  RESERVATION_MEASUREMENTS, seedReservationMeasurement, measureReservationOperation,
} from './ReservationMeasurementScenario.js';

requireDockerExecution();
const script = fileURLToPath(import.meta.url);
const STDERR_BYTES = 64 * 1024;
const TRACE_BYTES = 4 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 180_000;
const GIT_COMMANDS = new Set([
  '--version', 'version', 'rev-parse', 'rev-list', 'symbolic-ref', 'show-ref',
  'for-each-ref', 'cat-file', 'hash-object', 'mktree', 'commit-tree', 'update-ref', 'fast-import',
]);

if (process.argv[2] === '--worker') {
  await worker(JSON.parse(process.argv[3]));
} else {
  await controller();
}

async function worker(options) {
  try {
    const result = options.operation === 'seed'
      ? await seedReservationMeasurement(options) : await measureReservationOperation(options);
    process.send({ result });
  } catch (error) {
    process.send({ error: error.stack });
    process.exitCode = 1;
  } finally {
    process.disconnect();
  }
}

async function controller() {
  const sizes = process.argv[2] === '--pilot' ? [1] : [1, 17, 129];
  assert(process.argv.length === 2 || process.argv[2] === '--pilot');
  const scenarios = [];
  for (const format of ['sha1', 'sha256']) {
    for (const records of sizes) {
      scenarios.push(await scenario({ format, records }));
    }
  }
  process.stdout.write(`${JSON.stringify({
    schema: 'git-cas.reservation-native-measurement/v1',
    environment: { node: process.version, git: git(['--version']), platform: process.platform, architecture: process.arch },
    scope: {
      sampling: 'One fresh Node process per operation; one sample per size and object format.',
      nativeGitStarts: 'Git TRACE2 start events including facade initialization, namespace open, operation and close; excludes seeding and GC.',
      operationProcessOpenCalls: 'Existing Plumbing wrapper calls after namespace open; not object count and not an assertion about retries.',
      operationSessionRequests: 'Existing Plumbing session method calls after namespace open; a batch method can represent several objects.',
      workerPeakRssBytes: 'Kernel process-lifetime high-water RSS for the fresh Node worker, including imports/open/operation/close; excludes Git child RSS, parent and fixture builder.',
      wallMs: 'Operation only, after namespace open; one sample is not a latency distribution.',
      limits: 'Finite fixture, no contention or retries injected, 4096-byte pages; neither an asymptotic proof nor a physical disk quota.',
    }, scenarios,
  }, null, 2)}\n`);
}

async function scenario({ format, records }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cas-reservation-measure-'));
  const repo = path.join(root, 'store.git');
  const measurements = [];
  try {
    git(['init', '--bare', `--object-format=${format}`, repo]);
    assert.equal((await runWorker({ repo, records, operation: 'seed' })).seeded, records);
    prune(repo);
    for (const operation of RESERVATION_MEASUREMENTS) {
      if (operation === 'read-final-after-gc') {
        prune(repo);
      }
      const trace = path.join(root, 'git-trace.jsonl');
      const result = await runWorker({ repo, records, operation }, trace);
      const native = readTrace(trace);
      assert(native.starts > 0, 'Native Git tracing did not observe the measurement');
      assert.equal(native.starts, Object.values(result.totalProcessOpenCalls).reduce((sum, count) => sum + count, 0));
      assert(native.starts <= 40, 'Finite operation exceeded native-process acceptance ceiling');
      assert((result.operationSessionRequests['cat-file:read'] ?? 0) <= 132, 'Operation exceeded bounded read-request ceiling');
      assert((result.operationSessionRequests['mktree:write'] ?? 0) <= 67, 'Operation exceeded bounded tree-write ceiling');
      assert(result.workerPeakRssBytes < 512 * 1024 * 1024, 'Fresh worker exceeded finite RSS acceptance ceiling');
      if (operation === 'filtered-list') {
        assert.equal(result.hasContinuation, records > 1);
      }
      measurements.push({ ...result, nativeGitStarts: native.starts, nativeGitCommands: native.commands });
      rmSync(trace);
    }
    return { format, settledRecordsBeforeMeasurement: records, capacity: records + 1,
      storeKiBAfterMeasurement: Number(execFileSync('du', ['-sk', repo], { encoding: 'utf8' }).split(/\s/u)[0]),
      measurements };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readTrace(trace) {
  assert(statSync(trace).size <= TRACE_BYTES, 'TRACE2 output exceeded its declared bound');
  const events = readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const commands = {};
  for (const event of events) {
    if (event.event === 'start') {
      const command = event.argv.slice(1).find((argument) => GIT_COMMANDS.has(argument));
      assert(command, 'Unrecognized native Git command; inspect trace before broadening measurement');
      commands[command] = (commands[command] ?? 0) + 1;
    }
  }
  return { starts: Object.values(commands).reduce((sum, value) => sum + value, 0), commands };
}

function prune(repo) {
  git(['--git-dir', repo, 'reflog', 'expire', '--expire=now', '--all']);
  git(['--git-dir', repo, 'gc', '--prune=now']);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: 20_000, maxBuffer: STDERR_BYTES, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function runWorker(options, trace) {
  const env = { ...process.env };
  delete env.GIT_TRACE2_EVENT;
  if (trace) {
    // Plumbing intentionally filters ambient trace variables. Use its supported
    // inherited configuration-discovery path, isolated to this disposable worker.
    const config = `${trace}.config`;
    git(['config', '--file', config, 'trace2.eventTarget', trace]);
    env.GIT_CONFIG_GLOBAL = config;
  }
  const child = fork(script, ['--worker', JSON.stringify(options)], {
    env, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const stop = () => {
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') { throw error; }
      }
    }
  };
  const timer = setTimeout(stop, WORKER_TIMEOUT_MS);
  try {
    return await collect(child, stop);
  } finally {
    clearTimeout(timer);
    stop();
  }
}

function collect(child, stop) {
  return new Promise((resolve, reject) => {
    let message;
    let stderr = '';
    let failure;
    child.once('error', (error) => { failure = error; stop(); });
    child.on('message', (value) => { message = value; });
    child.stderr.on('data', (bytes) => {
      stderr += bytes.toString();
      if (stderr.length > STDERR_BYTES) {
        failure = new Error('Measurement worker stderr exceeded bound');
        stderr = stderr.slice(0, STDERR_BYTES);
        stop();
      }
    });
    child.once('close', (code) => {
      if (failure || code !== 0 || !message?.result) {
        reject(failure ?? new Error(message?.error ?? `Measurement worker exited ${code}: ${stderr}`));
      } else {
        resolve(message.result);
      }
    });
  });
}
