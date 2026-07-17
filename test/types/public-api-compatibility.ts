import type { GitRefPortBase, RepositoryInspectionPort } from '../../index.d.ts';

class LegacyGitRefAdapter {
  async resolveRef(_ref: string): Promise<string> {
    return 'a'.repeat(40);
  }

  async resolveTree(_commitOid: string): Promise<string> {
    return 'b'.repeat(40);
  }

  async resolveParents(_commitOid: string): Promise<string[]> {
    return [];
  }

  async createCommit(_options: {
    treeOid: string;
    parentOid?: string | null;
    parentOids?: string[];
    message: string;
  }): Promise<string> {
    return 'c'.repeat(40);
  }

  async updateRef(_options: {
    ref: string;
    newOid: string;
    expectedOldOid?: string | null;
  }): Promise<void> {}
}

const legacyAdapter: GitRefPortBase = new LegacyGitRefAdapter();
void legacyAdapter;

class LegacyRepositoryInspectionAdapter {
  async *iterateObjects() {
    yield {
      oid: 'a'.repeat(40),
      type: 'blob' as const,
      logicalBytes: 1,
      physicalBytes: 1,
    };
  }

  async *iterateReachableObjectIds() {
    yield 'a'.repeat(40);
  }

  async *iteratePrunableObjects(_options: { expiresBefore: string }) {
    yield { oid: 'a'.repeat(40), type: 'blob' as const };
  }

  async *iterateRefs(_options?: { prefix?: string }) {
    yield { ref: 'refs/heads/main', oid: 'a'.repeat(40) };
  }

  async reachablePhysicalBytes(): Promise<number> {
    return 1;
  }
}

const legacyInspection: RepositoryInspectionPort = new LegacyRepositoryInspectionAdapter();
void legacyInspection;
