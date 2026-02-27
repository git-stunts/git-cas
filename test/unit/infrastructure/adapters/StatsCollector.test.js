import { describe, it, expect } from 'vitest';
import StatsCollector from '../../../../src/infrastructure/adapters/StatsCollector.js';

describe('StatsCollector – accumulation', () => {
  it('accumulates chunk metrics', () => {
    const stats = new StatsCollector();
    stats.metric('chunk', { action: 'stored', size: 1024 });
    stats.metric('chunk', { action: 'stored', size: 2048 });

    const s = stats.summary();
    expect(s.chunksProcessed).toBe(2);
    expect(s.bytesTotal).toBe(3072);
  });

  it('counts errors', () => {
    const stats = new StatsCollector();
    stats.metric('error', { code: 'ERR', message: 'fail' });

    const s = stats.summary();
    expect(s.errors).toBe(1);
  });

  it('returns zero summary when no metrics emitted', () => {
    const stats = new StatsCollector();
    const s = stats.summary();
    expect(s.chunksProcessed).toBe(0);
    expect(s.bytesTotal).toBe(0);
    expect(s.elapsed).toBe(0);
    expect(s.throughput).toBe(0);
    expect(s.errors).toBe(0);
  });

  it('calculates elapsed and throughput', async () => {
    const stats = new StatsCollector();
    stats.metric('chunk', { action: 'stored', size: 1000 });
    // Small delay to ensure elapsed > 0
    await new Promise((r) => setTimeout(r, 10));
    stats.metric('chunk', { action: 'stored', size: 1000 });

    const s = stats.summary();
    expect(s.elapsed).toBeGreaterThan(0);
    expect(s.throughput).toBeGreaterThan(0);
  });
});

describe('StatsCollector – robustness', () => {
  it('handles malformed chunk payloads gracefully', () => {
    const stats = new StatsCollector();
    stats.metric('chunk', { action: 'stored' });
    stats.metric('chunk', { action: 'stored', size: undefined });
    stats.metric('chunk', { action: 'stored', size: NaN });
    stats.metric('chunk', { action: 'stored', size: 'not-a-number' });
    stats.metric('chunk', { action: 'stored', size: Infinity });

    const s = stats.summary();
    expect(s.chunksProcessed).toBe(5);
    expect(s.bytesTotal).toBe(0);
  });

  it('log() and span() do not throw', () => {
    const stats = new StatsCollector();
    expect(() => stats.log('info', 'test')).not.toThrow();
    const s = stats.span('op');
    expect(() => s.end()).not.toThrow();
  });
});
