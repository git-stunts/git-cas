import type {
  GitRefPortBase,
  RepositoryDiagnosticLimitation,
  RepositoryDoctorReport,
  RepositoryInspectionPort,
  RetentionRootKind,
} from '../../index.d.ts';

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

function describeLegacyRootKind(kind: RetentionRootKind): string {
  switch (kind) {
    case 'root-set':
    case 'publication':
    case 'cache-set':
    case 'expiring-set':
      return kind;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

void describeLegacyRootKind;

function describeLegacyDiagnosticKind(
  kind: NonNullable<RepositoryDiagnosticLimitation['kind']>,
): string {
  switch (kind) {
    case 'caches':
    case 'rootSets':
    case 'expiringSets':
      return kind;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

void describeLegacyDiagnosticKind;

type AcquisitionsRemainAdditive = {} extends Pick<
  RepositoryDoctorReport['usage'],
  'acquisitions'
> ? true : false;

const acquisitionsRemainAdditive: AcquisitionsRemainAdditive = true;
void acquisitionsRemainAdditive;
