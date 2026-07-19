/**
 * Real-Git coherence proof for typed object sessions across CAS writes.
 *
 * MUST run inside Docker (GIT_STUNTS_DOCKER=1). Refuses to run on the host.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createCountingGitPlumbing } from '../../scripts/diagnostics/createCountingGitPlumbing.js';
import GitPersistenceAdapter from '../../src/infrastructure/adapters/GitPersistenceAdapter.js';

if (process.env.GIT_STUNTS_DOCKER !== '1') {
  throw new Error(
    'Integration tests MUST run inside Docker (GIT_STUNTS_DOCKER=1). ' +
      'Use: npm run test:integration:node'
  );
}

vi.setConfig({ testTimeout: 30_000 });

describe.each(['sha1', 'sha256'])('real-Git %s object session coherence', (objectFormat) => {
  it('preserves coherent sessions and retires mktree after a packed bulk write', async () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), `cas-session-coherence-${objectFormat}-`));
    initializeRepository(repo, objectFormat);
    const counted = await createCountingGitPlumbing({ cwd: repo, sessions: true });
    const adapter = new GitPersistenceAdapter({ plumbing: counted.plumbing });

    try {
      const initialPacked = await adapter.writeBlobs(batch('initial', 128));
      const initialOid = requireLast(initialPacked, 'Initial packed fixture');
      await expect(adapter.readObjectType(initialOid)).resolves.toBe('blob');
      const initialTree = await adapter.writeTree([treeEntry(initialOid, 'initial')]);
      await expect(adapter.readObjectType(initialTree)).resolves.toBe('tree');

      const looseOid = await adapter.writeBlob(Buffer.from('later loose object'));
      await expect(adapter.readObjectType(looseOid)).resolves.toBe('blob');
      const looseTree = await adapter.writeTree([treeEntry(looseOid, 'loose')]);
      await expect(adapter.readObjectType(looseTree)).resolves.toBe('tree');

      const beforePackedWrite = counted.snapshot();
      expect(count(beforePackedWrite, 'session:cat-file')).toBe(1);
      expect(count(beforePackedWrite, 'session:mktree')).toBe(1);

      const laterPacked = await adapter.writeBlobs(batch('later', 128));
      const laterOid = requireLast(laterPacked, 'Later packed fixture');
      await expect(adapter.readObjectType(laterOid)).resolves.toBe('blob');
      const laterTree = await adapter.writeTree([treeEntry(laterOid, 'later')]);
      await expect(adapter.readObjectType(laterTree)).resolves.toBe('tree');

      const afterPackedWrite = counted.snapshot();
      expect(count(afterPackedWrite, 'session:cat-file')).toBe(1);
      expect(count(afterPackedWrite, 'session:mktree')).toBe(2);
      expect(count(afterPackedWrite, 'session:fast-import')).toBe(2);
      expect(git(repo, ['count-objects', '-v'])).toMatch(/packs: 2/u);
    } finally {
      await adapter.close();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

function initializeRepository(repo, objectFormat) {
  git(repo, ['init', '--bare', `--object-format=${objectFormat}`]);
  git(repo, ['config', 'fastimport.unpackLimit', '100']);
}

function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'git failed').trim());
  }
  return result.stdout.trim();
}

function batch(prefix, pageCount) {
  return Array.from({ length: pageCount }, (_, index) => Buffer.from(`${prefix}-${index}`));
}

function requireLast(oids, name) {
  const oid = oids.at(-1);
  if (oid === undefined) {
    throw new Error(`${name} did not produce an object`);
  }
  return oid;
}

function treeEntry(oid, name) {
  return `100644 blob ${oid}\t${name}`;
}

function count(snapshot, operation) {
  return snapshot.get(operation) ?? 0;
}
