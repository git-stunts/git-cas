import { describe, it, expect, afterEach } from 'vitest';
import createCryptoAdapter from '../../../../src/infrastructure/adapters/createCryptoAdapter.js';
import CryptoPort from '../../../../src/ports/CryptoPort.js';
import NodeCryptoAdapter from '../../../../src/infrastructure/adapters/NodeCryptoAdapter.js';

describe('createCryptoAdapter', () => {
  const origBun = globalThis.Bun;
  const origDeno = globalThis.Deno;

  afterEach(() => {
    // Restore globals
    if (origBun === undefined) { delete globalThis.Bun; } else { globalThis.Bun = origBun; }
    if (origDeno === undefined) { delete globalThis.Deno; } else { globalThis.Deno = origDeno; }
  });

  it('returns a CryptoPort instance', async () => {
    const adapter = await createCryptoAdapter();
    expect(adapter).toBeInstanceOf(CryptoPort);
  });

  it('returns NodeCryptoAdapter when neither Bun nor Deno globals exist', async () => {
    delete globalThis.Bun;
    delete globalThis.Deno;
    const adapter = await createCryptoAdapter();
    expect(adapter).toBeInstanceOf(NodeCryptoAdapter);
  });

  it('returns BunCryptoAdapter when globalThis.Bun exists', async () => {
    // Skip if we're not running on Bun — the dynamic import would fail
    if (!origBun) { return; }
    const adapter = await createCryptoAdapter();
    expect(adapter).toBeInstanceOf(CryptoPort);
    expect(adapter.constructor.name).toBe('BunCryptoAdapter');
  });

  it('returns WebCryptoAdapter when globalThis.Deno exists', async () => {
    // Skip if we're not running on Deno — the dynamic import would fail
    if (!origDeno) { return; }
    const adapter = await createCryptoAdapter();
    expect(adapter).toBeInstanceOf(CryptoPort);
    expect(adapter.constructor.name).toBe('WebCryptoAdapter');
  });
});
