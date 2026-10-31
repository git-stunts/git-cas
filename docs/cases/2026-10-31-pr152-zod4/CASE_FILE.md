# Case File: PR #152, zod 4 upgrade

| | |
|---|---|
| **Case** | git-stunts/git-cas#152, "chore(deps): upgrade zod to 4" (closes #151) |
| **Date** | 2026-10-31 |
| **Subject artifact** | branch `chore/zod-4` at head `1c5aced` |
| **Evidence shas** | head `1c5aced`; base and merge-base `25609d6` (origin/main) |
| **Libraries examined** | zod 4.6.7 and zod 3.25.76, read from `git-cas-test-node:latest` |
| **Detectives** | Holmes (verification), Watson (comprehension, blind then recalled), Moriarty (falsification) |
| **Cross-examination** | Not run |

⚠️ ALL VERDICTS HEREIN ARE VALID ONLY FOR THE COMMITS ABOVE.

## Executive Deduction

The most consequential finding is in the PR's documentation, not its code. The CHANGELOG's error-wording claim names the wrong case. Holmes and Moriarty traced the same zod 4 mechanism independently: when the encryption scheme matches but a field such as `kdf.iterations` or `keyVersion` holds a non-integer, the error collapses to `Invalid input`, while truly unmatched schemes are unchanged. The runtime held under 3,312 differential cases, with no acceptance change beyond the disclosed safe-integer limit. The CHANGELOG still needs repair before merge: it files a breaking change for `./schema` consumers under "Changed", overclaims what the CI type check catches, and omits the new global `z.config` coupling.

## Report Card

| Dimension | Detective | Grade | Basis |
|---|---|---|---|
| Fidelity | Holmes | **B+** | 17 claims confirmed, 3 drifts (D1–D3), 5 reverse drifts |
| Clarity | Watson | **B** | PR body A−; CHANGELOG C+; title C |
| Resilience | Moriarty | **B** | 6 strikes landed (two P4, four P5), none fatal. These attacks failed: stored-data edge values, custom messages, the error-shape contract callers rely on, `nodeModulesDir`, and the `.d.ts` generics. |
| **Overall** | Front office | **B** | No fatal strike. Runtime parity is strong. The account of the change is what falls short, and consumers read that account. |

## Adjudication

**A1. Encryption errors lose their specific message** (Holmes D1 and reverse drift 5; Moriarty S1).
The two reached the same root cause independently: zod 3 marks a failed int check as dirty, while zod 4 aborts the branch, so the union falls through to `invalid_union`. **Ruling: CONFIRMED, and established by convergence.**
Watson's correction is accepted. `Manifest.js#44@1c5aced` builds the user-facing text from `i.message` alone, so field paths never reached users even under zod 3. What they lose is the specific message (`Expected integer, received float`), not a field name.
Severity: **P4 documentation drift**. The code stays as it is in this PR; a follow-up restructure is filed as R6.

**A2. "Declaration drift … fails CI"** (Holmes D2; Moriarty S5 and S4; Watson stumble 9).
Three detectives attacked this line independently:
- Only six inferences are guarded; the check catches 3 of 5 constraint errors.
- The zod it checks against floats, because no `deno.lock` is committed.
- The assertions miss a `ZodDefault` → `ZodOptional` mistype.
- The line is internal to CI, not consumer-facing.

**Ruling: CONFIRMED overclaim.** Delete the bullet (R1), strengthen the fixture (R4), and file the lockfile and strict checks as follow-ups (R5, R8).

**A3. "Schema types were silently `any`"** (Holmes D3).
**Ruling: CONFIRMED drift, and the error was the front office's own.** The PR author (the front office's own session) wrote the claim before measuring it. Holmes measured `IsAny` as false: the types were unresolved, and parse output degraded to `unknown`. The commit message carries the wrong word, and so does the PR body, so the squash message must correct it (R3).

**A4. Host `z.config` now reaches git-cas errors** (Moriarty S2).
Demonstrated by `evidence/moriarty/probe3.out`. **Ruling: CONFIRMED and undisclosed. P4.**
Watson's position is accepted: document it now, and evaluate isolation later at low priority (R7). Isolation would be partial at best, and some hosts may want localized errors.

**A5. Safe-integer limit on stored data** (Moriarty S3; Holmes #5; Watson stumble 3).
**Ruling: CONFIRMED, disclosed, P5.** The CHANGELOG should list the affected fields and state the read-path consequence (R1, R2).

**A6. Two zod majors installed, and a heavier import** (Holmes reverse drift 1; Moriarty S6).
**Ruling: CONFIRMED.** Moriarty measured import and load at about 4× slower (about 20 ms against 5 ms). His claim that `index.js` loads both majors stays **CONJECTURE**. It goes in the disclosure (R3); moving plumbing to zod 4 is a follow-up (R9).

**A7. Semver** (Watson's recommendation is a major; the PR leaves it to the maintainer).
**Ruling: the recommendation is adopted, and the decision stays with the maintainer.** `./schema` is a public export (`package.json#13@1c5aced`). Its runtime objects no longer compose with zod 3, and its declared generics change. No local consumer imports it. That reduces the practical risk; it does not change the classification.

**A8. Deno cache hazard** (Holmes item 18).
**Ruling: no action in this PR.** Errors are not cached, so the PR's RED evidence is not affected. The author's RED runs also used fresh `compose run --rm` containers.

**Rejected or withdrawn:**
- Moriarty withdrew his getter-divergence finding himself. It was a probe artifact.
- He also corrected his own `distinct module` probe label. Both corrections are recorded in his testimony.

## The Repair Menu (Watson's, re-ordered by adjudication)

**Before merge (this PR):**
1. **R1** (CHANGELOG, S). Rewrite `[Unreleased]`:
   - Split it into Breaking Changes and Changed.
   - Scope who is affected by the `./schema` change.
   - List the safe-integer fields.
   - Correct the encryption-wording claim.
   - Add the `z.config` note and the two-zods note.
   - Delete the CI bullet.
   - *Covers A1, A2, A4, A5, A6.*
2. **R3** (PR body and title, S):
   - Correct D1 and D3.
   - Add a "Not covered" section.
   - Explain the RED arithmetic.
   - Add the semver recommendation.
   - Add `!` to the title if the release is major.
   - Fix the squash message.
3. **R4** (TEST, S): five more type assertions, with RED evidence from mistyping `keyLength`.
4. **R2** (UPGRADING.md, S): an "if this, then that" table for consumers.
5. **R5** (CI, M): a `skipLibCheck: false` check for `ManifestSchema.d.ts` only. *Optional here; otherwise a follow-up.*

**Follow-up issues (not this PR):**
- **R6:** add issue paths to the `Manifest` and `Chunk` error text (higher yield); separately, turn `EncryptionSchema` into a discriminated union.
- **R8:** pin zod for the Deno type check.
- **R9:** move plumbing to zod 4, after verifying the double-load conjecture.
- **R7:** evaluate isolating git-cas from host `z.config` (low priority).

Full wording for each item is in `WATSON.md`, under "Second Deposition — The Repair Menu".

## Ship Verdict

**REQUIRES INVESTIGATION.** The code and dependency change is sound. Merge after R1, R3 and R4. R2 is strongly recommended, and R5 is optional.

## Chain-of-custody notes

**Environment and probes**
- All probes ran in the existing project images (`git-cas-test-node`, `-deno`, `-bun`). Each run used `--network none`, memory and CPU limits, and a 600 s alarm, under lock `host/docker/git-cas-test-node/`. No containers were left behind.
- Probe scripts and outputs are preserved under `evidence/holmes/` and `evidence/moriarty/`, about 650 KB in total.
- Moriarty's `out-diffs.json` (395 KB) records every differential case.
- The testimonies cite session scratch paths; the same files are in `evidence/`.

**Errors and corrections**
- **Front-office conflict of interest:** this session authored PR #152. The detectives worked blind to the author's reasoning, apart from what the PR body states. Finding A3 is the author's own error.
- **Moriarty's self-corrections:** his getter false alarm and the misleading `distinct module` label were both withdrawn in his own testimony, and are preserved there.
- **Holmes's partial verification:** item 21 (2 RED failures on zod 3) was confirmed by arithmetic and probe; the RED suite was not re-run. Items 22 (local Docker runs) and 23 (#150 conflict) are UNVERIFIABLE as he testified.

**Not covered**
- JSR publishing of the `./schema` types.
- Bundle size.
- A CSP / `new Function` experiment (Moriarty surrendered this vector).
- The double-load conjecture.
- Whether a per-parse error map outranks a host `customError`.

**Posting**
- The three testimonies were posted to #152 as PR comments before this case file existed, at the user's request.
- Watson's second deposition and this case file were posted afterwards.
