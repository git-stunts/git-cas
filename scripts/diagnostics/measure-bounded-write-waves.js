import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ContentAddressableStore, { MAX_WORKSPACE_COMPOUND_OPERATIONS } from '../../index.js';
import { instrumentGitPlumbing } from './createCountingGitPlumbing.js';

const WORKER = '--worker';
const DEFAULT_ITEMS = 16;
const DEFAULT_SAMPLES = 3;
const DEFAULT_ASSET_CONCURRENCY = 4;
const ASSET_BYTES = 2 * 1024;
const ASSET_CHUNK_BYTES = 1024;
const BUNDLE_MEMBERS = 3;
const COMPOUND_PAGES_PER_GROUP = 4;
const CLOCK = Object.freeze({ now: () => new Date('2026-08-23T12:00:00.000Z') });
const scriptPath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);

if (invokedPath === scriptPath && process.argv[2] === WORKER) {
  await emitWorkerResult(JSON.parse(process.argv[3]));
} else if (invokedPath === scriptPath) {
  await runController();
}

async function runController() {
  const items = positiveSafeInteger(process.argv[2] ?? DEFAULT_ITEMS, 'items');
  const samples = positiveSafeInteger(process.argv[3] ?? DEFAULT_SAMPLES, 'samples');
  const assetConcurrency = positiveSafeInteger(
    process.argv[4] ?? DEFAULT_ASSET_CONCURRENCY,
    'asset concurrency',
  );
  const plumbingRepo = process.env.GIT_CAS_PLUMBING_REPO
    ? path.resolve(process.env.GIT_CAS_PLUMBING_REPO)
    : null;
  const objectFormats = {};
  for (const objectFormat of ['sha1', 'sha256']) {
    objectFormats[objectFormat] = await measureObjectFormat({
      objectFormat,
      items,
      samples,
      assetConcurrency,
      plumbingRepo,
    });
  }
  emitReport(report({ items, samples, assetConcurrency, plumbingRepo, objectFormats }));
}

async function measureObjectFormat(options) {
  const common = {
    objectFormat: options.objectFormat,
    items: options.items,
    assetConcurrency: options.assetConcurrency,
    plumbingRepo: options.plumbingRepo,
  };
  const assetWrite = await compareModes({
    left: { ...common, kind: 'assets', mode: 'individual' },
    right: { ...common, kind: 'assets', mode: 'batch' },
    samples: options.samples,
  });
  const workspaceBundleWrite = await compareModes({
    left: { ...common, kind: 'workspace-bundles', mode: 'individual' },
    right: { ...common, kind: 'workspace-bundles', mode: 'batch' },
    samples: options.samples,
  });
  const compoundWorkspaceAdmission = await compareModes({
    left: { ...common, kind: 'workspace-compound', mode: 'per-wave' },
    right: { ...common, kind: 'workspace-compound', mode: 'compound' },
    samples: options.samples,
  });
  return {
    assetWrite: comparison(assetWrite),
    workspaceBundleWrite: comparison(workspaceBundleWrite),
    compoundWorkspaceAdmission: compoundComparison(compoundWorkspaceAdmission),
  };
}

async function compareModes({ left, right, samples }) {
  const results = { left: [], right: [] };
  for (let index = 0; index < samples; index += 1) {
    const order = index % 2 === 0
      ? [['left', left], ['right', right]]
      : [['right', right], ['left', left]];
    for (const [side, options] of order) {
      results[side].push(await runWorker(options));
    }
  }
  return { left: summarize(results.left), right: summarize(results.right) };
}

export function comparison({ left, right }) {
  return {
    individual: left,
    batch: right,
    ...comparisonMetrics(left, right),
  };
}

export function compoundComparison({ left, right }) {
  return {
    perWave: left,
    compound: right,
    ...comparisonMetrics(left, right),
  };
}

export function compoundOperationCount(items) {
  const operationCount = items * 2 + 1;
  if (operationCount > MAX_WORKSPACE_COMPOUND_OPERATIONS) {
    throw new Error('compound benchmark groups exceed the workspace operation ceiling');
  }
  return operationCount;
}

function comparisonMetrics(left, right) {
  assert.equal(
    left.semanticDigest,
    right.semanticDigest,
    'Benchmark semantic digests differ between compared modes',
  );
  return {
    semanticDigestEqual: true,
    processReductionPercent: reduction(left.processCount, right.processCount),
    gitInteractionReductionPercent: reduction(
      left.gitInteractionCount,
      right.gitInteractionCount,
    ),
    wallReductionPercent: reduction(left.wallMs, right.wallMs),
    workerCpuReductionPercent: reduction(left.workerCpuMs, right.workerCpuMs),
  };
}

async function emitWorkerResult(options) {
  try {
    process.send?.({ ok: true, result: await measureWorker(options) });
  } catch (error) {
    process.send?.({ ok: false, error: error instanceof Error ? error.stack : String(error) });
    process.exitCode = 1;
  } finally {
    process.disconnect?.();
  }
}

async function measureWorker(options) {
  const repo = mkdtempSync(path.join(os.tmpdir(), `cas-write-waves-${options.mode}-`));
  try {
    initBare(repo, options.objectFormat);
    const raw = await createPlumbing({ cwd: repo, plumbingRepo: options.plumbingRepo });
    const counted = instrumentGitPlumbing({ plumbing: raw, sessions: true });
    const cas = new ContentAddressableStore({
      plumbing: counted.plumbing,
      chunkSize: ASSET_CHUNK_BYTES,
      concurrency: 1,
      clock: CLOCK,
    });
    let values;
    const metrics = await timed(async () => {
      try {
        values = await writeValues(cas, options);
      } finally {
        await cas.close();
      }
    });
    assert.equal(counted.activeSessions().size, 0);
    return envelope({ values, counted, metrics });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

async function writeValues(cas, options) {
  if (options.kind === 'assets') {
    return await writeAssets(cas, options);
  }
  if (options.kind === 'workspace-bundles') {
    return await writeWorkspaceBundles(cas, options);
  }
  return await writeCompoundWorkspaceGraph(cas, options);
}

async function writeAssets(cas, { items, mode, assetConcurrency }) {
  const requests = Array.from({ length: items }, assetRequest);
  const staged = mode === 'batch'
    ? await cas.assets.putBatch({ assets: requests, maxBatchAssets: assetConcurrency })
    : await writeIndividually(requests, (request) => cas.assets.put(request));
  return staged.map((asset) => asset.handle.toString());
}

async function writeWorkspaceBundles(cas, { items, mode }) {
  const workspace = await cas.workspaces.open({
    namespace: 'git-warp/materializations',
    ttlMs: 60_000,
  });
  const requests = Array.from({ length: items }, bundleRequest);
  const staged = mode === 'batch'
    ? await workspace.bundles.putOrderedBatch({ bundles: requests })
    : await writeIndividually(requests, (request) => workspace.bundles.putOrdered(request));
  return staged.map((bundle) => bundle.handle.toString());
}

async function writeCompoundWorkspaceGraph(cas, { items, mode }) {
  const operationCount = compoundOperationCount(items);
  const workspace = await cas.workspaces.open({
    namespace: 'git-warp/compound-materializations',
    ttlMs: 60_000,
  });
  if (mode === 'compound') {
    const admitted = await workspace.batch({
      maxOperations: operationCount,
      operation: async (scope) => await stageCompoundGraph(scope, items),
    });
    return admitted.value.map(handleToken);
  }
  return (await stageCompoundGraph(workspace, items)).map(handleToken);
}

async function stageCompoundGraph(scope, groupCount) {
  const retained = [];
  const leaves = [];
  for (let group = 0; group < groupCount; group += 1) {
    const pages = handlesOf(await scope.pages.putBatch({
      pages: Array.from({ length: COMPOUND_PAGES_PER_GROUP }, (_, index) => ({
        source: payload(group * COMPOUND_PAGES_PER_GROUP + index, 64),
      })),
    }));
    retained.push(...pages);
    const [leaf] = handlesOf(await scope.bundles.putOrderedBatch({
      bundles: [{ members: pages.map((page, index) => [paddedPath('page', index), page]) }],
    }));
    leaves.push(leaf);
    retained.push(leaf);
  }
  const [root] = handlesOf(await scope.bundles.putOrderedBatch({
    bundles: [{ members: leaves.map((leaf, index) => [paddedPath('leaf', index), leaf]) }],
  }));
  return [...retained, root];
}

function handlesOf(staged) {
  return staged.map((value) => value.handle ?? value);
}

function handleToken(handle) {
  return handle.toString();
}

function paddedPath(prefix, index) {
  return `${prefix}/${String(index).padStart(4, '0')}`;
}

async function writeIndividually(requests, write) {
  const staged = [];
  for (const request of requests) {
    staged.push(await write(request));
  }
  return staged;
}

function assetRequest(_, index) {
  return {
    source: byteSource(payload(index, ASSET_BYTES)),
    slug: `asset-${String(index).padStart(4, '0')}`,
    filename: `asset-${String(index).padStart(4, '0')}.bin`,
  };
}

function bundleRequest(_, bundleIndex) {
  return {
    members: Array.from({ length: BUNDLE_MEMBERS }, (__, memberIndex) => [
      `member-${String(memberIndex).padStart(2, '0')}`,
      payload(bundleIndex * BUNDLE_MEMBERS + memberIndex, 64),
    ]),
  };
}

async function* byteSource(bytes) {
  yield bytes;
}

function payload(index, length) {
  return Buffer.from(Array.from({ length }, (_, offset) => (index * 31 + offset) % 256));
}

async function createPlumbing({ cwd, plumbingRepo }) {
  const module = plumbingRepo === null
    ? await import('@git-stunts/plumbing')
    : await import(pathToFileURL(path.join(plumbingRepo, 'index.js')).href);
  return await module.default.createDefault({ cwd, env: 'node' });
}

function initBare(repo, objectFormat) {
  execFileSync('git', ['init', '--quiet', '--bare', `--object-format=${objectFormat}`, repo]);
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

function envelope({ values, counted, metrics }) {
  const counts = Object.fromEntries(counted.snapshot());
  const protocolOperations = Object.fromEntries(counted.sessionOperations());
  return {
    semanticDigest: digest(values),
    resultCount: values.length,
    processCount: total(counts),
    protocolOperationCount: total(protocolOperations),
    gitInteractionCount: directOperationCount(counts) + total(protocolOperations),
    counts,
    protocolOperations,
    ...metrics,
  };
}

function summarize(samples) {
  assert(samples.length > 0);
  for (const sample of samples.slice(1)) {
    assert.equal(sample.semanticDigest, samples[0].semanticDigest);
    assert.deepEqual(sample.counts, samples[0].counts);
    assert.deepEqual(sample.protocolOperations, samples[0].protocolOperations);
  }
  return {
    sampleCount: samples.length,
    semanticDigest: samples[0].semanticDigest,
    resultCount: samples[0].resultCount,
    processCount: samples[0].processCount,
    protocolOperationCount: samples[0].protocolOperationCount,
    gitInteractionCount: samples[0].gitInteractionCount,
    counts: samples[0].counts,
    protocolOperations: samples[0].protocolOperations,
    wallMs: roundedMedian(samples.map((sample) => sample.wallMs)),
    workerCpuMs: roundedMedian(samples.map(workerCpuMs)),
    workerUserCpuMs: roundedMedian(samples.map((sample) => sample.workerUserCpuMs)),
    workerSystemCpuMs: roundedMedian(samples.map((sample) => sample.workerSystemCpuMs)),
    workerPeakRssBytes: Math.round(median(samples.map((sample) => sample.workerPeakRssBytes))),
  };
}

function report({ items, samples, assetConcurrency, plumbingRepo, objectFormats }) {
  return {
    schema: 'git-cas.bounded-write-waves/v2',
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(),
      platform: process.platform,
      architecture: process.arch,
      gitCasCommit: gitCommit(process.cwd()),
      gitCasDirty: gitDirty(process.cwd(), process.env.GIT_CAS_BENCHMARK_OUTPUT),
      plumbingSource: plumbingRepo === null
        ? 'installed:@git-stunts/plumbing'
        : 'workspace:@git-stunts/plumbing',
      plumbingCommit: plumbingRepo === null ? null : gitCommit(plumbingRepo),
      plumbingDirty: plumbingRepo === null ? null : gitDirty(plumbingRepo),
    },
    metricScope: {
      processCount: 'Git child processes opened by the instrumented git-cas operation',
      protocolOperationCount: 'typed operations invoked on persistent Git sessions',
      gitInteractionCount: 'one-shot Git commands plus typed persistent-session calls',
      wallMs: 'isolated worker elapsed time including Git children and session close',
      workerCpuMs: 'Node worker CPU only; excludes Git subprocess CPU',
      workerPeakRssBytes: 'Node worker peak RSS only; excludes Git subprocess RSS',
    },
    parameters: {
      items,
      samples,
      assetConcurrency,
      assetBytes: ASSET_BYTES,
      assetChunkBytes: ASSET_CHUNK_BYTES,
      bundleMembers: BUNDLE_MEMBERS,
      compoundPagesPerGroup: COMPOUND_PAGES_PER_GROUP,
    },
    objectFormats,
  };
}

function emitReport(value) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.GIT_CAS_BENCHMARK_OUTPUT) {
    writeFileSync(path.resolve(process.env.GIT_CAS_BENCHMARK_OUTPUT), json);
    return;
  }
  process.stdout.write(json);
}

function runWorker(options) {
  return new Promise((resolve, reject) => {
    const child = fork(scriptPath, [WORKER, JSON.stringify(options)], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    let response;
    child.once('message', (message) => { response = message; });
    child.once('error', reject);
    child.once('exit', (code) => settleWorker({ code, response, resolve, reject }));
  });
}

function settleWorker({ code, response, resolve, reject }) {
  if (code === 0 && response?.ok) {
    resolve(response.result);
    return;
  }
  reject(new Error(response?.error ?? `measurement worker exited with code ${code}`));
}

function gitCommit(cwd) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

function gitDirty(cwd, ignoredPath = undefined) {
  const ignored = ignoredPath === undefined
    ? null
    : path.relative(cwd, path.resolve(ignoredPath));
  const records = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '-z'],
    {
    cwd,
    encoding: 'utf8',
    },
  ).split('\0').filter(Boolean);
  return records.some((record) => !(record.startsWith('?? ') && record.slice(3) === ignored));
}

function digest(values) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function workerCpuMs(sample) {
  return sample.workerUserCpuMs + sample.workerSystemCpuMs;
}

function total(counts) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function directOperationCount(counts) {
  return Object.entries(counts)
    .filter(([operation]) => !operation.startsWith('session:'))
    .reduce((sum, [, value]) => sum + value, 0);
}

function reduction(before, after) {
  return before === 0 ? null : rounded(((before - after) / before) * 100);
}

function roundedMedian(values) {
  return rounded(median(values));
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function positiveSafeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return parsed;
}
