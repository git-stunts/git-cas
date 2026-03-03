/**
 * @fileoverview Runtime-adaptive crypto adapter factory.
 */
import NodeCryptoAdapter from './NodeCryptoAdapter.js';

/**
 * Detects the best crypto adapter for the current runtime.
 *
 * - Bun  → BunCryptoAdapter (dynamic import)
 * - Deno → WebCryptoAdapter (dynamic import)
 * - Node → NodeCryptoAdapter (static import)
 *
 * @returns {Promise<import('../../ports/CryptoPort.js').default>} A runtime-appropriate CryptoPort implementation.
 */
export default async function createCryptoAdapter() {
  if (globalThis.Bun) {
    const { default: BunCryptoAdapter } = await import('./BunCryptoAdapter.js');
    return new BunCryptoAdapter();
  }
  if (globalThis.Deno) {
    const { default: WebCryptoAdapter } = await import('./WebCryptoAdapter.js');
    return new WebCryptoAdapter();
  }
  return new NodeCryptoAdapter();
}
