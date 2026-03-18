/**
 * Shared test context factory for CLI UI tests.
 */
import { createTestContext } from '@flyingrobots/bijou/adapters/test';

export function makeCtx(mode = 'interactive', runtime = {}) {
  return createTestContext({ mode, noColor: true, runtime });
}
