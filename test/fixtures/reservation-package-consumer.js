import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

if (process.env.GIT_STUNTS_DOCKER !== '1' || !process.argv[2]) {
  throw new Error('Run in Docker with the explicitly installed package entry path');
}
const { default: CAS, ReservationNamespace } = await import(pathToFileURL(process.argv[2]).href);
for (const format of ['sha1', 'sha256']) {
  const repo = mkdtempSync(join(tmpdir(), 'cas-reservation-package-'));
  let cas;
  try {
    const init = spawnSync('git', ['init', '--bare', `--object-format=${format}`, repo], { timeout: 20_000 });
    assert.equal(init.status, 0);
    cas = await CAS.open({ cwd: repo });
    const options = { namespace: 'consumer/observations', capacity: { unit: 'record-slot', limit: 1 } };
    const set = await cas.reservations.open(options);
    assert.ok(set instanceof ReservationNamespace);
    const identity = { key: 'one', binding: 'a'.repeat(64) };
    assert.equal((await set.reserve(identity)).status, 'admitted');
    assert.equal((await set.prepare({ ...identity, evidence: { record: new Uint8Array([1]) } })).status, 'prepared');
    assert.equal((await set.arm(identity)).status, 'armed');
    assert.equal((await set.reconcile(identity)).status, 'recovered');
    assert.equal((await set.arm(identity)).reason, 'already-armed');
    assert.equal((await set.settle({ ...identity, evidence: { record: new Uint8Array([2]) } })).status, 'settled');
    await cas.close();
    const gc = spawnSync('git', ['gc', '--prune=now'], { cwd: repo, timeout: 20_000 });
    assert.equal(gc.status, 0);
    cas = await CAS.open({ cwd: repo });
    const reopened = await cas.reservations.open(options);
    assert.deepEqual((await reopened.readEvidence({ ...identity, stage: 'preparation' })).evidence.record, new Uint8Array([1]));
    assert.deepEqual((await reopened.readEvidence({ ...identity, stage: 'settlement' })).evidence.record, new Uint8Array([2]));
    assert.equal((await reopened.reserve({ key: 'two', binding: identity.binding })).reason, 'capacity-full');
    assert.equal((await reopened.list()).charged, 1);
  } finally {
    await cas?.close();
    rmSync(repo, { recursive: true, force: true });
  }
}
