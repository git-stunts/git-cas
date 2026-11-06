import { afterEach, describe, expect, it, vi } from 'vitest';
import NativeReservationHarness from '../helpers/NativeReservationHarness.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error('Reservation index cost witness must run in Docker');
}
vi.setConfig({ testTimeout: 300_000, hookTimeout: 30_000 });
const harness = new NativeReservationHarness();
const binding = 'c'.repeat(64);
const PRIOR_RECORDS = 400;
afterEach(async () => { await harness.destroy(); });

function looseObjects(repo) {
  const counts = harness.git(repo, ['count-objects', '-v']);
  return Number(/^count: (\d+)$/mu.exec(counts)[1]);
}

async function measured(repo, operation) {
  const before = looseObjects(repo);
  await operation();
  return looseObjects(repo) - before;
}

describe.each(['sha1', 'sha256'])('native %s reservation ledger cost', (format) => {
  it(`writes a bounded number of objects per update after ${PRIOR_RECORDS} records`, async () => {
    const repo = harness.repository(format);
    const { namespace } = await harness.openPublic(repo, PRIOR_RECORDS + 2);
    for (let n = 0; n < PRIOR_RECORDS; n++) {
      await namespace.reserve({ key: `prior-${n}`, binding });
    }
    const identity = { key: 'measured', binding };
    const reserve = await measured(repo, () => namespace.reserve(identity));
    const cancel = await measured(repo, () => namespace.cancel(identity));
    // 7.1.0 wrote 68 objects here (64 route trees). Compressed: one record blob,
    // about log16(401) trees, plus the ledger tree and commit; 7 measured.
    expect(reserve).toBeLessThanOrEqual(12);
    expect(cancel).toBeLessThanOrEqual(12);
  });
});
