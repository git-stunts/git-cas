import { existsSync } from 'node:fs';
import { ensureDocker } from '@git-stunts/docker-guard';

/** Require a physical Docker marker; environment flags cannot authorize host tests. */
export function requireDockerExecution({ readMarker = existsSync, exit, logger } = {}) {
  ensureDocker({
    env: readMarker('/.dockerenv') ? { GIT_STUNTS_DOCKER: '1' } : {},
    exit,
    logger,
  });
}
