---
report_id: "AUD-2026-05-04-SR"
title: "Ship Readiness Audit: git-cas v6.0.0 Pre-Tag Candidate"
status: "Final"
audit:
  date_started: 2026-05-04
  date_completed: 2026-05-04
  type: "Full"
  scope: "Pre-tag v6.0.0 release readiness across source, CLI, examples, docs, dependencies, CI, and release workflow"
  compliance_frameworks: ["Internal Release Standards", "Semantic Versioning", "NIST SP 800-38D Guidance"]
target:
  repository: "github.com/git-stunts/git-cas"
  branch: "main"
  commit_hash: "594309039b69bf28b982eb6a6fe3c0a5393f19a0"
  language_stack: ["JavaScript ESM", "Node.js >=22", "Bun", "Deno", "Git CLI", "GitHub Actions"]
  environment: "Local pre-tag release workspace"
methodology:
  automated_tools: ["git status", "rg", "wc -l", "pnpm audit --prod --json", "pnpm outdated --format json", "node examples/*.js", "npm run release:verify -- --skip-jsr"]
  manual_review_hours: 4
  false_positive_rate: "7%"
summary:
  total_findings: 14
  severity_count:
    critical: 0
    high: 5
    medium: 6
    low: 3
  remediation_status: "Pending"
related_reports:
  previous_audit: "AUD-2026-04-11-SHIP-READINESS"
  tracking_ticket: "docs/method/backlog/bad-code/DOC_examples-uint8array-drift.md"
---

# AUDIT 3: SHIP READINESS

## 1. QUALITY & MAINTAINABILITY ASSESSMENT (EXHAUSTIVE)

### 1.1. Technical Debt Score (1-10)

**Score:** 4.5, where 1 is excellent and 10 is unmaintainable.

The codebase is not unmaintainable. It has strong schema validation, clear port boundaries, real release verification, multi-runtime posture, and a substantial test suite. The debt score is elevated by three patterns:

1. **Large orchestration modules.** `src/domain/services/CasService.js` is 2,535 lines and still owns store, restore, encryption selection, manifest reads, tree publication, and integrity verification. `bin/agent/cli.js` is 2,213 lines and owns parser/protocol/command behavior.
2. **Duplicated human/agent command orchestration.** Human CLI and agent CLI both implement vault stats by listing entries and reading manifests sequentially (`bin/git-cas.js:582-590`, `bin/agent/cli.js:2199-2210`). The same pattern appears across target resolution, credential validation, and vault mutations.
3. **Public-edge drift is not fully executable.** `examples/store-and-restore.js` passes, but `examples/encrypted-workflow.js` and `examples/progress-tracking.js` fail under the v6 `Uint8Array` byte contract. That means release truth is stronger in the core tests than in the onboarding surface.

### 1.2. Readability & Consistency

**Issue 1:** `docs/API.md` shows a nonexistent `@git-stunts/plumbing` factory.

`docs/API.md:53-58` uses `await Plumbing.create({ repoPath })`. The installed class exposes `createDefault` and `createRepository`, and current README/GUIDE snippets use `GitPlumbing.createDefault({ cwd })`.

**Mitigation Prompt 1:** `Correct all docs/API.md plumbing snippets to use GitPlumbing.createDefault({ cwd }) unless the example intentionally demonstrates createRepository. Add a docs regression test that imports @git-stunts/plumbing, asserts createDefault exists, and fails if docs/API.md contains "Plumbing.create({ repoPath". Update README/GUIDE cross-links if needed.`

**Issue 2:** Runnable examples still use Node `Buffer` methods on the v6 public `Uint8Array` return value.

`examples/encrypted-workflow.js:94-99` and `examples/progress-tracking.js:146-147` call `.toString()` / `.equals()` on restored bytes. `node examples/encrypted-workflow.js` failed with `buffer.equals is not a function`; `node examples/progress-tracking.js` failed with `TypeError: buffer.equals is not a function`.

**Mitigation Prompt 2:** `Replace Buffer-specific calls in maintained examples with Uint8Array-safe helpers. Add bytesEqual(a, b) using length and indexed comparison, and use TextDecoder for text display or Buffer.from(bytes).toString() only in Node-specific display code. Run all maintained examples under Node and add an examples-run docs test.`

**Issue 3:** The canonical threat model uses obsolete active scheme names.

`docs/THREAT_MODEL.md:57-62` says `convergent-v1` is active and recommends `framed-v2` / `whole-v2`; current source declares `whole`, `framed`, and `convergent` as the only current schemes (`src/domain/encryption/schemes.js:13-21`).

**Mitigation Prompt 3:** `Update docs/THREAT_MODEL.md so active scheme names are whole, framed, and convergent. Move v1/v2 strings into a "Legacy migration inputs" paragraph. Add a docs test that rejects active-use phrasing for convergent-v1, framed-v2, or whole-v2 outside migration/design/archive contexts.`

### 1.3. Code Quality Violation

**Violation 1:** `CasService._executeRestoreStrategy()` is a switchboard inside an already oversized service.

Original shape (`src/domain/services/CasService.js:1505-1515`):

```js
async *_executeRestoreStrategy(strategy, { manifest, key, encryptionMeta }) {
  switch (strategy) {
    case 'convergent': yield* this._restoreConvergentStreaming(manifest, key); break;
    case 'convergent-compressed': yield* this._restoreConvergentCompressed(manifest, key); break;
    case 'framed-compressed': yield* this._restoreFramedCompressedStreaming(manifest, key, encryptionMeta); break;
    case 'framed': yield* this._restoreFramedStreaming(manifest, key, encryptionMeta); break;
    case 'buffered': yield* this._restoreBuffered(manifest, key, encryptionMeta); break;
    case 'compressed-streaming': yield* this._restoreCompressedStreaming(manifest); break;
    default: yield* this._restoreStreaming(manifest); break;
  }
}
```

Simplified rewrite:

```js
const RESTORE_STRATEGIES = {
  convergent: (svc, ctx) => svc._restoreConvergentStreaming(ctx.manifest, ctx.key),
  'convergent-compressed': (svc, ctx) => svc._restoreConvergentCompressed(ctx.manifest, ctx.key),
  'framed-compressed': (svc, ctx) => svc._restoreFramedCompressedStreaming(ctx.manifest, ctx.key, ctx.encryptionMeta),
  framed: (svc, ctx) => svc._restoreFramedStreaming(ctx.manifest, ctx.key, ctx.encryptionMeta),
  buffered: (svc, ctx) => svc._restoreBuffered(ctx.manifest, ctx.key, ctx.encryptionMeta),
  'compressed-streaming': (svc, ctx) => svc._restoreCompressedStreaming(ctx.manifest),
  streaming: (svc, ctx) => svc._restoreStreaming(ctx.manifest),
};

async *_executeRestoreStrategy(strategy, ctx) {
  const execute = RESTORE_STRATEGIES[strategy] || RESTORE_STRATEGIES.streaming;
  yield* execute(this, ctx);
}
```

**Mitigation Prompt 4:** `Move restore strategy dispatch into a table-driven helper or a RestorePipeline module. Preserve existing private method behavior and add tests for every strategy classification: plaintext streaming, compressed streaming, whole buffered, framed streaming, framed+gzip, convergent streaming, and convergent+gzip.`

**Violation 2:** `bin/agent/cli.js` mixes protocol, parsing, validation, and command execution.

Original shape (`bin/agent/cli.js:1497-1534`, plus command implementations through `bin/agent/cli.js:1591-2213`):

```js
const COMMAND_HANDLERS = Object.freeze({
  store: storeCommand,
  tree: treeCommand,
  restore: restoreCommand,
  // ...
  'vault.stats': vaultStatsCommand,
});

async function executeAgentCommand(command, args, context) {
  const handler = COMMAND_HANDLERS[command];
  if (!handler) {
    throw invalidInput('Unknown agent command', { command, availableCommands: AVAILABLE_COMMANDS });
  }
  return handler(args, context.stdin, context.session);
}
```

Simplified rewrite:

```js
// bin/agent/commands/index.js
export const COMMAND_HANDLERS = Object.freeze({
  store: storeCommand,
  tree: treeCommand,
  restore: restoreCommand,
  'vault.stats': vaultStatsCommand,
});

// bin/agent/cli.js
async function executeAgentCommand(command, args, context) {
  const handler = COMMAND_HANDLERS[command];
  if (!handler) {
    throw invalidInput('Unknown agent command', { command, availableCommands: AVAILABLE_COMMANDS });
  }
  return handler.execute({ args, stdin: context.stdin, session: context.session });
}
```

**Mitigation Prompt 5:** `Extract agent command implementations into bin/agent/commands/*.js while keeping runAgentCli(argv, deps) stable. Split parser helpers into bin/agent/input.js and keep protocol/session handling in bin/agent/cli.js. Add tests that unknown-command output and every command's JSONL event sequence remain unchanged.`

**Violation 3:** Human CLI store action combines input validation, config merge, progress wiring, domain call, vault mutation, and rendering.

Original shape (`bin/git-cas.js:267-306`):

```js
.action(
  runAction(async (file, opts) => {
    validateCredentialSources(opts);
    // recipient conflict, config, observer, progress, store, tree, vault, render
    const cas = createCas(opts.cwd, { observability: observer, ...casConfig });
    const storeOpts = await buildStoreOpts(cas, file, opts);
    Object.assign(storeOpts, storeExtras);
    const progress = createStoreProgress({ filePath: file, chunkSize: cas.chunkSize, quiet });
    progress.attach(observer);
    let manifest;
    try {
      manifest = await cas.storeFile(storeOpts);
    } finally {
      progress.detach();
    }
    // output handling
  }, getJson)
);
```

Simplified rewrite:

```js
async function executeStoreUseCase({ file, opts, deps }) {
  const cas = deps.createCas(opts.cwd, deps.casOptions);
  const manifest = await deps.withProgress(
    createStoreProgress({ filePath: file, chunkSize: cas.chunkSize, quiet: opts.quiet }),
    () => cas.storeFile(await buildStoreOpts(cas, file, opts)),
  );
  if (!opts.tree) {
    return { manifest };
  }
  const treeOid = await cas.createTree({ manifest });
  await cas.addToVault({ slug: opts.slug, treeOid, force: Boolean(opts.force) });
  return { treeOid };
}
```

**Mitigation Prompt 6:** `Extract bin/use-cases/store.js with executeStoreUseCase({ file, opts, deps }) returning plain data. Keep commander action responsible only for validation, invoking the use case, and rendering JSON/text. Add tests for the use case using injected fake CAS/progress dependencies and keep existing CLI integration tests.`

## 2. PRODUCTION READINESS & RISK ASSESSMENT (EXHAUSTIVE)

### 2.1. Top 3 Immediate Ship-Stopping Risks (The "Hard No")

**Risk 1: High - maintained examples fail under the public v6 byte contract.**

Locations: `examples/encrypted-workflow.js:94-99`, `examples/progress-tracking.js:146-147`.

Evidence: direct execution failed:

- `node examples/encrypted-workflow.js` -> `buffer.equals is not a function`
- `node examples/progress-tracking.js` -> `TypeError: buffer.equals is not a function`

This is a hard no for a tag if examples are considered part of the release surface. They teach exactly the wrong assumption after the v6 `Uint8Array` change.

**Mitigation Prompt 7:** `Fix examples/encrypted-workflow.js and examples/progress-tracking.js for Uint8Array. Add a shared bytesEqual helper or inline comparison, and decode text with TextDecoder. Add test/unit/docs/examples-run.test.js that runs maintained examples in isolated temp repos. Update examples/README.md to state which examples are executable and covered.`

**Risk 2: High - threat model still advertises legacy scheme names as active choices.**

Location: `docs/THREAT_MODEL.md:57-62`.

This undercuts the security story for v6 because it directs users toward `framed-v2` / `whole-v2`, which normal v6 reads reject as legacy.

**Mitigation Prompt 8:** `Correct docs/THREAT_MODEL.md active scheme language to use convergent, framed, and whole. Add a migration-only paragraph for whole-v1/whole-v2/framed-v1/framed-v2/convergent-v1. Cross-link SECURITY.md#convergent-scheme and UPGRADING.md. Add a docs guard test for stale active scheme names.`

**Risk 3: High - API quick-start snippet uses nonexistent plumbing API.**

Location: `docs/API.md:53-58`.

This blocks first-contact library integration for developers who land on `docs/API.md` instead of README/GUIDE.

**Mitigation Prompt 9:** `Replace docs/API.md Plumbing.create({ repoPath }) with GitPlumbing.createDefault({ cwd }). Search all docs/examples for repoPath/create mismatches. Add a regression test that scans example snippets for "Plumbing.create({" and fails unless the symbol exists in @git-stunts/plumbing.`

### 2.2. Security Posture

**Vulnerability 1: Inline passphrase flags expose secrets through process arguments and shell history.**

Locations: `bin/git-cas.js:244-246`, `bin/git-cas.js:506-508`, `bin/git-cas.js:724-728`, `GUIDE.md:660`, `GUIDE.md:708`, `GUIDE.md:717-718`.

The CLI wording says to prefer env/file/keychain in some places, but still documents inline passphrase arguments as normal flags. On multi-user systems, process arguments can be visible during command execution; shell histories can persist them after execution.

**Mitigation Prompt 10:** `Mark inline passphrase flags as insecure/deprecated. Emit a stderr warning whenever --vault-passphrase, --old-passphrase, or --new-passphrase is used. Prefer --vault-passphrase-file -, passphrase files with permission checks, OS keychain, and GIT_CAS_PASSPHRASE in all examples. Add SECURITY.md guidance and CLI tests for warning behavior.`

**Vulnerability 2: Vault metadata lacks an authenticated passphrase verifier for empty encrypted vaults.**

Location: `src/domain/services/VaultService.js:620-627`; existing backlog: `docs/method/backlog/bad-code/SEC_vault-passphrase-verifier-gap.md`.

The vault stores KDF metadata, but an empty encrypted vault can have no encrypted entry or privacy index to authenticate the derived key against. Existing encrypted content eventually catches wrong keys during restore, but vault unlock UX should not depend on asset presence.

**Mitigation Prompt 11:** `Add a vault metadata verifier during initVault({ passphrase }). Store a random verifier encrypted or MACed with the derived vault key in .vault.json. Validate it in all unlock/derive paths before accepting a passphrase. Add migration support for existing encrypted vaults without verifiers and tests for empty encrypted vaults rejecting wrong passphrases.`

### 2.3. Operational Gaps

**Gap 1:** The release gate is environment-sensitive and did not complete in this audit session. `npm run release:verify -- --skip-jsr` passed lint and Node unit tests, then failed at the Bun Docker step because the local Docker daemon was unavailable. Maintained examples are also not release-gated, so release verification can miss example failures even when Docker is available.

**Gap 2:** Community support docs are incomplete. `CODE_OF_CONDUCT.md` and `SUPPORT.md` are absent, which is acceptable for a private/internal repo but below standard for a public library/CLI.

**Gap 3:** There is no lightweight environment preflight in the README quick start. `git-cas doctor` diagnoses vault health, but first-contact docs do not explicitly prove Node version, Git availability, package installation, and repository initialization before the first store.

## 3. FINAL RECOMMENDATIONS & NEXT STEP

### 3.1. Final Ship Recommendation

**NO** for tagging today.

The core code is close, production dependency audit is clean, and previous v6 verification history is strong. The ship blockers are public truth and release-gate evidence: maintained examples fail, `docs/API.md` contains a stale constructor snippet, the threat model still uses obsolete active scheme names, and the local release verifier could not complete because Docker was unavailable. Because the user explicitly asked for docs and example coverage before the v6 release, those are tag blockers even though they are not deep runtime failures.

### 3.2. Prioritized Action Plan

**Action 1 (High Urgency):** Fix and test maintained examples for the `Uint8Array` byte contract.

**Action 2 (High Urgency):** Correct stale release/security docs: `docs/API.md` plumbing snippet and `docs/THREAT_MODEL.md` active scheme names.

**Action 3 (Medium Urgency):** Re-run `npm run release:verify -- --skip-jsr` with Docker available, then add release-gate coverage for examples and stale-scheme docs so future docs drift is caught before tag prep.
