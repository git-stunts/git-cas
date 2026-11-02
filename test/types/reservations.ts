import ContentAddressableStore, { ReservationCursor, type ReservationOutcome } from '../../index.d.ts';

export async function reservationConsumer(cas: ContentAddressableStore) {
  const opened = await cas.reservations.open({ namespace: 'test/observations', capacity: { unit: 'record-slot', limit: 100 } });
  if (opened.status !== 'opened') {
    return opened.status === 'refused' ? opened.reason : opened.cause.message;
  }
  const identity = { key: 'one', binding: 'a'.repeat(64) };
  const admitted: ReservationOutcome = await opened.reserve(identity);
  if (admitted.status === 'refused' || admitted.status === 'indeterminate') {
    return admitted.status;
  }
  await opened.prepare({ ...identity, evidence: { record: new Uint8Array([1]), supports: [], parents: [] } });
  const arm = await opened.arm(identity);
  if (arm.status !== 'armed') {
    return 'No fresh effect permission';
  }
  await opened.settle({ ...identity, evidence: { record: new Uint8Array([2]) } });
  const evidence = await opened.readEvidence({ ...identity, stage: 'preparation' });
  if (evidence.status === 'read') {
    const bytes: Uint8Array = evidence.evidence.record;
    void bytes;
  }
  const page = await opened.list({ nodeBudget: 129, limit: 1 });
  if (page.status === 'page' && page.next !== null) {
    const cursor = new ReservationCursor(page.next);
    await opened.list({ cursor });
  }
  // @ts-expect-error Byte quotas are not supported by record-slot admission.
  await cas.reservations.open({ namespace: 'invalid', capacity: { unit: 'byte', limit: 10 } });
  // @ts-expect-error Commit history belongs in parents, not blob/tree supports.
  await opened.prepare({ ...identity, evidence: { record: new Uint8Array(), supports: [{ type: 'commit', oid: 'a'.repeat(40) }] } });
  // @ts-expect-error Inspection cannot report a fresh arming acknowledgement.
  const fresh: 'armed' = (await opened.inspect(identity)).status;
  void fresh;
  // @ts-expect-error Reconciliation cannot grant another fresh arm permission.
  const rearms: 'armed' = (await opened.reconcile(identity)).status;
  void rearms;
  return 'checked';
}
