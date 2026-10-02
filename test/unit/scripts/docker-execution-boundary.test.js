import { describe, expect, it, vi } from 'vitest';
import { requireDockerExecution } from '../../../scripts/testing/DockerExecutionBoundary.js';

describe('physical Docker test boundary', () => {
  it('rejects an absent marker even when ambient environment claims Docker or CI', () => {
    vi.stubEnv('GIT_STUNTS_DOCKER', '1');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    const exit = vi.fn();
    const logger = vi.fn();
    try {
      requireDockerExecution({ readMarker: () => false, exit, logger });
      expect(exit).toHaveBeenCalledWith(1);
      expect(logger).toHaveBeenCalledWith(expect.stringContaining('HOST EXECUTION PROHIBITED'));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('accepts a physical marker without relying on ambient flags', () => {
    const readMarker = vi.fn().mockReturnValue(true);
    const exit = vi.fn();
    const logger = vi.fn();
    requireDockerExecution({ readMarker, exit, logger });
    expect(readMarker).toHaveBeenCalledWith('/.dockerenv');
    expect(exit).not.toHaveBeenCalled();
    expect(logger).not.toHaveBeenCalled();
  });
});
