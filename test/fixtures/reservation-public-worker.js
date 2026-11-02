import ContentAddressableStore, { CasError, GitRefAdapter } from '../../index.js';
import { requireDockerExecution } from '../../scripts/testing/DockerExecutionBoundary.js';

requireDockerExecution();
if (!process.send) {
  throw new Error('Public reservation worker requires parent IPC');
}

const LEDGER = 'refs/cas/reservations/test/admission';
const IDENTITY_BINDING = 'a'.repeat(64);

function installReadBarrier() {
  const inspect = GitRefAdapter.prototype.inspectRef;
  let observed = false;
  GitRefAdapter.prototype.inspectRef = async function (ref) {
    const posture = await inspect.call(this, ref);
    if (!observed && ref === LEDGER) {
      observed = true;
      const released = new Promise((resolve) => process.once('message', resolve));
      process.send({ event: 'observed', revision: posture.oid });
      await released;
    }
    return posture;
  };
}

async function crash(boundary) {
  process.send({ event: 'crash-boundary', boundary });
  await new Promise(() => {});
}

function installWriteFault(fault) {
  const update = GitRefAdapter.prototype.updateRef;
  let fired = false;
  GitRefAdapter.prototype.updateRef = async function (options) {
    const applies = !fired && options.ref === LEDGER;
    if (applies && fault === 'crash-before') {
      await crash('before ledger CAS');
    }
    const result = await update.call(this, options);
    if (applies) {
      fired = true;
      if (fault === 'crash-after') {
        await crash('after ledger CAS');
      }
      if (fault === 'lost-ack') {
        throw new CasError('Injected lost public acknowledgement', 'GIT_ERROR');
      }
    }
    return result;
  };
}

async function run() {
  const [repo, key, fault, operation] = process.argv.slice(2);
  if (!['reserve', 'prepare', 'arm', 'cancel', 'settle'].includes(operation)) {
    throw new Error('Unsupported public reservation worker operation');
  }
  const cas = await ContentAddressableStore.open({ cwd: repo });
  try {
    const namespace = await cas.reservations.open({ namespace: 'test/admission', capacity: { unit: 'record-slot', limit: 1 } });
    if (namespace.status !== 'opened') {
      throw new Error(`Public namespace open failed: ${namespace.status}`);
    }
    installReadBarrier();
    installWriteFault(fault);
    const identity = { key, binding: IDENTITY_BINDING };
    const input = ['prepare', 'settle'].includes(operation)
      ? { ...identity, evidence: { record: new Uint8Array([7, 8, 9]) } } : identity;
    const result = await namespace[operation](input);
    process.send({ event: 'result', status: result.status, reason: result.reason,
      revision: result.revision, phase: result.record?.phase, key: result.record?.key ?? result.key });
  } finally {
    await cas.close();
  }
}

try {
  await run();
} catch (error) {
  process.send({ event: 'error', message: error.message });
  process.exitCode = 1;
} finally {
  process.disconnect();
}
