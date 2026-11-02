import { describe, expect, it, vi } from 'vitest';
import ContentAddressableStore from '../../../index.js';

describe('ContentAddressableStore reservations', () => {
  it('exposes the reservation namespace through a frozen public capability', () => {
    const cas = new ContentAddressableStore({ plumbing: { execute: vi.fn(), executeStream: vi.fn() } });
    expect(cas.reservations).toBeDefined();
    expect(Object.keys(cas.reservations)).toEqual(['open']);
    expect(Object.isFrozen(cas.reservations)).toBe(true);
  });
});
