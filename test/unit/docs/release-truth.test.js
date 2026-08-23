import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function runNodeScript(relPath) {
  return spawnSync(process.execPath, [path.join(repoRoot, relPath)], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

describe('release truth docs and examples', () => {
  it.each([
    ['examples/store-and-restore.js', 'Integrity check: PASSED'],
    ['examples/encrypted-workflow.js', 'Integrity check: PASSED'],
    ['examples/progress-tracking.js', 'Content verification: PASSED'],
  ])(
    'keeps %s runnable under the current public API',
    (relPath, expectedOutput) => {
      const result = runNodeScript(relPath);

      expect(
        result.status,
        `${relPath} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
      ).toBe(0);
      expect(result.stdout).toContain(expectedOutput);
    },
    30_000
  );

  it('keeps the API quick-start on ContentAddressableStore.open', () => {
    const api = read('docs/API.md');

    expect(api).toContain('ContentAddressableStore.open({ cwd:');
    expect(api).toContain(
      'Any other `ContentAddressableStore` constructor option except `plumbing`'
    );
    expect(api).toContain('Any other `ContentAddressableStore` constructor option except `codec`');
    expect(api).not.toContain('Plumbing.create({ repoPath');
  });

  it('documents maxBlobSize as the metadata blob safety limit', () => {
    const api = read('docs/API.md');

    expect(api).toContain('`options.maxBlobSize` (optional): Max bytes for metadata blob reads');
    expect(api).not.toContain('Max bytes for manifest and sub-manifest blob reads');
  });

  it('documents the public VaultMetadata privacy shape and privacy errors', () => {
    const api = read('docs/API.md');

    expect(api).toContain('privacy?: {');
    expect(api).toContain('enabled: boolean;');
    expect(api).toContain('indexMeta?: EncryptionMeta;');
    expect(api).toContain('`VAULT_PRIVACY_INDEX_INVALID`');
    expect(api).toContain('`VAULT_PRIVACY_INDEX_MISSING`');
    expect(api).toContain('`VAULT_PRIVACY_KEY_REQUIRED`');
  });
});

describe('Merkle manifest docs', () => {
  it('keeps Merkle threshold docs on per-operation overrides', () => {
    const walkthrough = read('docs/WALKTHROUGH.md');

    expect(walkthrough).toContain('storeFile({');
    expect(walkthrough).toContain('merkleThreshold: 500, // Per-operation override');
    expect(walkthrough).toContain('Constructor-level `merkleThreshold` remains the default');
    expect(walkthrough).not.toContain('Set `merkleThreshold` at construction time:');
  });
});

describe('release truth security docs', () => {
  it('keeps the active threat model on current v6 scheme names', () => {
    const threatModel = read('docs/THREAT_MODEL.md');

    expect(threatModel).toContain('When `convergent` encryption is active');
    expect(threatModel).toContain('use `framed` or `whole`');
    expect(threatModel).not.toContain('When `convergent-v1` encryption is active');
    expect(threatModel).not.toContain('use `framed-v2` or `whole-v2` instead');
  });

  it('keeps nonce documentation precise for convergent encryption', () => {
    const readme = read('README.md');
    const advancedGuide = read('ADVANCED_GUIDE.md');

    expect(readme).not.toContain('All encryption uses **AES-256-GCM** with 12-byte random nonces');
    expect(readme).toMatch(/`whole`\s+and\s+`framed`\s+use fresh random 96-bit nonces/);
    expect(readme).toMatch(/`convergent`\s+derives per-chunk keys\s+and nonces/);

    expect(advancedGuide).not.toContain('All use 256-bit keys,\n96-bit random nonces');
    expect(advancedGuide).toMatch(/`whole`\s+and\s+`framed`\s+use fresh 96-bit random\s+nonces/);
    expect(advancedGuide).toMatch(
      /`convergent`\s+derives per-chunk keys and nonces deterministically/
    );
  });
});

describe('v6 release documentation', () => {
  it('keeps v6 migration instructions on safe passphrase sources', () => {
    const upgrading = read('UPGRADING.md');

    expect(upgrading).toContain('npm run upgrade -- --execute --passphrase-file -');
    expect(upgrading).toContain('--passphrase-file <path>');
    expect(upgrading).toContain('--vault-passphrase-file');
    expect(upgrading).not.toMatch(/npm run upgrade -- --execute --passphrase\s+</u);
  });

  it('keeps public v6 release notes discoverable from the README', () => {
    const readme = read('README.md');
    const releaseNotes = read('docs/releases/v6.0.0.md');

    expect(readme).toContain('[v6.0.0 Release Notes](./docs/releases/v6.0.0.md)');
    expect(readme).toContain('[UPGRADING.md](./UPGRADING.md)');
    expect(readme).toContain('Existing v5 users');
    expect(releaseNotes).toContain('# git-cas v6.0.0 Release Notes');
    expect(releaseNotes).toContain('npm run upgrade');
    expect(releaseNotes).toContain('--passphrase-file -');
  });

  it('keeps the v6 changelog aligned with final migration hardening', () => {
    const changelog = read('CHANGELOG.md');

    expect(changelog).toContain('`--passphrase-file`');
    expect(changelog).toContain('vault `encryptionCount` metadata');
    expect(changelog).toContain('npm package documentation surface');
    expect(changelog).toContain('concrete support, conduct, and vulnerability reporting paths');
  });

  it('keeps the changelog JSR posture aligned with release verification', () => {
    const changelog = read('CHANGELOG.md');
    const releaseVerify = read('scripts/release/verify.js');
    const jsrConfigExists = existsSync(path.join(repoRoot, 'jsr.json'));

    expect(jsrConfigExists).toBe(true);
    expect(releaseVerify).toContain("id: 'jsr-publish'");
    expect(changelog).not.toContain('JSR support removed');
    expect(changelog).not.toContain('The JSR registry publication workflow has been removed');
    expect(changelog).toContain('JSR publication deferred for v6.0.0');
  });
});

describe('README routing', () => {
  it('keeps the README as a front door and routes dense restore detail to the guide', () => {
    const readme = read('README.md');
    const guide = read('GUIDE.md');

    expect(readme).toContain('[Streaming and restore matrix](./GUIDE.md#streaming-surface)');
    expect(readme).not.toContain('| Read: encrypted `whole` |');
    expect(guide).toContain('## Streaming Surface');
    expect(guide).toMatch(/\|\s+Read: encrypted `whole`\s+\|/u);
    expect(guide).toContain('Runtime note: `framed` is the honest cross-runtime streaming answer.');
  });
});

describe('root-set release documentation', () => {
  it('distinguishes root sets from unrooted plumbing and vault history', () => {
    const api = read('docs/API.md');
    const upgrading = read('UPGRADING.md');

    expect(api).toContain('| Root set | anchored while present | current generation only |');
    expect(api).toContain('`pinned` does not create a\npack `.keep` file');
    expect(api).toContain('await rootSet.repair({ entries: authoritativeLiveEntries });');
    expect(upgrading).toContain(
      'adopt every\nstill-live OID before running destructive Git cleanup'
    );
  });
});

describe('application storage release documentation', () => {
  it('ships and links the v6.2.0 ownership and migration contract', () => {
    const readme = read('README.md');
    const upgrading = read('UPGRADING.md');
    const releaseNotes = read('docs/releases/v6.2.0.md');

    expect(readme).toContain('[v6.2.0 Release Notes](./docs/releases/v6.2.0.md)');
    expect(upgrading).toContain('Applications should stop treating a naked Git object ID');
    expect(upgrading).toContain('`cas.diagnostics.doctor()`');
    expect(releaseNotes).toContain('# git-cas v6.2.0 Release Notes');
    expect(releaseNotes).toContain('A handle is not a durability claim');
    expect(releaseNotes).toContain('does not run `git gc` or destructive prune');
  });
});

describe('scoped cache acquisition release documentation', () => {
  it('ships and links the v6.3.0 lifetime and pruning contract', () => {
    const readme = read('README.md');
    const releaseNotes = read('docs/releases/v6.3.0.md');

    expect(readme).toContain('[v6.3.0 Release Notes](./docs/releases/v6.3.0.md)');
    expect(releaseNotes).toContain('# git-cas v6.3.0 Release Notes');
    expect(releaseNotes).toContain('cache.acquire');
    expect(releaseNotes).toContain('git prune --expire=now');
    expect(releaseNotes).toContain('Callers must release it in `finally`');
  });
});

describe('scoped staging workspace release documentation', () => {
  it('ships and links the v6.4.0 temporary-reachability contract', () => {
    const readme = read('README.md');
    const upgrading = read('UPGRADING.md');
    const releaseNotes = read('docs/releases/v6.4.0.md');

    expect(readme).toContain('[v6.4.0 Release Notes](./docs/releases/v6.4.0.md)');
    expect(upgrading).toContain('Do not use a CacheSet as temporary construction storage');
    expect(releaseNotes).toContain('# git-cas v6.4.0 Release Notes');
    expect(releaseNotes).toContain('cas.workspaces.open');
    expect(releaseNotes).toContain('destination retention before releasing');
    expect(releaseNotes).toContain('nextCursor');
  });
});

describe('lazy bundle reference release documentation', () => {
  it('ships and links the v6.5.0 bounded-read contract', () => {
    const readme = read('README.md');
    const upgrading = read('UPGRADING.md');
    const releaseNotes = read('docs/releases/v6.5.0.md');

    expect(readme).toContain('[v6.5.0 Release Notes](./docs/releases/v6.5.0.md)');
    expect(upgrading).toContain('bundles.getMemberReference');
    expect(upgrading).toContain('observations, not retention claims');
    expect(releaseNotes).toContain('# git-cas v6.5.0 Release Notes');
    expect(releaseNotes).toContain('iterateMemberReferences');
    expect(releaseNotes).toContain('does not recursively validate');
    expect(releaseNotes).toContain('500/500');
  });
});

describe('page payload reuse release documentation', () => {
  it('ships and links the v6.5.1 bounded page cache contract', () => {
    const readme = read('README.md');
    const upgrading = read('UPGRADING.md');
    const releaseNotes = read('docs/releases/v6.5.1.md');

    expect(readme).toContain('[v6.5.1 Release Notes](./docs/releases/v6.5.1.md)');
    expect(upgrading).toContain('pageCacheEntries');
    expect(upgrading).toContain('Cache residence is an optimization, not retention evidence');
    expect(releaseNotes).toContain('# git-cas v6.5.1 Release Notes');
    expect(releaseNotes).toContain('zero additional Git commands');
    expect(releaseNotes).toContain('does not require stored-data migration');
  });
});

describe('persistent Git object session release documentation', () => {
  it('ships and links the v6.5.2 bounded process contract', () => {
    const readme = read('README.md');
    const upgrading = read('UPGRADING.md');
    const releaseNotes = read('docs/releases/v6.5.2.md');

    expect(readme).toContain('[v6.5.2 Release Notes](./docs/releases/v6.5.2.md)');
    expect(upgrading).toContain('pages.putBatch()');
    expect(upgrading).toMatch(/Closing drains\s+or terminates local Git processes/);
    expect(releaseNotes).toContain('# git-cas v6.5.2 Release Notes');
    expect(releaseNotes).toContain('225 Git processes to one');
    expect(releaseNotes).toContain('does not require stored-data migration');
  });
});

describe('Git object session coherence release documentation', () => {
  it('ships and links the v6.5.3 coherence contract', () => {
    const readme = read('README.md');
    const upgrading = read('UPGRADING.md');
    const releaseNotes = read('docs/releases/v6.5.3.md');

    expect(readme).toContain('[v6.5.3 Release Notes](./docs/releases/v6.5.3.md)');
    expect(upgrading).toContain('## v6.5.2 To v6.5.3');
    expect(upgrading).toContain('No application code changes are required');
    expect(releaseNotes).toContain('# git-cas v6.5.3 Release Notes');
    expect(releaseNotes).toMatch(/total Git\s+children fell from 558 to 401/);
    expect(releaseNotes).toMatch(/changes no\s+public API/);
  });
});

describe('batched workspace page retention release documentation', () => {
  it('ships and links the v6.5.4 ordered retention contract', () => {
    const readme = read('README.md');
    const upgrading = read('UPGRADING.md');
    const releaseNotes = read('docs/releases/v6.5.4.md');

    expect(readme).toContain('[v6.5.4 Release Notes](./docs/releases/v6.5.4.md)');
    expect(upgrading).toContain('## v6.5.3 To v6.5.4');
    expect(upgrading).toContain('workspace.pages.putBatch()');
    expect(releaseNotes).toContain('# git-cas v6.5.4 Release Notes');
    expect(releaseNotes).toMatch(/8,188 deterministic tiny pages in 32\s+batches/);
    expect(releaseNotes).toMatch(/requires no application or stored-data\s+migration/);
  });
});

describe('internal commit identity release documentation', () => {
  it('ships and links the v6.5.5 clean-bare-repository contract', () => {
    const readme = read('README.md');
    const upgrading = read('UPGRADING.md');
    const releaseNotes = read('docs/releases/v6.5.5.md');

    expect(readme).toContain('[v6.5.5 Release Notes](./docs/releases/v6.5.5.md)');
    expect(upgrading).toContain('## v6.5.4 To v6.5.5');
    expect(upgrading).toMatch(/requires no stored-data migration/);
    expect(releaseNotes).toContain('# git-cas v6.5.5 Release Notes');
    expect(releaseNotes).toContain('git-cas <git-cas@example.invalid>');
    expect(releaseNotes).toMatch(/does not invoke\s+`git config`/);
  });
});

describe('hosted cockpit and checked-ref release documentation', () => {
  it('ships and links the v6.5.6 compatibility contract', () => {
    const readme = read('README.md');
    const upgrading = read('UPGRADING.md');
    const releaseNotes = read('docs/releases/v6.5.6.md');

    expect(readme).toContain('[v6.5.6 Release Notes](./docs/releases/v6.5.6.md)');
    expect(upgrading).toContain('## v6.5.5 To v6.5.6');
    expect(upgrading).toMatch(/requires no migration/);
    expect(releaseNotes).toContain('# git-cas v6.5.6 Release Notes');
    expect(releaseNotes).toContain('structured post-failure');
    expect(releaseNotes).toContain('FramedApp');
  });
});

describe('bounded stream-session release documentation', () => {
  it('ships and links the v6.5.7 fixed-bound compatibility contract', () => {
    const readme = read('README.md');
    const upgrading = read('UPGRADING.md');
    const releaseNotes = read('docs/releases/v6.5.7.md');

    expect(readme).toContain('[v6.5.7 Release Notes](./docs/releases/v6.5.7.md)');
    expect(upgrading).toContain('## v6.5.6 To v6.5.7');
    expect(upgrading).toMatch(/requires no application or stored-data\s+migration/);
    expect(releaseNotes).toContain('# git-cas v6.5.7 Release Notes');
    expect(releaseNotes).toContain('fixed 10 MiB');
    expect(releaseNotes).toMatch(/fallback opened 32 one-shot\s+`cat-file` children/);
    expect(releaseNotes).toMatch(/large\s+payloads.*streaming behavior/s);
  });
});

describe('advanced guide rendering', () => {
  it('keeps the table of contents rendered as Markdown links', () => {
    const advancedGuide = read('ADVANCED_GUIDE.md');

    expect(advancedGuide).not.toContain('```insta-toc');
    expect(advancedGuide).toContain(
      '- [Content-Defined Chunking (CDC)](#content-defined-chunking-cdc)'
    );
    expect(advancedGuide).toContain(
      '- [Direct CasService and Custom Port Contracts](#direct-casservice-and-custom-port-contracts)'
    );
  });
});

describe('examples README snippets', () => {
  it('documents encrypted integrity verification with restore credentials', () => {
    const examplesReadme = read('examples/README.md');

    expect(examplesReadme).toContain(
      'cas.verifyIntegrity(manifest, { encryptionKey: optionalKeyBytes })'
    );
    expect(examplesReadme).toContain(
      'Encrypted manifests require the same credentials used for restore'
    );
  });
});
