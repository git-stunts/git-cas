import { initDefaultContext } from '@flyingrobots/bijou-node';
import { run, createKeyMap, quit } from '@flyingrobots/bijou-tui';
import { createTuiAppSkeleton } from '@flyingrobots/bijou-tui-app';
import { badge, box, column, row, spacer, timeline } from '@flyingrobots/bijou';

/**
 * MOCK DATA: Health Events
 */
const EVENTS = [
  { label: 'Vault Initialized', status: 'success' },
  { label: 'Passphrase Rotated', status: 'active' },
  { label: 'Integrity Sweep: 4 Issues', status: 'warning' },
  { label: 'Backup Completed', status: 'muted' },
];

/**
 * BLOCK: Health Report Block
 * A cohesive summary of repo state.
 */
function HealthReportBlock({ ctx }) {
  return box(
    column([
      row([
        badge('REACHABILITY: OK', { variant: 'success', ctx }),
        '  ',
        badge('ENCRYPTION: HARDENED', { variant: 'brand', ctx }),
      ]),
      spacer(1, 1),
      ctx.style.bold('Vault History:'),
      spacer(1, 1),
      timeline(EVENTS, { ctx }),
      spacer(1, 1),
      ctx.style.styled(ctx.semantic('subdued'), 'Last sweep: 2 mins ago'),
    ]),
    { title: 'Vault Doctor Report', padding: 2, ctx }
  );
}

/**
 * MAIN APP
 */
const ctx = initDefaultContext();

const app = createTuiAppSkeleton({
  ctx,
  title: 'git-cas Health Monitor',
  tabs: [
    {
      id: 'health',
      title: 'Diagnostics',
      render: () => HealthReportBlock({ ctx })
    }
  ],
  keyMap: createKeyMap().bind('q', 'Quit', quit())
});

console.log('Starting Health Monitor Mock-up...');
await run(app, { mouse: true, ctx });
