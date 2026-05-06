import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('CasService decomposition boundary', () => {
  it('keeps CasService as a lean orchestrator', () => {
    const source = read('src/domain/services/CasService.js');
    const lines = source.trimEnd().split('\n');

    expect(lines.length).toBeLessThan(500);
    expect(source).not.toContain("from '../bytes/ByteLayout.js'");
    expect(source).not.toContain('FRAMED_RECORD_HEADER_BYTES');
    expect(source).not.toContain('readUint32BE');
    expect(source).not.toContain('writeUint32BE');
  });

  it('keeps byte-level store and restore strategies outside CasService', () => {
    const expectedStrategyFiles = [
      'src/domain/strategies/StoreConvergent.js',
      'src/domain/strategies/StoreFramed.js',
      'src/domain/strategies/StoreWhole.js',
      'src/domain/strategies/RestoreConvergent.js',
      'src/domain/strategies/RestoreFramed.js',
      'src/domain/strategies/RestoreWhole.js',
    ];

    for (const file of expectedStrategyFiles) {
      expect(read(file)).toContain('export default class');
    }
  });

  it('keeps audit and status docs aligned with the completed de-sludge', () => {
    const audit = read('docs/audit/2026-05-05_v6-release-readiness.md');
    const releaseBlocker = read('docs/method/backlog/v6.0.0/REL_audit-blocker-burn-down.md');
    const status = read('STATUS.md');

    expect(audit).toContain('ISSUE-001: CasService.js Logic Leak');
    expect(audit).toContain('Resolution Status:** RESOLVED');
    expect(audit).toContain('`CasService.js` is now under 500 lines');
    expect(audit).not.toContain('DEFERRED TO v6.1.0');
    expect(audit).not.toContain('The class is still 2300+ lines');
    expect(releaseBlocker).not.toContain('byte-level restore-handler extraction remains deferred');
    expect(status).not.toContain('SEC — Vault Passphrase Verifier Gap');
  });
});
