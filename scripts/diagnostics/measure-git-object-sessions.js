import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import ContentAddressableStore from '../../index.js';
import { createGitPlumbing } from '../../src/infrastructure/createGitPlumbing.js';
import { createCountingGitPlumbing } from './createCountingGitPlumbing.js';

const WORKER = '--worker';
const DEFAULT_ITEMS = 32;
const DEFAULT_PAGE_BYTES = 4 * 1024;
const DEFAULT_SAMPLES = 3;
const MAX_BATCH_BYTES = 32 * 1024 * 1024;
const MAX_BATCH_ITEMS = 256;
const MIN_PAGE_BYTES = 4;
const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[2] === WORKER) {
  await emitWorkerResult(JSON.parse(process.argv[3]));
} else {
  await runController();
}

async function runController() {
  const items = positiveSafeInteger(process.argv[2] ?? DEFAULT_ITEMS, 'items');
  const pageBytes = positiveSafeInteger(process.argv[3] ?? DEFAULT_PAGE_BYTES, 'pageBytes');
  const samples = positiveSafeInteger(process.argv[4] ?? DEFAULT_SAMPLES, 'samples');
  assertMeasurementBounds(items, pageBytes);
  const root = mkdtempSync(path.join(os.tmpdir(), 'cas-object-session-measure-'));
  try {
    const readRepo = path.join(root, 'read.git');
    initBare(readRepo);
    const handles = await buildReadFixture(readRepo, items, pageBytes);
    const reads = await compareModes({
      left: { kind: 'read', mode: 'fallback', repo: readRepo, handles },
      right: { kind: 'read', mode: 'session', repo: readRepo, handles },
      samples,
    });
    const writes = await compareModes({
      left: { kind: 'write', mode: 'individual', items, pageBytes },
      right: { kind: 'write', mode: 'batch', items, pageBytes },
      samples,
    });
    assert.equal(reads.left.semanticDigest, reads.right.semanticDigest);
    assert.equal(writes.left.semanticDigest, writes.right.semanticDigest);
    process.stdout.write(
      `${JSON.stringify(buildReport({ items, pageBytes, samples, reads, writes }), null, 2)}\n`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function compareModes({ left, right, samples }) {
  const leftSamples = [];
  const rightSamples = [];
  for (let index = 0; index < samples; index += 1) {
    const order = index % 2 === 0 ? [left, right] : [right, left];
    for (const options of order) {
      const result = await runWorkerProcess(options);
      (options === left ? leftSamples : rightSamples).push(result);
    }
  }
  return { left: summarize(leftSamples), right: summarize(rightSamples) };
}

function buildReport({ items, pageBytes, samples, reads, writes }) {
  return {
    schema: 'git-cas.git-object-session-measurement/v1',
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(),
      platform: process.platform,
      architecture: process.arch,
    },
    metricScope: {
      wallMs: 'worker elapsed time including awaited Git subprocesses',
      workerCpuMs: 'Node worker CPU only; excludes Git subprocess CPU',
      workerPeakRssBytes: 'Node worker peak RSS only; excludes Git subprocess RSS',
    },
    parameters: { items, pageBytes, samples },
    selectedBundleRead: comparison({
      left: reads.left,
      right: reads.right,
      leftName: 'fallback',
      rightName: 'session',
    }),
    pageWrite: comparison({
      left: writes.left,
      right: writes.right,
      leftName: 'individual',
      rightName: 'batch',
    }),
  };
}

function comparison({ left, right, leftName, rightName }) {
  return {
    [leftName]: left,
    [rightName]: right,
    semanticDigestEqual: left.semanticDigest === right.semanticDigest,
    processReductionPercent: percentageReduction(left.processCount, right.processCount),
    wallReductionPercent: percentageReduction(left.wallMs, right.wallMs),
    workerCpuReductionPercent: percentageReduction(left.workerCpuMs, right.workerCpuMs),
  };
}

async function buildReadFixture(repo, items, pageBytes) {
  const cas = new ContentAddressableStore({ plumbing: await createGitPlumbing({ cwd: repo }) });
  try {
    const handles = [];
    for (let index = 0; index < items; index += 1) {
      const page = await cas.pages.put({ source: pageSource(index, pageBytes) });
      const nested = await cas.bundles.put({ members: { page: page.handle } });
      const outer = await cas.bundles.put({ members: { nested: nested.handle } });
      handles.push(outer.handle.toString());
    }
    return handles;
  } finally {
    await cas.close();
  }
}

async function emitWorkerResult(options) {
  try {
    const result =
      options.kind === 'read' ? await measureReads(options) : await measureWrites(options);
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({ ok: false, error: error?.stack ?? String(error) });
    process.exitCode = 1;
  } finally {
    process.disconnect?.();
  }
}

async function measureReads({ mode, repo, handles }) {
  const counted = await createCountingGitPlumbing({
    cwd: repo,
    sessions: mode === 'session',
  });
  const cas = new ContentAddressableStore({ plumbing: counted.plumbing });
  const values = [];
  const metrics = await timed(async () => {
    try {
      for (const handle of handles) {
        const reference = await cas.bundles.getMemberReference({ handle, path: 'nested' });
        values.push(`${reference.path}\0${reference.type}\0${reference.handle.toString()}`);
      }
    } finally {
      await cas.close();
    }
  });
  return resultEnvelope(values, Object.fromEntries(counted.snapshot()), metrics);
}

async function measureWrites({ mode, items, pageBytes }) {
  const repo = mkdtempSync(path.join(os.tmpdir(), `cas-${mode}-write-`));
  try {
    initBare(repo);
    const counted = await createCountingGitPlumbing({ cwd: repo, sessions: true });
    const cas = new ContentAddressableStore({ plumbing: counted.plumbing });
    const sources = Array.from({ length: items }, (_, index) => pageSource(index, pageBytes));
    let pages;
    const metrics = await timed(async () => {
      try {
        pages =
          mode === 'batch'
            ? await cas.pages.putBatch({ pages: sources.map((source) => ({ source })) })
            : await putIndividually(cas, sources);
      } finally {
        await cas.close();
      }
    });
    return resultEnvelope(
      pages.map((page) => page.handle.toString()),
      Object.fromEntries(counted.snapshot()),
      metrics
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

async function putIndividually(cas, sources) {
  const pages = [];
  for (const source of sources) {
    pages.push(await cas.pages.put({ source }));
  }
  return pages;
}

async function timed(operation) {
  const startedAt = performance.now();
  const startedCpu = process.cpuUsage();
  await operation();
  const cpu = process.cpuUsage(startedCpu);
  return {
    wallMs: performance.now() - startedAt,
    workerUserCpuMs: cpu.user / 1000,
    workerSystemCpuMs: cpu.system / 1000,
    workerPeakRssBytes: process.resourceUsage().maxRSS * 1024,
  };
}

function resultEnvelope(values, counts, metrics) {
  return {
    semanticDigest: digest(values),
    resultCount: values.length,
    processCount: Object.values(counts).reduce((sum, value) => sum + value, 0),
    counts,
    ...metrics,
  };
}

function summarize(samples) {
  assert(samples.length > 0);
  for (const sample of samples.slice(1)) {
    assert.equal(sample.semanticDigest, samples[0].semanticDigest);
    assert.deepEqual(sample.counts, samples[0].counts);
  }
  return {
    sampleCount: samples.length,
    semanticDigest: samples[0].semanticDigest,
    resultCount: samples[0].resultCount,
    processCount: samples[0].processCount,
    counts: samples[0].counts,
    wallMs: roundedMedian(samples.map((sample) => sample.wallMs)),
    workerCpuMs: roundedMedian(
      samples.map((sample) => sample.workerUserCpuMs + sample.workerSystemCpuMs)
    ),
    workerUserCpuMs: roundedMedian(samples.map((sample) => sample.workerUserCpuMs)),
    workerSystemCpuMs: roundedMedian(samples.map((sample) => sample.workerSystemCpuMs)),
    workerPeakRssBytes: Math.round(median(samples.map((sample) => sample.workerPeakRssBytes))),
  };
}

function runWorkerProcess(options) {
  return new Promise((resolve, reject) => {
    const child = fork(scriptPath, [WORKER, JSON.stringify(options)], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    let response;
    child.once('message', (message) => {
      response = message;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 && response?.ok) {
        resolve(response.result);
      } else {
        reject(new Error(response?.error ?? `measurement worker exited with code ${code}`));
      }
    });
  });
}

function pageSource(index, bytes) {
  const source = Buffer.alloc(bytes, index % 251);
  source.writeUInt32BE(index, 0);
  return source;
}

function initBare(repo) {
  execFileSync('git', ['init', '--bare', repo], { stdio: 'ignore' });
}

function digest(values) {
  const hash = createHash('sha256');
  for (const value of values) {
    hash.update(value);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function percentageReduction(before, after) {
  return Math.round(((before - after) / before) * 1000) / 10;
}

function roundedMedian(values) {
  return Math.round(median(values) * 1000) / 1000;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function positiveSafeInteger(raw, label) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function assertMeasurementBounds(items, pageBytes) {
  if (items > MAX_BATCH_ITEMS) {
    throw new RangeError(`items must not exceed ${MAX_BATCH_ITEMS}`);
  }
  if (pageBytes < MIN_PAGE_BYTES) {
    throw new RangeError(`pageBytes must be at least ${MIN_PAGE_BYTES}`);
  }
  if (pageBytes > Math.floor(MAX_BATCH_BYTES / items)) {
    throw new RangeError(`items * pageBytes must not exceed ${MAX_BATCH_BYTES}`);
  }
}
