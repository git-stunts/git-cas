import { initDefaultContext } from '@flyingrobots/bijou-node';
import { run, createKeyMap, quit } from '@flyingrobots/bijou-tui';
import { createTuiAppSkeleton } from '@flyingrobots/bijou-tui-app';
import { badge, box, column, row, spacer, tree, table, dag } from '@flyingrobots/bijou';

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

/**
 * BLOCK: Merkle Lens Block
 * Demonstrates Mantine-style "SegmentedControl" for TUI.
 */
function MerkleLensBlock({ mode, ctx }) {
  const modes = ['TABLE', 'TREE', 'DAG'];
  const segmentControl = row(modes.map(m => 
    badge(m, { variant: m === mode ? 'brand' : 'muted', ctx })
  ).flatMap((b, i) => i > 0 ? [' ', b] : [b]));

  let content;
  if (mode === 'TABLE') {
    content = table({
      columns: [{ header: 'Oid', width: 12 }, { header: 'Size', width: 8 }],
      rows: [['a1b2c3d4...', '256 KB'], ['e5f6g7h8...', '128 KB']],
      ctx
    });
  } else if (mode === 'TREE') {
    content = tree(SAMPLE_TREE, { ctx });
  } else {
    content = dag(SAMPLE_DAG, { ctx, maxWidth: 60 });
  }

  return box(
    column([
      row([ctx.style.bold('View Mode:'), '  ', segmentControl]),
      spacer(1, 1),
      content
    ]),
    { title: 'Merkle Explorer', padding: 2, ctx }
  );
}

/**
 * MAIN APP
 */
const ctx = initDefaultContext();

const app = createTuiAppSkeleton({
  ctx,
  title: 'git-cas Merkle Lens',
  tabs: [
    {
      id: 'explorer',
      title: 'Exploration',
      render: ({ width }) => MerkleLensBlock({ mode: 'DAG', ctx })
    }
  ],
  keyMap: createKeyMap().bind('q', 'Quit', quit())
});

console.log('Starting Merkle Lens Mock-up...');
await run(app, { mouse: true, ctx });
