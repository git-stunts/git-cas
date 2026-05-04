import { initDefaultContext } from '@flyingrobots/bijou-node';
import { run, quit } from '@flyingrobots/bijou-tui';
import { badge, boxSurface, timeline, createSurface, parseAnsiToSurface } from '@flyingrobots/bijou';
import { hstackSurface, vstackSurface } from '@flyingrobots/bijou-tui';

/**
 * MOCK DATA: Health Events
 */
const EVENTS = [
  { label: 'Vault Initialized', status: 'success' },
  { label: 'Passphrase Rotated', status: 'active' },
  { label: 'Integrity Sweep: 4 Issues', status: 'warning' },
  { label: 'Backup Completed', status: 'muted' },
];

function text(str, ctx) {
  if (typeof str !== 'string') return str;
  return parseAnsiToSurface(str, Math.max(1, str.replace(/\x1b\[[0-9;]*m/g, '').length), 1);
}

/**
 * BLOCK: Health Report Block
 * A cohesive summary of repo state.
 */
function HealthReportBlock({ ctx, width, height }) {
  const innerWidth = width - 2;

  const timelineStr = timeline(EVENTS, { ctx });
  const timelineLines = timelineStr.split('\n');
  const timelineSurface = parseAnsiToSurface(timelineStr, innerWidth, timelineLines.length);

  const block = vstackSurface(
    hstackSurface(2,
      badge('REACHABILITY: OK', { variant: 'success', ctx }),
      badge('ENCRYPTION: HARDENED', { variant: 'brand', ctx }),
    ),
    createSurface(1, 1),
    text(ctx.style.bold('Vault History:'), ctx),
    createSurface(1, 1),
    timelineSurface,
    createSurface(1, 1),
    text(ctx.style.styled(ctx.semantic('muted'), 'Last sweep: 2 mins ago'), ctx),
  );

  const bg = createSurface(innerWidth, height - 2);
  bg.blit(block, 0, 0, 0, 0, Math.min(block.width, innerWidth), Math.min(block.height, height - 2));

  return boxSurface(bg, { title: 'Vault Doctor Report', width, height, ctx });
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
    return [{ showHelp: false }, []];
  },
  update(msg, model) {
    if (msg.type === 'key' && (msg.key === 'q' || msg.ctrl && msg.key === 'c')) {
      return [model, [quit()]];
    }
    if (msg.type === 'key' && msg.key === '?') {
      return [{ ...model, showHelp: !model.showHelp }, []];
    }
    if (model.showHelp) return [model, []];

    return [model, []];
  },
  view(model) {
    const width = ctx.runtime.columns;
    const height = ctx.runtime.rows;

    const headerStr = `git-cas Health Monitor | [?] Help | [q] Quit\n`;
    const header = text(headerStr, ctx);

    const bodyHeight = height - header.height;
    const body = HealthReportBlock({ ctx, width, height: bodyHeight });
    const screen = vstackSurface(header, body);

    if (model.showHelp) {
      const help = HelpOverlay({ ctx });
      screen.blit(help, Math.max(0, Math.floor((width - help.width) / 2)), Math.max(0, Math.floor((height - help.height) / 2)));
    }

    return screen;
  }
};

console.log('Starting Health Monitor Mock-up...');
await run(app, { ctx });
