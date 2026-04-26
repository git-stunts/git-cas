import { initDefaultContext } from '@flyingrobots/bijou-node';
import { run, quit } from '@flyingrobots/bijou-tui';
import { badge, boxSurface, tree, table, dag, createSurface, parseAnsiToSurface } from '@flyingrobots/bijou';
import { hstackSurface, vstackSurface } from '@flyingrobots/bijou-tui';

/**
 * MOCK DATA: Merkle Structure
 */
const SAMPLE_TREE = [
  { label: 'manifest.json', children: [] },
  { label: 'sub-manifest-0', children: [ { label: 'chunk-a' }, { label: 'chunk-b' } ] },
  { label: 'sub-manifest-1', children: [ { label: 'chunk-c' } ] },
];

const SAMPLE_DAG = [
  { id: 'root', label: 'Asset Root', edges: ['sub0', 'sub1'], badge: 'merkle' },
  { id: 'sub0', label: 'Sub-Manifest 0', edges: ['ca', 'cb'] },
  { id: 'sub1', label: 'Sub-Manifest 1', edges: ['cc'] },
  { id: 'ca', label: 'Chunk A' },
  { id: 'cb', label: 'Chunk B' },
  { id: 'cc', label: 'Chunk C' },
];

function text(str, ctx) {
  if (typeof str !== 'string') return str;
  return parseAnsiToSurface(str, Math.max(1, str.replace(/\x1b\[[0-9;]*m/g, '').length), 1);
}

/**
 * BLOCK: Merkle Lens Block
 * Demonstrates Mantine-style "SegmentedControl" for TUI.
 */
function MerkleLensBlock({ mode, ctx, width, height }) {
  const innerWidth = width - 2;
  const modes = ['TABLE', 'TREE', 'DAG'];
  const segmentControl = hstackSurface(1, ...modes.map(m => 
    badge(m, { variant: m === mode ? 'brand' : 'muted', ctx })
  ));

  let contentStr;
  if (mode === 'TABLE') {
    contentStr = table({
      columns: [{ header: 'Oid', width: 12 }, { header: 'Size', width: 8 }],
      rows: [['a1b2c3d4...', '256 KB'], ['e5f6g7h8...', '128 KB']],
      ctx
    });
  } else if (mode === 'TREE') {
    contentStr = tree(SAMPLE_TREE, { ctx });
  } else {
    contentStr = dag(SAMPLE_DAG, { ctx, maxWidth: innerWidth });
  }

  const lines = contentStr.split('\n');
  const contentSurface = parseAnsiToSurface(contentStr, innerWidth, lines.length);

  const block = vstackSurface(
    hstackSurface(2, text(ctx.style.bold('View Mode:'), ctx), segmentControl),
    createSurface(1, 1), // spacer
    contentSurface
  );

  const bg = createSurface(innerWidth, height - 2);
  bg.blit(block, 0, 0, 0, 0, Math.min(block.width, innerWidth), Math.min(block.height, height - 2));

  return boxSurface(bg, { title: 'Merkle Explorer', width, height, ctx });
}

/**
 * MAIN APP
 */
const ctx = initDefaultContext();

const app = {
  init() {
    return [{ mode: 'DAG' }, []];
  },
  update(msg, model) {
    if (msg.type === 'key' && (msg.key === 'q' || msg.ctrl && msg.key === 'c')) {
      return [model, [quit()]];
    }
    if (msg.type === 'key' && msg.key === 'tab') {
      const modes = ['TABLE', 'TREE', 'DAG'];
      const nextIdx = (modes.indexOf(model.mode) + 1) % modes.length;
      return [{ ...model, mode: modes[nextIdx] }, []];
    }
    return [model, []];
  },
  view(model) {
    const width = ctx.runtime.columns;
    const height = ctx.runtime.rows;

    const headerStr = `git-cas Merkle Lens | [Tab] Toggle Mode | [q] Quit\n`;
    const header = text(headerStr, ctx);
    
    const bodyHeight = height - header.height;
    const body = MerkleLensBlock({ mode: model.mode, ctx, width, height: bodyHeight });

    return vstackSurface(header, body);
  }
};

console.log('Starting Merkle Lens Mock-up... (Press Tab to toggle mode)');
await run(app, { ctx });
