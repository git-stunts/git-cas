/**
 * Returns the runtime-appropriate crypto adapter for tests.
 *
 * - Node  → NodeCryptoAdapter
 * - Bun   → BunCryptoAdapter
 * - Deno  → WebCryptoAdapter
 *
 * Mirrors the detection logic in index.js getDefaultCryptoAdapter().
 */
export async function getTestCryptoAdapter() {
  if (globalThis.Bun) {
    const { default: BunCryptoAdapter } = await import(
      '../../src/infrastructure/adapters/BunCryptoAdapter.js'
    );
    return new BunCryptoAdapter();
  }
  if (globalThis.Deno) {
    const { default: WebCryptoAdapter } = await import(
      '../../src/infrastructure/adapters/WebCryptoAdapter.js'
    );
    return new WebCryptoAdapter();
  }
  const { default: NodeCryptoAdapter } = await import(
    '../../src/infrastructure/adapters/NodeCryptoAdapter.js'
  );
  return new NodeCryptoAdapter();
}
