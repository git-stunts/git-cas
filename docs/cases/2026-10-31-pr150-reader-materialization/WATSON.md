# Deposition of Dr. John Watson: first pass, blind comprehension

**Case:** git-stunts/git-cas#150, "Speed up JSON metadata decoding and add opt-in atomic file materialization"
**Evidence:** head `7a4a9e5`, base `25609d6`, read-only checkout `/Users/j/git/git-cas-reader-materialization` (verified `HEAD` = `7a4a9e5`).
**What I read:** the PR title and body; the README "Optional atomic file output" section; the new `docs/API.md` section (lines 1038–1099) plus the existing `assets.open()`, `restoreFile` and Error Codes sections that it relies on; the CHANGELOG `[Unreleased]` entries; `files.d.ts`; `package.json` exports; the whole design doc; and a skim of `witness/WITNESS.md`. I read no review threads, no comments and no `src/`, apart from the `index.d.ts` signatures that the docs point to.
**My attempt:** `/private/tmp/claude-501/-Users-j-git-reader/a63a32ca-c989-49a4-a04e-297a740b763a/scratchpad/baker-150/watson/attempt.mjs`, written from the docs alone and not run. Each `GUESS:` comment in it marks a point where the docs left me guessing.

## First impression

This is a careful, honest piece of work that tires its reader out. The author takes pains not to oversell. "Atomic" is qualified as atomic *visibility* on filesystems with atomic same-filesystem rename, with no fsync and no power-loss durability (`docs/API.md#1088-1091@7a4a9e5`). Hostile concurrent path replacement is excluded in plain words (`docs/API.md#1064-1065@7a4a9e5`). The witness admits that Bun and Deno got only focused runs (`WITNESS.md#29-30@7a4a9e5`). I give credit for all of that, because most PRs don't do it.

The API section, though, is one long run of qualifications at nearly uniform weight. The thing an adopter must know ("a rejection does not always mean the file was not published") sits mid-paragraph between remarks on falsy rejection values and buffer reuse. I read paragraph 1077–1086 three times. The design doc and witness are written for an internal "Reader librarian" workflow, and in two places they still describe themselves as *not* being a PR. They are one now.

## Could I write correct code from the docs?

Partly. The happy path is clear, and so is keeping the CAS session open (`README.md#113@7a4a9e5` together with the try/finally at `README.md#123-130@7a4a9e5`). Abort handling and integrity handling I could only *guess* at. Details follow.

- **Abort.** The docs say cancellation errors "retain their underlying runtime error forms" (`docs/API.md#1098-1099@7a4a9e5`). That doesn't tell me whether I get `signal.reason`, a `DOMException` named `AbortError`, or something else. I ended up checking for all of them. They also don't say what happens when the signal is already aborted at call time.
- **Integrity.** My own `expectedSha256` mismatch and a source-side chunk or authentication failure both arrive as `INTEGRITY_ERROR` (`docs/API.md#1097-1098@7a4a9e5`, `docs/API.md#3544@7a4a9e5`). I can't tell them apart without an undocumented `meta` shape. The Error Codes table does not list `materializeFile` as a thrower (`docs/API.md#3544@7a4a9e5`, `#3553@7a4a9e5`).
- **Where the digest comes from.** The example uses `catalog.sha256` (`docs/API.md#1047-1048@7a4a9e5`). Nothing I read tells an adopter whether git-cas itself can supply a whole-plaintext SHA-256. My guess is that it can't and the caller must keep one.

## Stumble list

1. **A rejection may come after publication.** "A later temporary-directory cleanup error can be reported after publication" (`docs/API.md#1082-1084@7a4a9e5`). In a `catch` block, the caller can't tell whether the destination was replaced, and no error code or `meta` field marks this case. It is the most consequential fact in the section, and it is buried.
2. **Abort error form is undefined.** See above (`docs/API.md#1098-1099@7a4a9e5`). The `signal` appears in the example (`#1049`) but there is no example of handling an abort.
3. **Digest mismatch and source authentication failure share a code.** Both are `INTEGRITY_ERROR`, and the `meta` for the full-file mismatch is undocumented (`docs/API.md#1097-1098@7a4a9e5`). The error metadata section documents only chunk verification (`docs/API.md#3676-3680@7a4a9e5`).
4. **The Error Codes table was not updated.** The `INTEGRITY_ERROR` and `INVALID_OPTIONS` rows do not list `materializeFile` (`docs/API.md#3544@7a4a9e5`, `#3553@7a4a9e5`), and `SECURITY_BOUNDARY_VIOLATION` appears in prose only (`#362`, `#1097`), not in the table I read.
5. **Temporary "file" or temporary "directory"?** Line 1067 says "a private, uniquely named sibling temporary file". Lines 1083 and 1085 speak of a "temporary directory". `files.d.ts#14@7a4a9e5` says "sibling temporary file", and the design doc says "private sibling directory" (`reader-materialization.md#130@7a4a9e5`). An operator asked to "reclaim" crash orphans (`docs/API.md#1085-1086@7a4a9e5`) gets no name pattern to look for and no way to tell "that no active writer owns it."
6. **The PR's headline speed-up has no number.** The title says "Speed up JSON metadata decoding". The PR body's only timings compare ordinary writes with atomic publication (2.460 s vs 3.295 s), which is a *cost*, not the speed-up. The witness tables compare modes at head, not base against head (`WITNESS.md#78-83@7a4a9e5`). The witness itself says the earlier 2.75 s figure was a single trial and "differences ... cannot all be attributed to code changes" (`WITNESS.md#94-95@7a4a9e5`). A maintainer can't verify the title's claim from what is presented.
7. **The PR body overstates verification.** It says `materializeFile` "verifies the expected SHA-256". The verification is optional, and without `expectedSha256` "there is no additional whole-file digest check" (`docs/API.md#1072-1073@7a4a9e5`). The body should say "optionally".
8. **Atomic publication's cost is absent from the user-facing docs.** The witness shows about 34% more time than ordinary writes (`WITNESS.md#80-81@7a4a9e5`). The README calls atomic output "Optional" (`README.md#111@7a4a9e5`) but never says what choosing it costs. The figure is honest; it just isn't where an adopter would see it.
9. **Choosing `restoreFile()` vs `materializeFile()`.** `restoreFile()` already stages `whole` restores and renames them (`docs/API.md#365-369@7a4a9e5`). The new section says only that the old one "keeps its contract" (`#1056-1057`). The useful distinction (other modes stream straight into the destination) appears only in the design doc (`reader-materialization.md#49-51@7a4a9e5`).
10. **When does `assets.open()` validate?** The docs say it "Validates the canonical handle ... then returns" an `AsyncIterable` (`docs/API.md#1029-1030@7a4a9e5`). Because it is called inline in the `source:` argument (`#1044`, `README.md#126@7a4a9e5`), I can't tell whether a bad handle throws before `materializeFile` runs or after the first pull. That decides whether "rejected before the source is read" (`#1062`) and the cleanup guarantees apply.
11. **0600 final mode, unexplained.** "The final file has permissions no broader than `0600`" (`docs/API.md#1081@7a4a9e5`). It's a sensible default for plaintext, but an adopter serving files to another process or user will be caught out. The docs give no rationale and no workaround (such as chmod after publication).
12. **A chunk type error is called `INVALID_OPTIONS`.** A non-`Uint8Array` chunk discovered mid-stream is not a malformed *option* (`docs/API.md#1093-1095@7a4a9e5`; repeated in `CHANGELOG.md#12@7a4a9e5`). I re-read it to make sure I hadn't misparsed.
13. **CHANGELOG "Fixed" lists a function that didn't exist before.** `materializeFile()` is new in this release, yet appears under Fixed (`CHANGELOG.md#20@7a4a9e5`). The `restoreFile()` change itself loosens a security-boundary check (`..cache` is now accepted). It is correctly framed, but the rule should be stated in API.md beside the boundary text (`#1060-1063`), not only in the changelog.
14. **The CHANGELOG Added entry is one 80-word sentence** (`CHANGELOG.md#12@7a4a9e5`). Phrases like "rejects an output path that resolves to the base directory before reading the source" are clear only once you already know the contract.
15. **Jargon in the Performance entry.** "The default JSON façade uses a runtime adapter" (`CHANGELOG.md#16@7a4a9e5`). A user reading the changelog doesn't know what the "façade" is or whether they use it. Plain words would serve: "manifest/metadata reads decode faster; no format change".
16. **Stale self-description.** The design doc says "No new external issue or PR has been created" (`reader-materialization.md#24-26@7a4a9e5`). The witness says "This is local implementation evidence, not a GitHub PR" (`WITNESS.md#119-120@7a4a9e5`). Both now sit inside PR #150. The PR body also cites a design-doc status of `draft` with `release_home: none` (`reader-materialization.md#8,11@7a4a9e5`) without saying whether the PR is meant to merge in that state.
17. **The witness is written for the wrong reader.** About a third of `WITNESS.md` (`#49-67`, `#98-112@7a4a9e5`) covers workstation Docker custody, git-locks keys and resource budgets. Those matter to the author's host, not to a git-cas maintainer. The maintainer-relevant facts (what was tested, what wasn't) are in lines 12–47 and are good.
18. **The README handle comment is slightly loose.** "`handle` is the content locator returned by an earlier cas.assets.put()" (`README.md#121@7a4a9e5`). `put()` returns a `StagedAsset`, and the handle is `staged.handle` (`README.md#93-99@7a4a9e5`, `docs/API.md#1001-1004@7a4a9e5`). It's a small point, but this is the adopter's first contact with the API.
19. **Mixed line wrapping in the API section.** Lines 1073, 1079–1080, 1085 and 1098 run long while the lines around them wrap at about 80 columns (`docs/API.md#1073,1079,1085,1098@7a4a9e5`). Late insertions read as patched-in, and that matches where I stumbled.

## What is done well (so the record is fair)

- The non-guarantees are explicit and complete: no fsync, no parent creation, no retention, no directory transaction, last-rename-wins (`docs/API.md#1082,1088-1091@7a4a9e5`; `files.d.ts#15-16@7a4a9e5`).
- "Opt-in" is accurate. It is a separate subpath (`package.json` `./files` export), and the docs state that no caller is switched (`docs/API.md#1057@7a4a9e5`).
- Destination preservation on failures before the rename is stated clearly (`docs/API.md#1077-1078@7a4a9e5`).
- The witness separates tests from timing observations and declines to call the timings a promise (`WITNESS.md#91-93@7a4a9e5`).

## Clarity grade: **B−**

The framing is honest and "atomic" is properly bounded. The happy path works from the README. The failure semantics (abort form, post-publication rejection, integrity disambiguation, orphan identification) can't be coded correctly without guessing, and the headline performance claim has no before/after measurement behind it in the PR.

```
VERDICT
witness: Dr. John Watson (first deposition, blind comprehension)
target: git-stunts/git-cas#150 @ 7a4a9e5 (base 25609d6)
clarity_grade: B-
audience_fit:
  adopter: happy path clear; abort + integrity + post-rename-rejection handling require guessing
  maintainer: contract well bounded; perf claim unwitnessed; design/witness framing stale ("not a PR")
honesty_of_framing:
  atomic: accurately qualified (visibility only, no fsync) — docs/API.md#1088-1091@7a4a9e5
  opt-in: accurate — separate subpath, no caller switched — docs/API.md#1057@7a4a9e5
  verified: overstated in PR body; optional per docs/API.md#1072-1073@7a4a9e5
  speed-up: no base-vs-head measurement presented — WITNESS.md#78-95@7a4a9e5
could_write_correct_code_from_docs: partially (happy path yes; failure paths guessed)
scratch_attempt: /private/tmp/claude-501/-Users-j-git-reader/a63a32ca-c989-49a4-a04e-297a740b763a/scratchpad/baker-150/watson/attempt.mjs
top_stumbles: [1 post-publication rejection, 2 abort error form, 3 shared INTEGRITY_ERROR, 6 unwitnessed perf headline, 5 temp file vs directory]
stumble_count: 19
repairs: deferred to recall (Repair Menu not written in this deposition)
modifications_to_target: none
```

## Second Deposition — The Repair Menu

**Witness:** Dr. John Watson, recalled.
**Target:** git-stunts/git-cas#150 @ `7a4a9e5` (base `25609d6`).

**What I read:** Holmes's testimony and Moriarty's testimony, both in full. In repair mode I also opened the parts of `src/` that the repairs depend on:
- `src/infrastructure/adapters/materializeFile.js#14-70,160-168@7a4a9e5`
- `src/infrastructure/adapters/RestorePath.js#1-30@7a4a9e5`
- `src/domain/services/AssetService.js#150@7a4a9e5`

The checkout was not modified.

### Calibration: what I checked myself before relying on it

- **CI at head, confirmed.** `gh run view 41195596162` reports `headSha 7a4a9e511d71…`, event `pull_request`, conclusion `success`. `gh pr checks 150` shows these jobs passing:
  - `lint`
  - `test-unit`
  - `test-docker (node)`, `(bun)` and `(deno)`
  
  Per `.github/workflows/ci.yml#38-66@7a4a9e5`, each `test-docker` job runs that runtime's unit suite and full integration suite, and the Deno job also runs the `file-materialization.ts` type check.
  - So Holmes's "zero Bun/Deno runs at head" is true of the *committed witness* and false of the PR.
  - D1 shrinks from "unvalidated head" to "the PR cites stale evidence when fresh evidence exists". It is cheap to repair.
  - The same run settles Holmes's UNVERIFIABLE item #10 (ESLint): the `lint` job passed at head.
- **`assets.open()` is an `async *` generator** (`src/domain/services/AssetService.js#150@7a4a9e5`). Handle validation therefore happens on the first pull, *inside* `materializeFile`, after its path checks (`materializeFile.js#15-21@7a4a9e5`). That answers my stumble 10.
- **A digest mismatch carries no `meta`.** It is thrown as `new CasError('…does not match expectedSha256', INTEGRITY_ERROR)` (`materializeFile.js#35-36@7a4a9e5`).
- **Abort produces two error shapes.** `signal.throwIfAborted()` (`#16`, `#38`) throws `signal.reason`. `pipeline(..., { signal })` (`#62`) rejects with the pipeline's own abort error. Holmes's R5 conjecture is correct in substance.
- **A cleanup failure after publication rejects.** `await rm(temporary…)` at `#45` runs after `rename` at `#39` and is not caught. On the failure path, the same `rm` swallows its error (`#42`). I found no test that pins the rejection after publication (grep of the test files).
- **Design-doc convention.** `docs/design/README.md#14@7a4a9e5` and `#92@7a4a9e5` record each doc's *revision number and SHA-256*. Revising either document means bumping `document_revision` and `updated` in its frontmatter and updating the matching README line and hash.

### Fatality

I agree with Moriarty: **none of S1–S7 is fatal.** The nearest is S1, the destination-symlink overwrite, because it can silently destroy a file the caller thought was immutable. It cannot escape the base directory, though, and documentation plus a test fixes the contract cheaply. I rate it **merge-blocking but not fatal**. The code is sound. What needs repair is the contract around its edges and the evidence trail.

---

### The Menu (ordered by yield per effort)

Type tags: CODE, TEST, DOC, EVIDENCE, PR-BODY.
**Gate** = I'd want it done before merge. **In-PR** = belongs in #150. **Follow-up** = a separate issue, because it would widen scope or change already-released behaviour.

#### R-1 · PR-BODY · S · Gate · In-PR
**Replace the Validation section with evidence from head, and fix three phrases.**
- Validation: "CI at head `7a4a9e5` ([run 41195596162](https://github.com/git-stunts/git-cas/actions/runs/41195596162)) passed lint, the Node unit suite, and unit plus integration suites on Node, Bun and Deno, including the Deno type check of `test/types/file-materialization.ts`. The committed witness records an earlier candidate (`aea2dbf`, decoder commit `0e2717c`) and is kept as the design-cycle record, not as head validation."
- "verifies the expected SHA-256" becomes "optionally verifies a caller-supplied SHA-256".
- "the final twelve-trial performance campaign" becomes "a four-mode, three-repetition timing campaign (12 runs) recorded at `aea2dbf`".
- "profiling showed dominated member resolution" becomes "local profiling found UTF-8 conversion a substantial share of member resolution". This matches `reader-materialization.md#48-49@7a4a9e5`.

**Closes:** Holmes D1, D4, D5 (wording), #10; Moriarty S2 (validation half) and S6c; my stumbles 7 and 16 (PR-body half).

#### R-2 · DOC + TEST · S · Gate · In-PR
**Document and pin the behaviour of a symlink at the final path component.**
- `docs/API.md`, after `#1063@7a4a9e5`, add: "If `outputPath` names an existing symlink inside the base, the helper follows it: the link's *target* file is replaced and the link itself is left unchanged. To repoint a link, remove or replace the link yourself; do not materialize onto it."
- `files.d.ts#14@7a4a9e5`: change to "Stream to a private sibling temporary file, then atomically replace the destination file (an existing symlink's target, not the link)."
- TEST: in `materializeFile.test.js`, next to the escape cases at `#178`/`#194`, add a case where `current.bin` is a link to `versions/v1.bin`. Assert that the link is unchanged and that `v1.bin` holds the new bytes. This is Moriarty's P1 turned into a test.

**Closes:** Holmes R1; Moriarty S1.
**Follow-up F-6:** an opt-in "replace the link, not the target" mode, if Reader wants pointer-swap layouts.

#### R-3 · CODE + TEST + DOC · S · Gate · In-PR
**Make the promise resolve if and only if the file was published.**
- CODE: change `materializeFile.js#45@7a4a9e5` to `await rm(temporary, { recursive: true, force: true }).catch(() => {});`. The failure path already does this (`#42`), and leftover private directories are already documented.
- DOC: in `docs/API.md#1082-1084@7a4a9e5`, replace "Rename is the publication point; a later temporary-directory cleanup error can be reported after publication." with "Rename is the publication point. The promise resolves only after the file is published; any rejection means the destination was not replaced. A cleanup failure after publication is not reported and can leave the private temporary directory behind (see below)."
- TEST: stub `rm` to fail after the rename and assert that the call resolves and the destination holds the new bytes.
- **Alternative**, if the author wants cleanup errors kept visible: return `{ bytesWritten, cleanupError? }` rather than rejecting. Don't leave it as it is now. This is a new, unreleased API, so now is the cheap moment to change it.

**Closes:** my stumble 1 (the most consequential one). Scratch-attempt trap at `attempt.mjs` "throw err" comment.

#### R-4 · CODE + TEST + DOC · S · Gate · In-PR
**Make cancellation reject with one shape.**
- CODE: in `writeStaged`'s catch (`materializeFile.js#63-65@7a4a9e5`), add `if (!sourceFailure && signal?.aborted) throw signal.reason;` before the existing rethrow.
- TEST: abort mid-pipeline with a custom reason and assert `rejects.toBe(reason)`. Do the same for an abort before the call and an abort after the stream completes but before the rename.
- DOC: replace "cancellation and filesystem errors retain their underlying runtime error forms" (`docs/API.md#1098-1099@7a4a9e5`) with "Cancellation rejects with `signal.reason` (an `AbortError` `DOMException` when `abort()` is called without a reason). Filesystem errors keep their runtime form (`err.code` such as `ENOENT`, `EISDIR`)."

**Closes:** my stumble 2; Holmes R5.

#### R-5 · CODE + DOC · S · In-PR
**Give the digest mismatch its own `meta`.**
- CODE: at `materializeFile.js#36@7a4a9e5`, pass `{ check: 'expectedSha256', expected: expectedSha256.toLowerCase(), actual }`.
- DOC: under the Error Metadata heading near `docs/API.md#3676@7a4a9e5`, add a block "**INTEGRITY_ERROR (materializeFile expectedSha256):** `{ check: 'expectedSha256', expected, actual }`". Then add one sentence in the materialization section: "Source-side chunk or authentication failures also use `INTEGRITY_ERROR` and carry the source's own `meta` (for example `chunkIndex`); `meta.check === 'expectedSha256'` identifies the whole-file comparison."

**Closes:** my stumble 3.

#### R-6 · DOC · S · Gate · In-PR (plus Follow-up F-2)
**Make the README's session-lifetime rule honest about abort.**
- In `README.md#113-115@7a4a9e5`, after "The CAS session must stay open until the helper finishes:", add: "After cancellation or a write failure the helper settles without waiting for a blocked source to stop, so the source may still be finishing one pull when `close()` runs; that late pull's result is discarded."
- Mirror the sentence at `docs/API.md#1079-1080@7a4a9e5`.
- **Follow-up F-2 (EVIDENCE then CODE):** run Moriarty's experiment from his testimony: a real `assets.open()` source, a slow `cat-file` stub, abort mid-stream, then trace process spawns and errors after `close()`. If a late pull does work after close, fix it in `close()` or `assets.open()` draining, not in the file helper. That fix is outside this PR's coherent scope.

**Closes:** Moriarty S4 (the documentation part). The real-source impact remains conjecture until F-2 runs.

#### R-7 · DOC · S · Gate · In-PR (plus Follow-up F-3)
**State the crash consequence instead of a vague "durability".**
- Replace `docs/API.md#1088-1089@7a4a9e5` ("It does not fsync, provide power-loss durability,") with: "It does not fsync the file or its directory. Atomic visibility holds while the system stays up. After a power loss or OS crash the destination may hold the old file, the new file, or, on some filesystems and mount options, an empty or truncated file; `expectedSha256` is not rechecked. Applications that need crash durability should verify the file on next use or flush it themselves. It also does not create parents,…"
- **Follow-up F-3 (CODE):** an opt-in `durable: true` that fsyncs the staged file before the rename and the directory after it. Moriarty's dm-flakey experiment would be the evidence for that issue.

**Closes:** Moriarty S5 (the wording; the filesystem behaviour itself is still conjecture, as he labelled it).

#### R-8 · DOC · S · In-PR (plus Follow-up F-4)
**Use one name for the staging artifact and make the reclaim advice usable.**
- In `docs/API.md#1067@7a4a9e5`, change "writes a private, uniquely named sibling temporary file" to "writes into a private (mode `0700`), uniquely named sibling directory `.git-cas-materialize-XXXXXX` next to the destination".
- Replace `#1085-1086@7a4a9e5` with: "A crash can leave such a directory behind. It carries no owner marker, so reclaim `.git-cas-materialize-*` directories only when your application knows no materialization into that directory can be running, for example at start-up under the application's own lock."
- Apply the same wording to `files.d.ts#14` and `reader-materialization.md#130` (the latter via R-15).
- **Follow-up F-4 (CODE):** an owner marker or a reclaim helper.

**Closes:** my stumble 5; Moriarty S7.

#### R-9 · DOC · S · In-PR
**Update the Error Codes table.**
- Add `materializeFile()` to the "Thrown By" cell of the `INTEGRITY_ERROR` row (`docs/API.md#3544@7a4a9e5`) and of the `INVALID_OPTIONS` row (`#3553@7a4a9e5`).
- Add a `SECURITY_BOUNDARY_VIOLATION` row: "Output path escapes, or names, the base directory | `restoreFile()`, `materializeFile()`". The row was already missing before this PR; adding it is a one-line courtesy.
- Rephrase `#1093-1095` so that "a source chunk that is not a `Uint8Array`" reads as "the `source` option yielded a non-`Uint8Array` chunk". That makes the use of `INVALID_OPTIONS` intelligible.

**Closes:** my stumbles 4 and 12.

#### R-10 · DOC (CHANGELOG) · S · In-PR
**Restructure the `[Unreleased]` entries.**
- **Added** (`CHANGELOG.md#12@7a4a9e5`): split the single 80-word sentence into a lead plus bullets:
  - "`materializeFile()` in the new `@git-stunts/git-cas/files` subpath streams a byte source into a private sibling file and renames it into place on success."
  - "Supports `AbortSignal` cancellation and an optional whole-file `expectedSha256`."
  - "Rejects escaping paths and the base directory itself (`SECURITY_BOUNDARY_VIOLATION`) before reading the source."
  - "Rejects a non-`AbortSignal` `signal` and non-`Uint8Array` chunks with `INVALID_OPTIONS`."
  - "Core byte-stream and buffer APIs are unchanged."
- **Performance** (`#16`): "Manifest and other JSON metadata reads use the runtime's native UTF-8 decoder (`TextDecoder`) by default. Stored encoding is unchanged; malformed bytes, BOMs, and runtimes without `fatal` decoding (for example Node built without ICU) fall back to the existing portable decoder. The exported `JsonCodec` is unchanged."
- **Fixed** (`#20`): "`restoreFile()` now accepts output names beginning with two dots, such as `..cache`; only `..` itself and paths beginning with `..` plus a separator are treated as escapes. (`materializeFile()` applies the same rule.)"

**Closes:** my stumbles 13, 14 and 15; Holmes R4.

#### R-11 · CODE + TEST + DOC · S–M · In-PR (scoped to `materializeFile`) (plus Follow-up F-1)
**Input hygiene in the new helper only.**
- In `validateOptions`, reject with `INVALID_OPTIONS`:
  - an `outputPath` ending in a path separator;
  - an `outputPath` or `baseDirectory` containing `\0`.
- Wrap the `ENOENT` from `realpath` on a missing base (`materializeFile.js#18@7a4a9e5` / `RestorePath.js#15@7a4a9e5`) as `INVALID_OPTIONS` with `{ baseDirectory }`. Do this in `materializeFile`, not in `RestorePath`, so `restoreFile()` stays unchanged.
- Add a test per case.
- If the author prefers not to change code, the minimum DOC fix is to say at `docs/API.md#1093` that "a missing base directory and invalid path strings surface as runtime filesystem/argument errors".
- **Follow-up F-1:** the same hygiene for `restoreFile()`, which is a behaviour change to a released API and needs its own changelog entry.

**Closes:** Moriarty S6a and S6b.

#### R-12 · DOC · S · In-PR
**Small adopter-facing clarifications.**
- After `docs/API.md#1057@7a4a9e5`, add: "Choose `materializeFile()` when every restore mode must publish atomically. `restoreFile()` stages only `whole` restores; other modes stream directly into the destination."
- After `#1055`: "`assets.open()` validates the handle on first pull, so handle errors (`HANDLE_TARGET_MISSING`, `HANDLE_CODEC_MISMATCH`) reject the `materializeFile()` call after its path checks."
- At `#1081`: "The final file has mode `0600` (plaintext may be sensitive); `chmod` it after the call resolves if other users or services must read it."
- In `README.md#121@7a4a9e5`, change "`handle` is the content locator returned by an earlier cas.assets.put()" to "`handle` is `staged.handle` from an earlier `cas.assets.put()`".
- Reflow `docs/API.md#1073,1079,1085,1098` to the surrounding ~80-column wrap.

**Closes:** my stumbles 9, 10, 11, 18 and 19.

#### R-13 · TEST · S · In-PR
**Assert the 0600 mode** with `(await stat(dest)).mode & 0o777` equal to `0o600` on POSIX, skipped on Windows. The docs promise it, and today only the code backs that promise (Holmes table, `materializeFile.js#57@7a4a9e5`).

**Closes:** Holmes's 0600-untested note.

#### R-14 · EVIDENCE or PR-BODY · S (retitle) / M (benchmark) · Gate (one of the two) · In-PR
**Back the speed-up in the title, or stop claiming it.**
- **Cheap option:** retitle to "Use native UTF-8 decoding for JSON metadata and add opt-in atomic file materialization".
- **Better option:** commit a small reproducible micro-benchmark (for example `bench/json-decode.mjs`) that decodes a synthetic ~2,000-entry manifest with `JsonCodec` and with `RuntimeJsonCodec`, record the author's own numbers in the witness, and say "local, synthetic". Moriarty measured about 4.3x (0.931 → 0.218 ms), which suggests the claim is true. His figure belongs in his testimony, though, not in the PR as the author's evidence.

**Closes:** Moriarty S3; Holmes D5; my stumble 6.

#### R-15 · DOC/EVIDENCE · M · Gate (minimal form) · In-PR
**Revision 2 of the design doc and the witness, following the repo's own convention.**
- **Design doc** (`reader-materialization.md`):
  - Set `document_revision: 2` and update `updated`.
  - Replace `#24-26@7a4a9e5` ("No new external issue or PR has been created…") with "Implemented in git-stunts/git-cas#150; not yet released."
  - At `#126`, change "normally propagated" to "propagated unchanged, including falsy values".
  - Add one sentence to the error contract on base-directory rejection, the chunk-type check, the `signal` brand check, the ICU fallback and the `..cache` fix.
  - Mirror R-2, R-3, R-4 and R-8.
- **Witness:** bump to revision 2 and add a top section, "Scope of this record: the logs and timings below were produced at candidate `aea2dbf` (decoder `0e2717c`). Head `7a4a9e5` adds 26 commits; head validation is CI run 41195596162 (lint, Node unit, Node/Bun/Deno unit + integration, Deno type check). Timings have not been re-measured at head." Change "not a GitHub PR" at `WITNESS.md#119-120@7a4a9e5` accordingly.
- **Index:** update both lines in `docs/design/README.md#14,#92@7a4a9e5` with "revision 2" and the new SHA-256 values. Leave `witness/manifest.json` alone unless the logs change.
- **Optional:** move the workstation-custody section (`WITNESS.md#49-67,98-112`) under a "Local resource custody" appendix heading. It is accurate; it just isn't what a maintainer needs first.

**Closes:** Holmes D3, plus the labelling halves of D1 and D2; Moriarty S2 (timings label); my stumbles 16 and 17.

#### R-16 · EVIDENCE · L · Optional; Follow-up acceptable
**Re-time the four-mode campaign at `7a4a9e5`.** Head added a per-chunk copy, a per-pull `Promise.race` with a listener, and an empty-chunk yield (`materializeFile.js#125,127,140-158@7a4a9e5`). The timing is not a correctness gate once R-15 labels the existing numbers honestly. It needs the private corpus and workstation budget, so it can be a follow-up without leaving main broken.

**Closes:** Holmes D2 and Moriarty S2 in full (the timing half).

---

### Follow-up issues (not in #150)

| ID | Type | Effort | Subject | Source |
|---|---|---|---|---|
| F-1 | CODE+TEST | S | Trailing-slash / NUL / missing-base hygiene for released `restoreFile()` | S6 |
| F-2 | EVIDENCE→CODE | M | Does a real `assets.open()` pull do work after `cas.close()` following an abort? | S4 |
| F-3 | CODE+TEST | M | Opt-in `durable: true` (fsync file + directory), with crash-injection evidence | S5 |
| F-4 | CODE | M | Owner marker or reclaim helper for `.git-cas-materialize-*` orphans | S7, stumble 5 |
| F-5 | CI | M | Windows/macOS coverage for rename/EPERM/case behaviour; until then, add "CI-tested on Linux" to API.md | Moriarty "untested" |
| F-6 | CODE | S–M | Opt-in "replace the symlink itself" mode | S1 |

### No action

- **Holmes R2** (yield on empty chunk) and **R3** (options snapshotted once): internal, harmless and tested where it matters (`materializeFile.test.js#52@7a4a9e5`). Documenting them would add weight to a section that already carries too much.
- **Stumble 8** (the cost of atomic publication isn't stated in the README): only partly addressed through R-15 and R-16. I'd add no README number until R-16 produces a head figure. Quoting a stale 34% would repeat D2.

### Coverage check (every finding mapped)

| Finding | Repair(s) |
|---|---|
| Watson 1 | R-3 |
| Watson 2 | R-4 |
| Watson 3 | R-5 |
| Watson 4 | R-9 |
| Watson 5 | R-8 |
| Watson 6 | R-14 |
| Watson 7 | R-1 |
| Watson 8 | R-15, R-16 (deferred, see No action) |
| Watson 9 | R-12 |
| Watson 10 | R-12 |
| Watson 11 | R-12, R-13 |
| Watson 12 | R-9 |
| Watson 13 | R-10 |
| Watson 14 | R-10 |
| Watson 15 | R-10 |
| Watson 16 | R-1, R-15 |
| Watson 17 | R-15 (optional) |
| Watson 18 | R-12 |
| Watson 19 | R-12 |
| Holmes D1 | R-1, R-15 |
| Holmes D2 | R-15, R-16 |
| Holmes D3 | R-15 |
| Holmes D4 | R-1 |
| Holmes D5 | R-1, R-14 |
| Holmes R1 | R-2 |
| Holmes R2 | none |
| Holmes R3 | none |
| Holmes R4 | R-10 |
| Holmes R5 | R-4 |
| Holmes #10 (ESLint) | closed by CI, cited in R-1 |
| Moriarty S1 | R-2, F-6 |
| Moriarty S2 | R-1, R-15, R-16 |
| Moriarty S3 | R-14 |
| Moriarty S4 | R-6, F-2 |
| Moriarty S5 | R-7, F-3 |
| Moriarty S6 | R-11, R-1, F-1 |
| Moriarty S7 | R-8, F-4 |

None of the in-PR repairs touches released behaviour. Each changes only the unreleased `materializeFile` contract, its docs, or the evidence. Taken together they still form one coherent PR, and main stays working after merge. The changes that would alter `restoreFile()`, `close()` or durability semantics are left to their own issues.

The PR is a sound piece of engineering with an untidy paper trail. Most of the bill is S-sized prose. The three small code changes (R-3, R-4, R-5) are worth making *now*, while the API is unreleased and changing it is free.

```
VERDICT
witness: Dr. John Watson (second deposition, Repair Menu)
target: git-stunts/git-cas#150 @ 7a4a9e5 (base 25609d6)
fatal_findings: none (agree with Moriarty); S1 rated merge-blocking, not fatal
calibration:
  ci_at_head: verified — run 41195596162 headSha 7a4a9e5, lint + test-unit + test-docker node/bun/deno (unit+integration, Deno type check) all pass
  holmes_D1_adjusted: "zero Bun/Deno at head" true of witness only; repair is citation, not re-run
merge_gate_repairs: [R-1 PR-BODY S, R-2 DOC+TEST S, R-3 CODE+TEST+DOC S, R-4 CODE+TEST+DOC S, R-6 DOC S, R-7 DOC S, R-14 retitle-or-bench S/M, R-15 DOC/EVIDENCE M (minimal labeling)]
in_pr_recommended: [R-5 S, R-8 S, R-9 S, R-10 S, R-11 S-M, R-12 S, R-13 S]
optional_or_followup_ok: [R-16 L]
follow_up_issues: [F-1 restoreFile hygiene, F-2 source-after-close experiment, F-3 durable mode, F-4 orphan owner marker, F-5 Windows/macOS CI, F-6 replace-link mode]
no_action: [Holmes R2, Holmes R3]
coverage: Watson 1-19, Holmes D1-D5 + R1-R5 + #10, Moriarty S1-S7 — all mapped
estimated_total_in_pr_effort: ~1 day (mostly S prose; three S code changes; one M doc revision)
post_repair_clarity_grade_projection: A- (contingent on R-3, R-4, R-2, R-15)
modifications_to_target: none
```