import { initDefaultContext } from '@flyingrobots/bijou-node';
import { run, createKeyMap, quit } from '@flyingrobots/bijou-tui';
import { createTuiAppSkeleton } from '@flyingrobots/bijou-tui-app';
import { badge, box, column, row, spacer, textSurface, createSurface } from '@flyingrobots/bijou';

/**
 * MOCK DATA
 */
const ENTRIES = [
  { slug: 'assets/video-hero.mp4', size: '1.2 GB', crypto: 'convergent', format: 'merkle' },
  { slug: 'db/backup-2026.sql.gz', size: '450 MB', crypto: 'framed', format: 'merkle' },
  { slug: 'config/prod.env', size: '1.2 KB', crypto: 'whole', format: 'single' },
];

/**
 * BLOCK: Asset Ledger
 * Demonstrates a "packaged" view component with internal rhythm.
 */
function AssetLedgerBlock({ entries, selectedIndex, ctx }) {
  const rows = entries.map((entry, i) => {
    const isFocused = i === selectedIndex;
    const tone = isFocused ? 'brand' : 'subdued';
    
    return row([
      ctx.ui(isFocused ? 'cursor' : 'gap', isFocused ? '▸' : ' '),
      ' ',
      ctx.style.styled(ctx.semantic(isFocused ? 'primary' : 'foreground'), entry.slug.padEnd(25)),
      ' ',
      badge(entry.size, { variant: isFocused ? 'accent' : 'muted', ctx }),
      ' ',
      badge(entry.crypto, { variant: 'info', ctx }),
    ]);
  });

  return box(column(rows), {
    title: 'Entries Ledger',
    padding: 1, // Bijou 1-cell atomic padding
    ctx
  });
}

/**
 * BLOCK: Inspector Block
 * Demonstrates the "Mantine Card" pattern for terminal metadata.
 */
function InspectorBlock({ entry, ctx }) {
  if (!entry) return box('Select an asset to inspect.', { ctx });

  return box(
    column([
      row([ctx.style.bold('Asset:'), ' ', ctx.style.styled(ctx.semantic('primary'), entry.slug)]),
      spacer(1, 1),
      row([
        badge('SHA-256', { variant: 'brand', ctx }),
        ' ',
        ctx.style.styled(ctx.semantic('subdued'), 'f3a1...9b2e')
      ]),
      spacer(1, 1),
      ctx.style.styled(ctx.semantic('subdued'), 'Content-Defined Chunking (Buzhash)'),
      ctx.style.styled(ctx.semantic('subdued'), 'Target: 1 MiB | Min: 512 KiB | Max: 2 MiB'),
    ]),
    { title: 'Manifest Inspector', padding: 1, ctx }
  );
}

/**
 * MAIN APP
 */
const ctx = initDefaultContext();

const app = createTuiAppSkeleton({
  ctx,
  title: 'git-cas V6 Cockpit',
  tabs: [
    {
      id: 'ledger',
      title: 'Vault Explorer',
      render: ({ width, height }) => {
        // Here we use the "Workspace" pattern: Sidebar (35%) + Content (65%)
        const sidebarWidth = Math.floor(width * 0.4);
        const contentWidth = width - sidebarWidth - 2; // -2 for the gap

        return row([
          AssetLedgerBlock({ entries: ENTRIES, selectedIndex: 0, ctx }),
          '  ', // THE RULE OF 2: 2-cell gap between major blocks
          InspectorBlock({ entry: ENTRIES[0], ctx })
        ]);
      }
    },
    {
      id: 'history',
      title: 'History',
      render: () => 'History Timeline Block (Coming Soon)'
    }
  ],
  keyMap: createKeyMap().bind('q', 'Quit', quit())
});

console.log('Starting git-cas V6 Mock-up...');
await run(app, { mouse: true, ctx });
