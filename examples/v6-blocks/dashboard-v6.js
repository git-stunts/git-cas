import { initDefaultContext } from '@flyingrobots/bijou-node';
import { run, quit } from '@flyingrobots/bijou-tui';
import { badge, boxSurface, createSurface, parseAnsiToSurface } from '@flyingrobots/bijou';
import { hstackSurface, vstackSurface } from '@flyingrobots/bijou-tui';

/**
 * MOCK DATA
 */
const ENTRIES = [
  { slug: 'assets/video-hero.mp4', size: '1.2 GB', crypto: 'convergent', format: 'merkle' },
  { slug: 'db/backup-2026.sql.gz', size: '450 MB', crypto: 'framed', format: 'merkle' },
  { slug: 'config/prod.env', size: '1.2 KB', crypto: 'whole', format: 'single' },
];

function text(str, ctx) {
  if (typeof str !== 'string') return str;
  return parseAnsiToSurface(str, Math.max(1, str.replace(/\x1b\[[0-9;]*m/g, '').length), 1);
}

/**
 * BLOCK: Asset Ledger
 */
function AssetLedgerBlock({ entries, selectedIndex, ctx, width, height }) {
  const innerWidth = width - 2;
  const rows = entries.map((entry, i) => {
    const isFocused = i === selectedIndex;

    return hstackSurface(1,
      text(isFocused ? ctx.style.styled(ctx.semantic('primary'), '▸') : ' ', ctx),
      text(ctx.style.styled(ctx.semantic(isFocused ? 'primary' : 'muted'), (entry.slug.length > 15 ? entry.slug.slice(0, 15) + '...' : entry.slug).padEnd(18)), ctx),
      badge(entry.size, { variant: isFocused ? 'accent' : 'muted', ctx }),
      badge(entry.crypto, { variant: 'info', ctx }),
    );
  });

  const content = vstackSurface(...rows);
  const bg = createSurface(innerWidth, height - 2);
  bg.blit(content, 0, 0);

  return boxSurface(bg, {
    title: 'Entries Ledger',
    width,
    height,
    ctx
  });
}

/**
 * BLOCK: Inspector Block
 */
function InspectorBlock({ entry, ctx, width, height }) {
  const innerWidth = width - 2;

  if (!entry) {
    const bg = createSurface(innerWidth, height - 2);
    bg.blit(text('Select an asset to inspect.', ctx), 0, 0);
    return boxSurface(bg, { title: 'Manifest Inspector', width, height, ctx });
  }

  const content = vstackSurface(
    hstackSurface(1, text(ctx.style.bold('Asset:'), ctx), text(ctx.style.styled(ctx.semantic('primary'), entry.slug), ctx)),
    createSurface(1, 1), // spacer
    hstackSurface(1,
      badge('SHA-256', { variant: 'brand', ctx }),
      text(ctx.style.styled(ctx.semantic('muted'), 'f3a1...9b2e'), ctx)
    ),
    createSurface(1, 1), // spacer
    text(ctx.style.styled(ctx.semantic('muted'), 'Content-Defined Chunking (Buzhash)'), ctx),
    text(ctx.style.styled(ctx.semantic('muted'), 'Target: 1 MiB | Min: 512 KiB | Max: 2 MiB'), ctx),
  );

  const bg = createSurface(innerWidth, height - 2);
  bg.blit(content, 0, 0);

  return boxSurface(bg, { title: 'Manifest Inspector', width, height, ctx });
}

/**
 * BLOCK: Help Overlay
 */
function HelpOverlay({ ctx }) {
  const lines = [
    text(ctx.style.bold('Keybindings Reference'), ctx),
    createSurface(1, 1),
    text('  [?]        Toggle this help menu', ctx),
    text('  [q]        Quit application', ctx),
    text('  [j/down]   Move focus down', ctx),
    text('  [k/up]     Move focus up', ctx),
  ];
  const content = vstackSurface(...lines);
  const bg = createSurface(content.width + 4, content.height + 2);
  bg.blit(content, 2, 1);
  return boxSurface(bg, { title: 'Controls', width: bg.width, height: bg.height, ctx });
}

/**
 * MAIN APP
 */
const ctx = initDefaultContext();

const app = {
  init() {
    return [{ selectedIndex: 0 }, []];
  },
  update(msg, model) {
    if (msg.type === 'key' && (msg.key === 'q' || msg.ctrl && msg.key === 'c')) {
      return [model, [quit()]];
    }
    if (msg.type === 'key' && msg.key === '?') {
      return [{ ...model, showHelp: !model.showHelp }, []];
    }
    if (model.showHelp) return [model, []];

    if (msg.type === 'key' && (msg.key === 'j' || msg.key === 'down')) {
      return [{ ...model, selectedIndex: Math.min(model.selectedIndex + 1, ENTRIES.length - 1) }, []];
    }
    if (msg.type === 'key' && (msg.key === 'k' || msg.key === 'up')) {
      return [{ ...model, selectedIndex: Math.max(model.selectedIndex - 1, 0) }, []];
    }
    return [model, []];
  },
  view(model) {
    const width = ctx.runtime.columns;
    const height = ctx.runtime.rows;

    const headerStr = `git-cas V6 Cockpit | [j/k] Move Focus | [?] Help | [q] Quit\n`;
    const header = text(headerStr, ctx);

    const bodyHeight = height - header.height;
    const sidebarWidth = Math.floor(width * 0.4);
    const contentWidth = width - sidebarWidth - 2;

    const sidebar = AssetLedgerBlock({ entries: ENTRIES, selectedIndex: model.selectedIndex, ctx, width: sidebarWidth, height: bodyHeight });
    const content = InspectorBlock({ entry: ENTRIES[model.selectedIndex], ctx, width: contentWidth, height: bodyHeight });

    const body = hstackSurface(2, sidebar, content);

    return vstackSurface(header, body);
  }
};

console.log('Starting git-cas V6 Mock-up...');
await run(app, { ctx });
