# Bijou 7 Framed Cockpit Witness

Date: 2026-07-27

Branch: `deps/bijou-7.2`

Base: `9ea91a738f2cbadf2a20b5ac7c2c6d54ba9f409e`

## Dependency family

`npm ls @flyingrobots/bijou @flyingrobots/bijou-node
@flyingrobots/bijou-tui @flyingrobots/bijou-tui-app --all` resolved one
coherent family:

```text
@flyingrobots/bijou@7.2.0
@flyingrobots/bijou-node@7.2.0
@flyingrobots/bijou-tui@7.2.0
@flyingrobots/bijou-tui-app@7.2.0
```

There were no Bijou 5 packages in the installed tree.

## Ownership proof

The interactive launcher now returns a hosted `FramedApp` and invokes
`app.run({ ctx })`. The frame owns:

- outer application header and footer;
- help;
- command and asset-search palettes;
- settings;
- transient notifications and notification history;
- performance telemetry;
- quit confirmation;
- terminal runtime lifecycle.

The single `cockpit` page continues to own vault authentication, source and
asset state, Explorer/Atlas/Operations navigation, the store wizard, and
storage commands.

Structural inspection against the base showed the duplicated application
shell disappearing:

- `dashboard-view.js`: seven old shell/overlay helpers removed;
- `dashboard.js`: twelve old palette, filtering-overlay, help, notification,
  and quit helpers removed;
- `createDashboardPage()` added as the explicit domain/page contract;
- `createDashboardApp()` now hosts that page through `createFramedApp()`.

## Interaction proof

Focused tests prove:

- the frame initializes the `cockpit` page;
- `F2`, backtick, and `q` change frame state rather than `DashModel`;
- `/` opens frame search over page-provided asset/digest items;
- selecting a search item dispatches a page-scoped action and opens its
  manifest view;
- password and Store Wizard modal input receive ordinary characters and
  shell-reserved `q`, `/`, and `?` keys instead of dropping them or opening
  frame chrome;
- page failures become frame-managed notifications;
- runtime dimensions seed both the frame and page;
- static launch retains tab-separated output.

## Progress and cursor proof

Store and restore progress use Bijou's reference-counted cursor guard.
Regression coverage proves:

- the initial `0/N` render does not increment the processed count;
- normal detach restores the cursor;
- an exception during the first progress render also restores the cursor and
  leaves no event listener attached.

## Contrast proof

Design Book selected the high-contrast foreground for the dark application
surfaces. Bijou's theme doctor and explicit text-tone tests enforce a minimum
4.5:1 ratio.

Measured against the primary `#25313a` canvas:

| Foreground       | Contrast |
| ---------------- | -------: |
| ghost `#fbfcfc`  |  12.94:1 |
| pearl `#e4ebf1`  |  11.05:1 |
| slate `#bccbd8`  |   8.03:1 |
| cyan `#23ddd2`   |   7.82:1 |
| orange `#ffa366` |   6.77:1 |
| ruby `#ff6f88`   |   4.99:1 |
| sky `#97c2ff`    |   7.27:1 |
| violet `#ba9bff` |   5.84:1 |

The former deep-slate subdued pairing measured 3.33:1 and was replaced by
slate.

## Validation

### Unit and lint

```text
npm test
Test Files  225 passed (225)
Tests       2095 passed | 2 skipped (2097)

npx eslint .
exit 0
```

### Docker integration

The first local `npm run test:integration` attempt was rejected before test
execution because integration suites require `GIT_STUNTS_DOCKER=1`. The
repository-prescribed command then passed:

```text
npm run test:integration:node
Test Files  13 passed (13)
Tests       199 passed (199)
```

### Package dry run

```text
npm pack --dry-run --json
entryCount    256
packed size   786023 bytes
unpacked size 2211848 bytes
```

Full release-verifier and publication evidence are appended only after their
respective gates complete.
