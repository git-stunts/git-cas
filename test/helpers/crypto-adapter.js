/**
 * Returns the runtime-appropriate crypto adapter for tests.
 *
 * Delegates to the shared runtime detection in createCryptoAdapter.
 */
import createCryptoAdapter from '../../src/infrastructure/adapters/createCryptoAdapter.js';

export { createCryptoAdapter as getTestCryptoAdapter };
