import { fork } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const WORKER = fileURLToPath(new URL('../fixtures/reservation-ledger-worker.js', import.meta.url));
const PROCESS_TIMEOUT_MS = 30_000;
const STDERR_LIMIT = 64 * 1024;

/** Forces independent processes to finish their first read before either CAS. */
export async function runReservationProcesses(repo, keys, options = {}) {
  const workers = keys.map((key, i) => launch({ repo, key,
    fault: options.fault ?? 'none', operation: options.operations?.[i] ?? 'reserve' }));
  try {
    const observed = await Promise.all(workers.map((worker) => worker.observed));
    for (const worker of workers) {
      worker.child.send({ event: 'publish' });
    }
    const results = await Promise.all(workers.map((worker) => worker.finished));
    return { observed, results };
  } finally {
    for (const worker of workers) {
      worker.stop();
    }
    await Promise.allSettled(workers.map((worker) => worker.finished));
  }
}

function launch({ repo, key, fault, operation }) {
  const child = fork(WORKER, [repo, key, fault, operation], { detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const stop = () => terminate(child);
  const timer = setTimeout(stop, PROCESS_TIMEOUT_MS);
  let observedResolve;
  let observedReject;
  const observed = new Promise((resolve, reject) => { observedResolve = resolve; observedReject = reject; });
  const finished = collect(child, { resolve: observedResolve, reject: observedReject }, stop)
    .finally(() => clearTimeout(timer));
  // A child can fail while the harness is still waiting at the first-read barrier.
  finished.catch(() => {});
  return { child, observed, finished, stop };
}

function collect(child, observed, stop) {
  return new Promise((resolve, reject) => {
    let result;
    let stderr = '';
    let failure;
    child.stderr.on('data', (bytes) => {
      stderr += bytes.toString();
      if (stderr.length > STDERR_LIMIT) {
        failure = new Error('Reservation worker exceeded stderr bound');
        stderr = stderr.slice(0, STDERR_LIMIT);
        stop();
      }
    });
    child.on('message', (message) => {
      if (message.event === 'observed') {
        observed.resolve(message.revision);
      } else if (message.event === 'result') {
        result = message;
      } else if (message.event === 'error') {
        failure = new Error(message.message);
      }
    });
    child.once('error', (error) => { failure = error; stop(); });
    child.once('close', (code) => {
      if (code !== 0 || !result || failure) {
        const error = failure ?? new Error(`Reservation worker exited ${code}: ${stderr}`);
        observed.reject(error);
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}
