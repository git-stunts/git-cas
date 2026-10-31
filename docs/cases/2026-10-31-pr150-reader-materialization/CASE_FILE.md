# Case File: PR #150, Reader materialization

| | |
|---|---|
| **Case** | git-stunts/git-cas#150: "Speed up JSON metadata decoding and add opt-in atomic file materialization" |
| **Date** | 2026-10-31 |
| **Subject artifact** | branch `feat/reader-materialization` at head `7a4a9e5` |
| **Evidence shas** | head `7a4a9e5`, base and merge-base `25609d6` (origin/main) |
| **Detectives** | Holmes (verification), Watson (comprehension, blind and then recalled), Moriarty (falsification) |
| **Cross-examination** | Not run (`--cross-examine` was not requested) |

⚠️ ALL VERDICTS HEREIN ARE VALID ONLY FOR THE COMMITS ABOVE.

## Executive deduction

The single most consequential finding is a symlink problem, found independently by Holmes and Moriarty. If `outputPath` names an existing symlink, the helper follows it and overwrites the link's target. The docs instead promise to "replace the destination". The code is otherwise sound: no P0–P2 breaks, and every documented API claim checked out against head. What lets the PR down is its paper trail. The witness, test counts and timings describe candidate `aea2dbf`, which is 27 commits behind head. The headline "speed up" also has no before/after measurement.

## Report card

| Dimension | Detective | Grade | Basis |
|---|---|---|---|
| Fidelity | Holmes | **B−** | User-facing docs match head. The evidence layer is stale (D1–D5) and there are undocumented behaviours (R1–R5). |
| Clarity | Watson | **B−** | Honest framing. Failure paths can't be coded without guessing. |
| Resilience | Moriarty | **B** | 7 strikes landed, none fatal, highest P3. 8 attack classes failed, which certifies JSON parity, path escape, EXDEV and option tampering. |
| **Overall** | Front office | **B−** | No fatal strike, so no C cap. The weakest dimensions set the grade: the PR can't be trusted on its own evidence, and an adopter can't handle its failures from the docs. |

## Adjudication

**A1. A symlink at the destination overwrites its target.**
- Found by: Holmes R1 and Moriarty S1, independently.
- Severity: Watson rates it merge-blocking, not fatal.
- **Ruling: CONFIRMED and merge-blocking.**
  - The two detectives converged blind, and Moriarty's probe P1 reproduces it (`evidence/probe.out`).
  - It is not a boundary escape, since the target must still be inside the base, so it is not fatal.
  - The repair is documentation plus a test (R-2). A link-swap mode is follow-up F-6.

**A2. The validation is stale (Holmes D1, Moriarty S2).**
- Holmes said Bun and Deno had "**zero** runs" at head. **Ruling: this overstates it.**
  - GitHub Actions run 41195596162 at `7a4a9e5` passed lint, test-unit, and test-docker (unit + integration) on Node, Bun and Deno. Watson verified this and the front office re-checked it.
  - D1 therefore stands only as citation drift: the PR body and witness present the `aea2dbf` numbers as the PR's validation.
  - The same run settles Holmes item 10 (ESLint): **CONFIRMED** at head through CI.

**A3. The speed-up is not evidenced (Holmes D5, Moriarty S3, Watson 6).**
- All three detectives raised it.
- **Ruling: CONFIRMED as an evidence gap, not as a false claim.**
  - Moriarty's synthetic micro-benchmark shows a gain of about 4.3x, so the claim is plausible.
  - That figure comes from a probe, not from the author's evidence.
  - The fix is R-14: retitle the PR or commit a reproducible benchmark.

**A4. A rejection can come after publication (Watson 1).**
- Holmes confirmed the code at `materializeFile.js#45@7a4a9e5`, where the post-rename `rm` is not caught.
- **Ruling: CONFIRMED and merge-blocking.**
  - A caller can't tell from a rejection whether the destination was replaced.
  - The API is unreleased, so R-3, which makes rejection mean "not published", costs almost nothing now.

**A5. Cancellation errors come in two shapes (Watson 2, Holmes R5).**
- Holmes offered this as conjecture. Watson confirmed it by reading the code: `throwIfAborted` and the pipeline's abort error produce different errors.
- **Ruling: CONFIRMED.** Repair R-4.

**A6. The source keeps running after the helper settles, and the README then says to close (Moriarty S4).**
- **Ruling: CONFIRMED** for the helper's ordering (probe P3).
- **CONTESTED / UNRESOLVED** for the real-source impact. Nobody has shown that a real `assets.open()` pull does harmful work after `close()`.
- Documentation fix R-6 now. The real-source experiment is follow-up F-2.

**A7. Crash durability (Moriarty S5).**
- **Ruling: the wording gap is CONFIRMED. The filesystem behaviour stays CONJECTURE**, as Moriarty labelled it.
- Repair R-7 (wording) now. Durable mode is follow-up F-3.

**A8. The PR body says "verifies the expected SHA-256" (Watson 7, Moriarty S6c).**
- The two converged.
- **Ruling: CONFIRMED overstatement.** The check only runs when the caller supplies a digest. Repair R-1.

**A9. Smaller findings.**
- Moriarty S6a/b: trailing slash, NUL byte and missing-base error codes.
- Moriarty S7: orphan reclamation.
- Watson 3–5 and 9–19.
- Holmes D3, D4 and R4.
- **Ruling:** all accepted as Watson mapped them.
- Holmes R2 and R3 are accepted as **no action**: internal, harmless and tested.

## The repair menu, re-ordered by adjudication

**Gate items: do these before merge**
1. **R-2** (DOC + TEST, S): document the destination-symlink behaviour and pin it with a test. *A1*
2. **R-3** (CODE + TEST + DOC, S): resolve if and only if published, and swallow the post-rename cleanup error. *A4*
3. **R-1** (PR-BODY, S): replace Validation with CI run 41195596162; change to "optionally verifies"; fix the "twelve-trial" and "dominated" wording. *A2, A8*
4. **R-4** (CODE + TEST + DOC, S): cancellation rejects with `signal.reason`. *A5*
5. **R-14** (PR-BODY or EVIDENCE, S/M): retitle, or commit a reproducible decode micro-benchmark. *A3*
6. **R-6** (DOC, S): README note that the source may still finish one pull after the helper settles. *A6*
7. **R-7** (DOC, S): state the crash consequence plainly. *A7*
8. **R-15**, minimal form (DOC/EVIDENCE, M): design doc and witness revision 2, scoped to `aea2dbf`, plus updated hashes in `docs/design/README.md`. *A2*

**Recommended in this PR**
- **R-5:** `meta` on digest mismatch.
- **R-9:** Error Codes table.
- **R-10:** CHANGELOG restructure.
- **R-8:** one name for the staging directory, plus usable reclaim advice.
- **R-12:** adopter clarifications.
- **R-13:** a test for the 0600 mode.
- **R-11:** input hygiene for `materializeFile` only.

**Optional**
- **R-16:** re-time the four-mode campaign at head.

**Follow-up issues (not #150)**
- F-1: `restoreFile()` input hygiene.
- F-2: real-source behaviour after `close()`.
- F-3: opt-in `durable: true`.
- F-4: owner marker for orphan directories.
- F-5: Windows/macOS CI.
- F-6: a mode that replaces the link itself.

The full wording of every repair is in `WATSON.md`, under "Second Deposition — The Repair Menu".

## Ship verdict

**REQUIRES INVESTIGATION.** The PR is sound once the named gate repairs (R-1, R-2, R-3, R-4, R-6, R-7, R-14 and minimal R-15) are made. None of the in-PR repairs changes released behaviour.

## Chain-of-custody notes

**Probes and resources**
- All probes ran in the existing `git-cas-test-node:latest` image (Node v22.23.4), under lock `host/docker/git-cas-test-node/`, with `--network none`, 2 GiB memory, 2 CPUs, a 600 s alarm and `--rm`.
- The image's `/app` matched head. The front office checked this by comparing a SHA-1 of `materializeFile.js`; Holmes compared SHA-256.
- No containers were left behind (checked afterwards).
- **The image contains no Bun or Deno.** The detectives could not probe those runtimes; only CI covers them.

**Detective errors (preserved here, not erased)**
- **Holmes:** "Bun and Deno have never run on head" is wrong for CI (see A2). It is true only of the committed witness.
- **Moriarty:** counted "28 fix commits after `aea2dbf`". `git rev-list --count aea2dbf..7a4a9e5` gives 27 commits, 26 of them `Fix:`. Holmes's "26 fix commits" is correct.
- **Watson:** first deposition, stumble 10 (when `assets.open()` validates) was answered in the second deposition by reading `src/domain/services/AssetService.js#150@7a4a9e5`. That is a legitimate post-blind check, and it is disclosed.

**Scope not covered**
- Windows and macOS filesystem semantics.
- Real power-loss behaviour.
- A real `assets.open()` source after `close()`.
- Re-timing at head.
- Bun/Deno behaviour beyond CI's pass/fail.
- The PR review threads, read by no detective, by design.

**Paths in the testimonies**
- The testimonies cite session scratch paths, preserved verbatim. Those artifacts are copied into `evidence/`:
  - `probe.mjs` and `probe.out` (Moriarty)
  - `focused-head.log` (Holmes)
  - `watson-attempt.mjs` (Watson)
