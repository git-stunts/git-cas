# Testimony of Professor James Moriarty: PR git-stunts/git-cas#150

They survived eleven rounds and forty-one findings, so the obvious attacks were never going to work. What I found is in the edges of the contract and in an evidence file that stopped being updated after the code moved on.

All probes ran in `git-cas-test-node:latest` (Node v22.23.4; Bun and Deno are not in that image) under the `host/docker/git-cas-test-node/` lock. The lock was claimed and released, and the container was run with `--rm`. Evidence is in my scratch directory, `/private/tmp/claude-501/-Users-j-git-reader/a63a32ca-c989-49a4-a04e-297a740b763a/scratchpad/baker-150/moriarty/`:
- `probe.mjs` is the probe script.
- `probe.out` is its output.

## Strikes

### Strike 1: A symlink at the destination is not replaced; its target file is overwritten (P3)
`resolveSafeRestorePath` runs `realpath` on the whole path, including the final name (`src/infrastructure/adapters/RestorePath.js#40@7a4a9e5`). `materializeFile` then makes its temporary directory beside that resolved target and renames onto the target (`src/infrastructure/adapters/materializeFile.js#22@7a4a9e5`, `#39@7a4a9e5`).

**Probe P1:** `current.bin` was a symlink to `versions/v1.bin`, and I materialized `"NEW"` to `current.bin`.
- `current.bin` is still a symlink to `versions/v1.bin`.
- `versions/v1.bin` now contains `"NEW"`.

The docs describe something else:
- The declaration says it will "atomically replace the destination" (`files.d.ts#14@7a4a9e5`).
- The API reference only says "Existing symlink **prefixes** are resolved" (`docs/API.md#1063@7a4a9e5`).

In the common layout where `current` points at an immutable version, this overwrites the old version instead of switching the pointer. It also means the temporary directory is made in whatever directory the link points into. No test covers a symlink at the final path component; the symlink tests are escape cases only (`test/unit/infrastructure/adapters/materializeFile.test.js#178@7a4a9e5`, `#194@7a4a9e5`). This is a breach of what the docs promise, not of the security boundary, because the target must still be inside the base. Not fatal.

### Strike 2: The witness was recorded at an older commit but is presented as validation of this PR (P4)
- Git history shows the files under `witness/` were changed only in `aea2dbf`. The 28 fix commits after it (from `0441642` through `7a4a9e5`) never touch them.
- At `aea2dbf`, `materializeFile.test.js` had 8 `it(` cases; at head it has 30.
- `WITNESS.md` still reports "2,252 passed", "51 passed" and "the final focused runtime sets contain 51 tests" (`docs/design/0064-reader-materialization/witness/WITNESS.md#22@7a4a9e5`, `#24-25@7a4a9e5`, `#36-38@7a4a9e5`).
- The PR body's Validation section repeats those numbers "against base `25609d6`". They actually describe `aea2dbf`.

The timing figures (2.460 s ordinary writes vs 3.295 s atomic publication) have the same problem. They were measured before head added:
- a second copy of every chunk (`materializeFile.js#125@7a4a9e5`);
- a `Promise.race` plus a fresh abort listener on every pull (`#140-158@7a4a9e5`);
- a macrotask yield after each empty chunk (`#127@7a4a9e5`).

The performance file itself only names `native_decoder_commit: 0e2717c` (`witness/performance.json#6@7a4a9e5`).
- **CONJECTURE:** the head's atomic path costs more than 3.295 s on the same corpus. Experiment: rerun the 12-trial campaign at `7a4a9e5`.

Not fatal, but the PR's evidence does not describe the code under review.

### Strike 3: The title's speed-up claim has no recorded before/after measurement (P4)
The PR leads with "Speed up JSON metadata decoding". The design doc cites "serial corpus profiling" (`reader-materialization.md#48-50@7a4a9e5`), but no profile is retained. Every row in `performance.log` (raw, atomic, atomic-sha, native) runs on code that already includes the new decoder (`performance.json#5-6@7a4a9e5`). Nothing compares JsonCodec with RuntimeJsonCodec.

My micro-benchmark (probe P5, synthetic ~2,000-entry manifest) gives 0.218 ms per decode for the runtime codec and 0.931 ms for the old one, about 4.3x faster. So the claim is probably true, but the PR does not show it.

### Strike 4: The README's "keep the session open" rule doesn't hold after cancellation (P4)
The README says "The CAS session must stay open until the helper finishes", and its example closes the session in `finally` (`README.md#115@7a4a9e5`). The API reference admits the helper asks the source to stop "without waiting for it to resume" (`docs/API.md#1080@7a4a9e5`). The code does this as a deferred `return()` whose errors are swallowed (`materializeFile.js#135@7a4a9e5`).

**Probe P3:** I aborted while the source was blocked inside a pull. The event order was:
1. The helper settled, so the README's `cas.close()` would run.
2. "source: resumed and touches the (closed) session".
3. "source: finally ran".

So the source keeps running after the call returns and after the session is closed, which the README's rule does not allow for. This is the "disclosure that hides a bigger problem" pattern: the API doc says it doesn't wait, and the README tells callers to close as soon as it returns.
- **CONJECTURE:** with a real `cas.assets.open()` source, a pull that resumes after `close()` reads from closed persistence, or starts git work after close, and the error is silently dropped. Experiment: run the README example against a real repository with a slow `cat-file` stub, abort mid-stream, and trace process spawns and errors after `close()`.

### Strike 5: After a crash, the old file may be lost as well, not just the new one (P3, CONJECTURE about the filesystem)
- The docs promise "atomic visibility" and that failures "leave an existing destination untouched" (`docs/API.md#1078@7a4a9e5`, `#1088-1089@7a4a9e5`).
- They disclose only "does not fsync, provide power-loss durability". Readers will take that to mean "the new bytes might not survive".
- The code renames without fsyncing either the file or the directory (`materializeFile.js#39@7a4a9e5`).
- **CONJECTURE:** on XFS, btrfs or ext4 with `noauto_da_alloc`, the rename can reach disk before the data does. After a crash the destination can then be empty or truncated: neither the old nor the new content, and never checked against `expectedSha256`. That is a failure of the "atomic replace" promise itself, which the word "durability" understates.
- **Experiment:** use dm-flakey or a VM snapshot and kill power right after `rename()` returns, on XFS with an existing destination. Then check whether a zero-length file appears.

### Strike 6: Small contract gaps (P5)
**Probe P2:**
- **Trailing slash:** `outputPath: 'dir-intended/'` silently creates a *file* named `dir-intended`, and `'a.bin/'` replaces the file `a.bin`. POSIX would reject both with ENOTDIR. The cause is `path.resolve`, which drops the slash (`RestorePath.js#14@7a4a9e5`).
- **Error codes:** a NUL byte in `outputPath` throws a raw `TypeError ERR_INVALID_ARG_VALUE`, and a missing base throws a raw `ENOENT`. The docs say "malformed options … use `INVALID_OPTIONS`" (`docs/API.md#1093@7a4a9e5`).
- **PR body overstatement:** the body says `materializeFile` "verifies the expected SHA-256". The check only runs when the caller passes a digest (`materializeFile.js#24@7a4a9e5`, `#35@7a4a9e5`). Without one, no extra check is made.

### Strike 7: The crash-recovery advice can't be followed (P5)
The docs say a crash can leave a private temporary directory, which the application "may reclaim after establishing that no active writer owns it" (`docs/API.md#1086@7a4a9e5`). The directory is named only `.git-cas-materialize-XXXXXX` (`materializeFile.js#22@7a4a9e5`), with no owner, PID or lock marker, and the helper exposes no way to tell whether a writer still owns it.

**Probe P4:** while streaming was in progress, a scan of the application's own directory saw `.git-cas-materialize-*` (mode 700) holding a partial `content` file. Another process cannot apply the documented rule.

## Attacks that failed (these parts hold)
- **JSON decoding parity:**
  - BOM: both decoders reject with SyntaxError.
  - CESU/WTF-8 lone surrogates: the fatal decoder rejects, the code falls back to the old decoder, and the result is identical.
  - Overlong NUL, the U+FFFF noncharacter, and escaped `\ud800`: all identical (P5).
  - The encoder never writes raw surrogates, because `JSON.stringify` escapes them, so the slow fallback path doesn't happen in practice.
  - The catch-all fallback (`RuntimeJsonCodec.js#20-25@7a4a9e5`) means any decoder failure falls back to the old path.
- **Path escape:** lexical, symlink-prefix and dangling-link escapes are all handled. A dangling final symlink is replaced as a link, because rename does not follow it. Case-insensitive aliasing of the base cannot get past both the `relative` check and the equality check (`materializeFile.js#18@7a4a9e5`; `RestorePath.js#60-63@7a4a9e5`).
- **EXDEV:** the temporary file is a sibling of the resolved destination, so the rename stays on one filesystem.
- **Destination is a directory:** EISDIR, cleaned up, no leftovers (P2).
- **Getters that change after validation, `valueOf` tricks, reused buffers, chunks from another realm, falsy errors:** all fixed at head. I could not break any of them.
- **Concurrent writers and TOCTOU:** disclosed as last-rename-wins and as "hostile concurrent replacement not covered" (`docs/API.md#1064-1065@7a4a9e5`). These are disclosed limits, not hidden ones.
- **Windows and macOS:** **CONJECTURE only.** CI runs on `ubuntu-latest` only (`.github/workflows/ci.yml#11@7a4a9e5`), so `MoveFileEx` EPERM on Windows and APFS case behaviour are untested. I couldn't test them in a Linux container.

## Resilience grade: B
No P0–P2 breaks. The code itself is solid. The gaps are in the contract and docs, plus evidence that is out of date for this head.

```
VERDICT
target: git-stunts/git-cas#150 @ 7a4a9e5 (base 25609d6)
strikes_landed: 7
  S1 P3 symlink at destination overwrites its target (versions/v1.bin), docs say "replace the destination" — not fatal
  S2 P4 witness/test counts/timings recorded at aea2dbf, presented as head validation — not fatal
  S3 P4 "speed up JSON decoding" has no before/after in evidence (my probe: ~4.3x, claim plausible) — not fatal
  S4 P4 source keeps running after abort settles; README closes the session right then — not fatal (real-source impact CONJECTURE)
  S5 P3 CONJECTURE: rename without fsync can lose old and new content after a crash; "durability" wording understates it — not fatal
  S6 P5 trailing-slash outputPath writes a file; NUL/missing base give raw errors not INVALID_OPTIONS; PR body says SHA-256 always verified — not fatal
  S7 P5 crash-leftover cleanup advice can't be followed (no owner marker) — not fatal
fatal_to_pr: no
failed_attacks: JSON parity (BOM, surrogates, overlong, fallback), path escape (lexical/symlink/dangling/case),
  EXDEV, destination-is-directory, option/chunk tampering, TOCTOU & concurrency (disclosed)
untested: Windows/macOS semantics (CI is ubuntu-only), real assets.open() after close(), power-loss
evidence: scratchpad/baker-150/moriarty/{probe.mjs,probe.out}
resilience_grade: B
```