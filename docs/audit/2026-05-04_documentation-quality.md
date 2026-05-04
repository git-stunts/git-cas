---
report_id: "AUD-2026-05-04-DQ"
title: "Documentation Quality Audit: git-cas v6.0.0 Pre-Tag Candidate"
status: "Final"
audit:
  date_started: 2026-05-04
  date_completed: 2026-05-04
  type: "Full"
  scope: "README.md, GUIDE.md, ADVANCED_GUIDE.md, docs/API.md, docs/WALKTHROUGH.md, SECURITY.md, docs/THREAT_MODEL.md, examples, standard repository docs"
  compliance_frameworks: ["Internal Documentation Standards", "Keep a Changelog", "Semantic Versioning"]
target:
  repository: "github.com/git-stunts/git-cas"
  branch: "main"
  commit_hash: "594309039b69bf28b982eb6a6fe3c0a5393f19a0"
  language_stack: ["Markdown", "JavaScript ESM", "Node.js >=22", "Git CLI"]
  environment: "Local pre-tag release workspace"
methodology:
  automated_tools: ["rg", "find", "node examples/encrypted-workflow.js", "node examples/progress-tracking.js", "node examples/store-and-restore.js"]
  manual_review_hours: 3
  false_positive_rate: "5%"
summary:
  total_findings: 8
  severity_count:
    critical: 0
    high: 3
    medium: 3
    low: 2
  remediation_status: "Pending"
related_reports:
  previous_audit: "AUD-2026-04-11-DOCUMENTATION-QUALITY"
  tracking_ticket: "docs/method/backlog/bad-code/DOC_examples-uint8array-drift.md"
---

# AUDIT 2: DOCUMENTATION QUALITY

## 1. ACCURACY & EFFECTIVENESS ASSESSMENT

### 1.1. Core Mismatch

The most critical documentation mismatch is not in the README itself; it is in example-bearing documentation that the README and docs map make part of the onboarding surface.

Two maintained examples fail under the current v6 byte contract:

- `examples/encrypted-workflow.js:94-99` calls `buffer.toString()` and `buffer.equals(...)` on the `restore()` result. Running `node examples/encrypted-workflow.js` fails with `buffer.equals is not a function`.
- `examples/progress-tracking.js:146-147` calls `buffer.equals(...)` on a `Uint8Array`. Running `node examples/progress-tracking.js` fails with `TypeError: buffer.equals is not a function`.

This conflicts with the v6 public contract stated in `README.md:232-234` and `docs/API.md:10-13`: public byte APIs should be treated as `Uint8Array`, with Node `Buffer` only at Node-specific boundaries.

The second concrete mismatch is in `docs/API.md:53-58`, which shows:

```js
import Plumbing from '@git-stunts/plumbing';

const plumbing = await Plumbing.create({ repoPath: '/path/to/repo' });
```

The installed `@git-stunts/plumbing` class exposes `createDefault` and `createRepository`, not `create`. Current README/GUIDE examples use `GitPlumbing.createDefault({ cwd })` correctly (`README.md:51-60`, `GUIDE.md:65-72`).

The third mismatch is in `docs/THREAT_MODEL.md:57-62`, which says `convergent-v1` is active and recommends `framed-v2` or `whole-v2`. Current v6 source accepts only `whole`, `framed`, and `convergent` as current scheme names (`src/domain/encryption/schemes.js:13-21`) and rejects legacy scheme identifiers in normal reads.

### 1.2. Audience & Goal Alignment

Primary audience:

- library integrators who need a Git-backed CAS API
- CLI/TUI operators managing assets and vaults
- automation/agent authors using the JSONL agent surface
- maintainers preparing releases or migrations

Top 3 questions and current coverage:

1. **How do I store, persist, and restore content?** Mostly yes. `README.md:26-60` gives quick starts, `GUIDE.md:61-88` gives a complete cycle, and `docs/WALKTHROUGH.md` provides long-form examples.
2. **What are the security boundaries and metadata leaks?** Mostly yes, but with a serious stale section. `SECURITY.md:80-99` points to the threat model, and `SECURITY.md:187-224` explains convergent encryption. However, `docs/THREAT_MODEL.md:57-62` still uses legacy scheme names as if they were active.
3. **How do I automate or operate it at release scale?** Yes in breadth. `README.md:144-168` summarizes CLI and agent surfaces; `docs/API.md` documents agent protocol and error codes; `docs/RELEASE.md` and `STATUS.md` capture release mechanics. The gap is confidence: example-bearing docs are not all executable under v6.

### 1.3. Time-to-Value (TTV) Barrier

The biggest documentation bottleneck is that the first library path still has two initialization concepts: plumbing creation and CAS creation. That is acceptable if all examples are correct, but `docs/API.md:53-58` uses a stale plumbing constructor and two examples fail at runtime. This creates a trust break exactly where a new developer tries to copy code.

Secondary TTV barriers:

- README quick start assumes the package is installed, but does not show `npm install -g @git-stunts/git-cas` or local package import setup before the CLI snippet (`README.md:26-37`).
- `examples/README.md:5-15` says examples are maintained, but there is no evidence that all example scripts run in CI or release verification.
- The direct port path is documented, but lacks a runnable custom adapter cookbook.

## 2. REQUIRED UPDATES & COMPLETENESS CHECK

### 2.1. README.md Priority Fixes

1. Add an **Install and prerequisites** block before Quick Start: Node.js >=22, Git on PATH, `npm install -g @git-stunts/git-cas` for CLI use, and package install/import guidance for library use.
2. Add a **v6 byte contract note** beside Library Ingress: `restore()` returns `Uint8Array`; use `new TextDecoder().decode(bytes)` or `Buffer.from(bytes)` only at Node display/file edges. Link to `docs/API.md`.
3. Add an **Examples are validated** line after the docs map once example tests exist, linking to `examples/README.md` and naming the runnable examples. Until then, do not imply examples are a fully trusted onboarding path.

### 2.2. Missing Standard Documentation

At least two standard repository docs are missing or underdeveloped for a public library/CLI:

- `CODE_OF_CONDUCT.md` is missing. The repo has `CONTRIBUTING.md`, `SECURITY.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, and `LICENSE`, but no conduct baseline for community interaction.
- `SUPPORT.md` is missing. There is no short document describing supported versions, where to ask usage questions, where to report security issues, and what information to include in bug reports.
- Generated public API documentation is missing. `docs/API.md` is useful, but there is no generated TypeDoc/JSDoc artifact or validation that public declarations, JSDoc, and examples remain synchronized.

### 2.3. Supplementary Documentation

The complex area that needs a dedicated file is custom adapter implementation. `ADVANCED_GUIDE.md` describes direct `CasService` construction and port requirements, but a developer implementing a custom `GitPersistencePort`, `CompressionPort`, or browser-adjacent storage adapter still has to infer behavior from source. The right deliverable is `docs/EXTENDING.md` with runnable adapter stubs and conformance expectations.

## 3. FINAL ACTION PLAN

### 3.1. Recommendation Type

**A. Recommend incremental updates to the existing README and documentation.**

The documentation structure is fundamentally sound after the v6 coverage pass. The README, GUIDE, ADVANCED_GUIDE, SECURITY, API reference, walkthrough, changelog, release docs, and METHOD planning docs form a coherent map. The necessary work is targeted: fix stale examples, correct specific snippets, add standard repo docs, and add tests so drift does not recur.

### 3.2. Deliverable (Prompt Generation)

Use an incremental cleanup prompt focused on:

- fixing `examples/encrypted-workflow.js` and `examples/progress-tracking.js` for `Uint8Array`
- correcting `docs/API.md` plumbing initialization
- correcting `docs/THREAT_MODEL.md` scheme names
- updating README install/byte-contract guidance
- adding `CODE_OF_CONDUCT.md`, `SUPPORT.md`, and `docs/EXTENDING.md`
- adding executable docs/example coverage

### 3.3. Mitigation Prompt

`Perform an incremental documentation accuracy pass for git-cas v6.0.0. Fix the runnable examples so examples/encrypted-workflow.js and examples/progress-tracking.js use Uint8Array-safe byte comparisons and decoding, then add tests that execute maintained examples in isolated temporary repositories. Correct docs/API.md to use GitPlumbing.createDefault({ cwd }) instead of the nonexistent Plumbing.create({ repoPath }). Correct docs/THREAT_MODEL.md so active scheme names are whole, framed, and convergent, with legacy v1/v2 names described only as migration inputs. Update README.md with install prerequisites, the v6 Uint8Array byte-contract note, and a link to validated examples. Create CODE_OF_CONDUCT.md and SUPPORT.md using concise standard open-source templates. Create docs/EXTENDING.md with runnable custom-port examples for MemoryGitPersistenceAdapter and no-op CompressionPort. Run node examples/store-and-restore.js, node examples/encrypted-workflow.js, node examples/progress-tracking.js, npm test, npx eslint ., and npm run release:verify -- --skip-jsr.`
