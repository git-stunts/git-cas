# Testimony of Sherlock Holmes: Verification Pass on git-stunts/git-cas#150

Watson, the case comes down to one observation. The *documentation* (API.md, CHANGELOG, README, files.d.ts) has been kept up with the code. The *evidence* (witness logs, timings, test counts) dates from 21 October and has not moved since. Every file under `docs/design/0064-reader-materialization/` was written in a single commit, `aea2dbf`, and none of the 26 later fix commits touched it (`git log 25609d6..7a4a9e5 -- docs/design/0064-reader-materialization` returns only `aea2dbf`). Over those same commits, `materializeFile.js` grew from 59 lines to 168 (`git show aea2dbf --stat`, and `src/infrastructure/adapters/materializeFile.js#168@7a4a9e5`).

## Custody check

- I confirmed source identity. `sha256(materializeFile.js)` is `4f8cd3ff…697b70` both in the PR checkout and in the `git-cas-test-node:latest` image's /app.
- Every hash in the manifest matches its log byte for byte (`witness/manifest.json#2-12@7a4a9e5`, recomputed with `shasum`).
- The SHA-256 values listed in `docs/design/README.md` for the design doc (`82a686a6…`) and for WITNESS.md (`7604ac69…`) match the files at head.
- One probe was run under lock `host/docker/git-cas-test-node/`: Node only, with no network, 2 GiB memory, 2 CPUs and a 600 s alarm. The focused set at head gave **5 files, 86 tests passed**: materializeFile 47, write-failure 1, JsonCodec 18, FileIOHelper 12, integration 8. Its log is `scratchpad/baker-150/holmes/focused-head.log`.

## Claims verified

**Code and package surface**
- The default codec and `createJson()` now use `RuntimeJsonCodec` (`index.js#310@7a4a9e5`, `index.js#719@7a4a9e5`). The portable `JsonCodec` is untouched: it is absent from the diffstat, and it still calls `utf8Decode` (`src/infrastructure/codecs/JsonCodec.js#24@7a4a9e5`). **CONFIRMED.**
- ICU fallback: if constructing a `fatal` decoder throws, the result is `null` and the portable path handles everything (`RuntimeJsonCodec.js#6-13@7a4a9e5`). A test simulates this (`test/unit/infrastructure/codecs/JsonCodec.test.js#68-76@7a4a9e5`). **CONFIRMED** in simulation; no real no-ICU build was tested.
- Malformed bytes fall back to the legacy decoder (`RuntimeJsonCodec.js#20-25@7a4a9e5`). A 4,096-case corpus test checks it (`JsonCodec.test.js#52-66@7a4a9e5`). BOM rejection is kept by `ignoreBOM: true` (`RuntimeJsonCodec.js#9@7a4a9e5`; test at `JsonCodec.test.js#38-41@7a4a9e5`). **CONFIRMED.**
- Package exports: `./files` has types and import entries, and `files.js`/`files.d.ts` are in the `files` list (`package.json#12-23@7a4a9e5`). **CONFIRMED.** The CI and release type checks include the new fixture (`.github/workflows/ci.yml#64@7a4a9e5`, `scripts/release/verify.js#87@7a4a9e5`). **CONFIRMED.**
- `RestorePath` was extracted with the same logic, apart from the `..cache` fix (`RestorePath.js#60-64@7a4a9e5`). The base version rejected any path starting with `..` (`git show 25609d6:src/infrastructure/adapters/FileIOHelper.js`, the `isInsideBaseDirectory` function). The CHANGELOG's "only by the path fix" (`CHANGELOG.md#12@7a4a9e5`, `CHANGELOG.md#20@7a4a9e5`) is **CONFIRMED**. The `''` (base itself) case gives the same result before and after, so `restoreFile` behaves unchanged there.

**API.md contract, checked line by line against `materializeFile.js@7a4a9e5`**

| Claim | Code at head | Verdict |
|---|---|---|
| Base directory rejected before the source is read (`docs/API.md#1060-1062`) | Check at `#18-21` runs before `writeStaged` at `#34`; tested at `materializeFile.test.js#190-204` | CONFIRMED |
| Steps run in order: stage, digest, cancellation check, rename (`API.md#1068-1070`) | `#34-39` | CONFIRMED |
| Digest hex is case-insensitive (`API.md#1073`) | `#35`, `#165` | CONFIRMED |
| Chunks are copied on pull, without calling `valueOf` (`API.md#1073-1075`) | `#125`; tests `#70-107` | CONFIRMED |
| Cancellation and write failures settle while the source is blocked (`API.md#1078-1080`) | `#140-147`, `#58`; `write-failure.test.js#20-37` | CONFIRMED |
| Source `return()` is called without waiting (`API.md#1079-1080`) | `#135` | CONFIRMED |
| File mode no broader than 0600 (`API.md#1081`) | `#57` (`mode: 0o600`, `wx`) | CONFIRMED by code only. No test asserts the mode. |
| Earlier failure wins over a cleanup failure (`API.md#1084-1085`) | `#42`; test `#248` | CONFIRMED |
| A cleanup error after publication may surface (`API.md#1083-1084`) | `#45` | CONFIRMED |
| Error codes: INVALID_OPTIONS (signal brand, non-Uint8Array chunk), SECURITY_BOUNDARY_VIOLATION, INTEGRITY_ERROR (`API.md#1093-1098`) | `#79`, `#97`, `#121`, `#166`, `#19-20`, `#36` | CONFIRMED |
| Falsy source rejections propagate unchanged (`API.md#1098`) | `#59-65`; tests `#298-312` | CONFIRMED |
| No fsync and no parent creation (`files.d.ts#14-15`; "Parent must exist", `files.d.ts#6`) | No fsync call anywhere; `mkdtemp` in the destination's directory at `#22` fails if the parent is missing | CONFIRMED |

**README example** (`README.md#118-134@7a4a9e5`): `ContentAddressableStore.open` exists (`index.js#691@7a4a9e5`), and `cas.assets.open({ handle })` with `cas.close()` matches the integration test (`test/integration/file-materialization.test.js#33-35@7a4a9e5`). **CONFIRMED.**

**Witness, as a record of `aea2dbf`**
- `files-red.log` shows the missing `./files` specifier (`witness/files-red.log#9@7a4a9e5`). `files-green.log` shows 42 passing (`#9`). Bun and Deno each show 51, including 8 integration tests (`bun-check.log#6,10`, `deno-check.log#6,10`). The Deno flag failure followed by a corrected check is disclosed (`deno-check.log#14-24`, `deno-types.log#1-2`). Node: 2,252 passed and 3 skipped; integration 227 (`node-final.log#261`, `#297`). All **CONFIRMED** for the tree they ran on.
- Timing medians recomputed from `performance.log#1-12@7a4a9e5`: raw 2.460, atomic 3.295, atomic plus SHA 3.316, native 1.490. 12 × 8,536 = 102,432 checks (`performance.json` summary). **CONFIRMED.**
- ESLint "Passed" (`WITNESS.md#21@7a4a9e5`): no lint output appears in any log. **UNVERIFIABLE.**

## Drift

- **D1, stale validation, and the worst drift.** The PR body reports "2,252 Node unit tests… 227… 51 tests each" as its Validation (PR body, pinned only by `gh pr view`). The witness behind it is `WITNESS.md#22-25@7a4a9e5`, written in `aea2dbf`. At head, the focused Node set alone is 86 tests, not 51 (my probe). Bun and Deno have **never** run on head's 47-test materializeFile suite or the new write-failure file. The witness command list doesn't even name that file (`WITNESS.md#55-56@7a4a9e5`). The body says "against base `25609d6`". In fact, the witness ran on an unnamed candidate tree (`performance.json` records `source_base: 25609d6` and `native_decoder_commit: 0e2717c`), and that tree predates 26 behaviour-changing commits.
- **D2, stale performance numbers.** The 3.295 s and 3.316 s publication figures (`WITNESS.md#81-82@7a4a9e5`) measure the 59-line helper. At head, every chunk is copied (`materializeFile.js#125@7a4a9e5`). Every pull also builds a `Promise.race` and an abort listener, because `pulls.signal` is always passed (`#60`, `#141-158`). Empty chunks add an extra macrotask (`#127`). None of this has been re-timed. The direction of the effect is conjecture; that the numbers are stale is fact.
- **D3, design doc stuck at revision 1.** Its error contract says the source error is "normally propagated" (`reader-materialization.md#126@7a4a9e5`). At head it always is (`materializeFile.js#65@7a4a9e5`). The design doc never mentions base-directory rejection, the chunk-type check, the signal brand check, the ICU fallback or the `..cache` fix. This is partly mitigated: the design doc points to API.md for the complete contract (`reader-materialization.md#65-66`).
- **D4.** The PR body's "twelve-trial performance campaign" is really 4 modes × 3 trials, with medians over 3 (`performance.json` `"trials": 3`). The wording is loose rather than false.
- **D5.** The PR body says profiling "dominated member resolution". The design doc says only "substantial UTF-8 conversion and allocation cost" (`reader-materialization.md#48-49@7a4a9e5`). The profile is private. The witness also has no before/after measurement of the decoder alone, and it disclaims attribution itself (`WITNESS.md#94-96`). The PR title's "Speed up" is therefore **UNVERIFIABLE** from the shipped evidence.

## Reverse drift: behaviour at head the docs don't mention

- **R1, leaf symlinks are followed.** `canonicalizeTargetPath` realpaths an existing leaf (`RestorePath.js#40@7a4a9e5`). So if `outputPath` is an existing in-base symlink, its *target* gets replaced, not the link. The docs speak only of "symlink prefixes" (`API.md#1062-1063@7a4a9e5`). This is the most material omission.
- **R2.** Zero-length chunks trigger a macrotask yield (`materializeFile.js#127@7a4a9e5`). This is undocumented, though empty-file publication is tested (`materializeFile.test.js#52`).
- **R3.** Options are snapshotted once, and the iterator method and `next` are captured once (`materializeFile.js#71-87,111-113@7a4a9e5`). Undocumented; harmless.
- **R4.** The CHANGELOG omits the `signal` brand check and its `INVALID_OPTIONS` error (`CHANGELOG.md#12@7a4a9e5`), although API.md has it (`API.md#1093-1094`).
- **R5, conjecture, not probed.** For a custom abort reason, cancellation can surface as `signal.reason` (from the early checks at `#16` and `#38`) or as the pipeline's AbortError, depending on when it fires. "Underlying runtime error forms" (`API.md#1099`) covers this only vaguely.

## VERDICT

| # | Claim | Verdict |
|---|---|---|
| 1 | RuntimeJsonCodec is the default; JsonCodec unchanged | CONFIRMED |
| 2 | ICU / `fatal` fallback | CONFIRMED (simulated only) |
| 3 | Malformed-byte, BOM and encoding compatibility | CONFIRMED |
| 4 | `./files` export, types, CI and release fixture | CONFIRMED |
| 5 | RestorePath extraction; `restoreFile` changes only by `..cache` | CONFIRMED |
| 6 | API.md contract (11 sub-claims) | CONFIRMED (0600 untested) |
| 7 | README example | CONFIRMED |
| 8 | Witness logs and hashes match their own run | CONFIRMED |
| 9 | Performance medians match the log | CONFIRMED (for `aea2dbf`) |
| 10 | ESLint passed | UNVERIFIABLE |
| 11 | Validation counts describe the PR head | DRIFT (D1) |
| 12 | Performance describes the head helper | DRIFT (D2) |
| 13 | Design doc contract current | DRIFT (D3, minor) |
| 14 | "Twelve-trial" | DRIFT (D4, minor) |
| 15 | Profiling "dominated"; decoder speedup shown | UNVERIFIABLE (D5) |
| 16 | Crash orphans, durability, hostile mutation listed as exclusions | PLANNED / honestly framed (`reader-materialization.md#164-168`) |
| R1–R5 | Undocumented head behaviour | REVERSE DRIFT (R1 material, R2–R5 minor) |

```
VERDICT
  drift_count: 5 forward (D1–D5) + 5 reverse (R1–R5)
  worst_drift: D1 — PR body and witness present 21-Oct validation (51 focused,
               2,252 unit, Bun/Deno) as the PR's validation; head 7a4a9e5 has
               26 later fix commits, 86 focused Node tests, and zero Bun/Deno runs.
  runner_up:   R1 — existing leaf symlink inside the base is followed and its
               target replaced; docs mention only symlink prefixes.
  fidelity_grade: B-
  rationale: user-facing docs (API.md, CHANGELOG, README, files.d.ts) track head
             precisely; the evidence layer (witness, timings, design rev 1) is a
             faithful record of aea2dbf, not of the PR under review.
  remedy: re-run the witness (Node full, Bun/Deno focused incl. write-failure
          file, timing) at 7a4a9e5 and record the candidate SHA; document
          leaf-symlink following; issue design doc v2.
```