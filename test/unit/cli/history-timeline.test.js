import { describe, it, expect, vi } from 'vitest';
import { makeCtx } from './_testContext.js';

vi.mock('../../../bin/ui/context.js', () => ({
  getCliContext: () => makeCtx(),
}));

const { renderHistoryTimeline } = await import('../../../bin/ui/history-timeline.js');

describe('renderHistoryTimeline', () => {
  it('renders "No history" for empty input', () => {
    expect(renderHistoryTimeline('')).toBe('No history\n');
  });

  it('renders timeline entries from git log output', () => {
    const log = 'eff5569 vault: add photos/beach\nc3bde6c vault: init';
    const output = renderHistoryTimeline(log);
    expect(output).toContain('vault: add photos/beach');
    expect(output).toContain('vault: init');
    expect(output).toContain('eff5569');
    expect(output).toContain('c3bde6c');
  });

  it('handles all operation types', () => {
    const log = [
      'aaa1111 vault: init',
      'bbb2222 vault: add my-asset',
      'ccc3333 vault: update my-asset',
      'ddd4444 vault: remove my-asset',
    ].join('\n');
    const output = renderHistoryTimeline(log);
    expect(output).toContain('vault: init');
    expect(output).toContain('vault: add');
    expect(output).toContain('vault: update');
    expect(output).toContain('vault: remove');
  });

  it('paginates when entries exceed perPage', () => {
    const lines = Array.from({ length: 25 }, (_, i) =>
      `${String(i).padStart(7, '0')} vault: add asset-${i}`
    );
    const page1 = renderHistoryTimeline(lines.join('\n'), { page: 1, perPage: 10 });
    expect(page1).toContain('asset-0');
    expect(page1).not.toContain('asset-10');
  });
});
