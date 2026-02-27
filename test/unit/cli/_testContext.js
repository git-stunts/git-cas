/**
 * Shared test context factory for CLI UI tests.
 */
import { createTestContext } from '@flyingrobots/bijou/adapters/test';

export function makeCtx(mode = 'interactive') {
  return createTestContext({ mode, noColor: true });
}
