import { describe, it, expect } from 'vitest';
import Semaphore from '../../../../src/domain/services/Semaphore.js';

describe('Semaphore – concurrency limiting', () => {
  it('allows up to N concurrent acquires', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    let resolved = false;
    const p = sem.acquire().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    sem.release();
    await p;
    expect(resolved).toBe(true);
  });

  it('release unblocks waiting acquires in order', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const order = [];
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));
    sem.release();
    await p1;
    sem.release();
    await p2;
    expect(order).toEqual([1, 2]);
  });

  it('concurrency 1 serializes operations', async () => {
    const sem = new Semaphore(1);
    const order = [];
    const task = async (id) => {
      await sem.acquire();
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end-${id}`);
      sem.release();
    };
    await Promise.all([task('a'), task('b')]);
    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b']);
  });
});

describe('Semaphore – validation', () => {
  it('throws on concurrency: 0', () => {
    expect(() => new Semaphore(0)).toThrow();
  });

  it('throws on concurrency: -1', () => {
    expect(() => new Semaphore(-1)).toThrow();
  });

  it('throws on concurrency: 1.5', () => {
    expect(() => new Semaphore(1.5)).toThrow();
  });

  it('throws when release is called without an active permit', () => {
    const sem = new Semaphore(1);
    expect(() => sem.release()).toThrow('Semaphore release called without an active permit');
  });
});
