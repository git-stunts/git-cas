import parseApplicationHandle from '../value-objects/ApplicationHandle.js';

const TARGETS = new WeakMap();

/** Records the direct Git target proven by an internal staged constructor. */
export function recordStagedTarget(staged) {
  const handle = parseApplicationHandle(staged.handle);
  TARGETS.set(staged, Object.freeze({
    handle,
    oid: handle.oid,
    type: handle.kind === 'page' ? 'blob' : 'tree',
  }));
  return staged;
}

/** Returns private construction evidence, never serialized public metadata. */
export function stagedTargetOf(staged) {
  return TARGETS.get(staged) ?? null;
}
