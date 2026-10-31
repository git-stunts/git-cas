# Deposition of Dr. John Watson: First Pass, Blind Comprehension

**Matter:** git-stunts/git-cas#152, "chore(deps): upgrade zod to 4" (closes #151). Head `1c5aced`, base `25609d6`.

**What I read:** the PR title and body, issue #151, the commit message, `CHANGELOG.md` lines 1–40 at head plus the 6.0.0 "Breaking Changes" section (lines 429–450), the diff of all seven files, and the `exports` block in `package.json`. I did not read any review comments, bot output or zod internals. I ran no tests and changed nothing in the checkout.

---

## 1. The short of it

This is a tidy, well-evidenced PR with an honest author. The PR body is the best document here. It names every behaviour change, gives RED and GREEN evidence, and openly says "Decide at release whether that needs a major version" (PR body). The maintainer gets the semver question handed over plainly. I count that a virtue: the author doesn't pretend the question is settled.

The trouble is that the consumer never sees that hedge. The CHANGELOG is the only document a downstream reader will see, and it files everything under `### Changed` (`CHANGELOG.md#10@1c5aced`). The project has a `### Breaking Changes` heading on record (`CHANGELOG.md#431@1c5aced`, under 6.0.0), and the entry never says either "breaking" or "not breaking". The PR's one reassuring sentence, "This affects only consumers that build on these schema objects" (PR body), never reached the CHANGELOG. So the consumer gets the warning without the reassurance, and the maintainer's open question is silently resolved in the changelog as "Changed".

## 2. Reading as the maintainer: merge, and how to version?

- **Can I tell what changed?** Yes. The PR body's "Change" and "Behaviour changes" sections are separate and plain. The diff matches the description: three generic swaps in `ManifestSchema.d.ts` (`src/domain/schemas/ManifestSchema.d.ts#18@1c5aced`, `#78@1c5aced`, `#102-103@1c5aced`), one line in `test/types/deno.json#2@1c5aced`, type assertions, and three unit tests.
- **Is the evidence credible?** Yes. The RED rows are specific: "3 errors: KDF enum, compression enum, chunking discriminated union" and "2 failed, 29 passed" (PR body). They also match the issue's acceptance check, "fails against the zod 3 declarations" (issue #151). The Deno skip count differs (12 vs 3), and the PR explains it before I could ask: "main also skips 12" (PR body). Good.
- **A small RED discrepancy.** The PR says the safe-integer RED run had 2 failures. The diff adds 3 tests, one of which is an "accepts MAX_SAFE_INTEGER" case (`test/unit/domain/value-objects/Manifest.test.js#350@1c5aced`). 2 of 3 failing on zod 3 is exactly what you'd expect, so this adds up. But a reader has to work that out; nobody says it. A minor re-read.
- **Semver.** I'm left with a real decision and not enough facts to make it alone. The PR frames the `./schema` change as conditional. The CHANGELOG states it without condition. The safe-integer tightening is presented as a behaviour change, not judged for breakage. My conjecture: a manifest already stored with a value above 2^53 would now fail to read. The documents never say whether that can happen in practice. I had to guess.
- **Title.** `chore(deps):` usually tells a maintainer "nothing user-facing". The body lists three user-facing behaviour changes, and there is no `!` marker. Conjecture: if release tooling or a skimming maintainer keys off conventional-commit types, the title understates the PR. This is the first place the framing undersells.
- **Merge note.** The warning about `[Unreleased]` conflicts with #150 (PR body) is useful and considerate.

## 3. Reading as a downstream consumer: do I need to change anything?

This is my attempt to answer from the CHANGELOG alone, as a consumer would.

| My situation | What the CHANGELOG tells me | What I had to guess |
|---|---|---|
| I use only the main API (`.`) | Error text changes where no custom message is set (`CHANGELOG.md#12@1c5aced`). Integers above `MAX_SAFE_INTEGER` are rejected. | **Which** "integer fields"? Size, chunk size, iterations, cost, version? It isn't listed. Could my existing stored manifests stop reading? Not said. |
| I match on error strings | Clear. One example of the new wording, and the `Invalid manifest data:` and `Invalid chunk data:` prefixes are kept (`CHANGELOG.md#12@1c5aced`). | Nothing. This is the best-written part. |
| I import `@git-stunts/git-cas/schema` and only call `.parse` / `.safeParse` | "Compose these schemas with zod 4; zod 3 schemas cannot contain them" (`CHANGELOG.md#13@1c5aced`). | Whether **I** am affected at all. The PR body's "affects only consumers that build on these schema objects" would answer this, but it isn't in the CHANGELOG. |
| I compose these schemas into my own zod 3 schemas | Clear: I must move to zod 4. | Whether my project needs its own zod 4 install. `zod` is a plain dependency, not a peer dependency (`package.json#118-121@1c5aced`). Conjecture: two zod copies could coexist in my tree. Not discussed. |
| I use TypeScript and write the exported types in my own annotations (e.g. `ZodEnum<[...]>`) | "its type declarations use zod 4 generics" (`CHANGELOG.md#13@1c5aced`). | That my hand-written annotations will break. It's implied, not stated. |
| I don't touch CI | Bullet 3 (`CHANGELOG.md#14@1c5aced`) is about the project's own Deno type check. | Why it's in my changelog at all. It's internal and doesn't concern me. |

**My verdict as a consumer:** I can tell *that* I might be affected, and roughly *why*. I can't confidently tell *whether* I am, and there's no "if X, do Y" line. `UPGRADING.md` exists, and the 6.0.0 entry points to it (`CHANGELOG.md#448@1c5aced`), but this entry gives no migration pointer.

## 4. Prose and structure

- Line 12 opens with "Manifest and chunk validation keep their schemas and custom messages," then at once says "Integer fields now reject values…" (`CHANGELOG.md#12@1c5aced`). The reassurance is contradicted in the next sentence, and I re-read it to work out what "keep their schemas" meant. I take it to mean "the schema source is unchanged", which the PR body says more clearly: "need no source change" (PR body).
- Line 12 is a single 80-word bullet holding four separate facts. They need splitting.
- The phrase "a value that matches no encryption scheme reports only `Invalid input`" (`CHANGELOG.md#12@1c5aced`) is an honest note of worse diagnostics. Credit for not hiding it. But it doesn't say whether a consumer loses information they relied on.
- The tone throughout is calm, precise and free of puffery. The commit message is a model of its kind. It explains the silent-`any` bug in the Deno check ("so schema types were silently any") in one parenthesis.

---

## VERDICT

```
WITNESS:        Dr. John Watson (first deposition, blind comprehension)
TARGET:         git-stunts/git-cas#152 @ 1c5aced (base 25609d6)
CLARITY GRADE:  B
  PR body:        A-  (complete, honest, evidence-backed; semver hedge stated openly)
  Commit message: A
  CHANGELOG:      C+  (accurate but unscoped; loses the PR's audience qualifier;
                       "Changed" heading quietly answers the open semver question)
  Title:          C   ("chore" understates three user-facing behaviour changes)
HONESTY OF FRAMING: Honest in the PR; under-framed in the title and CHANGELOG.
                    Nothing false found. The risk is omission, not misstatement.
CONSUMER CAN ANSWER "Do I need to change anything?": PARTIALLY.

STUMBLES:
 1. Title `chore(deps):` with no `!` signals non-user-facing; body lists 3
    behaviour changes. (PR title)
 2. CHANGELOG files all under `### Changed` (CHANGELOG.md#10@1c5aced) though the
    project has a `### Breaking Changes` precedent (CHANGELOG.md#431@1c5aced);
    the PR's "Decide at release" hedge does not show to CHANGELOG readers.
 3. "Integer fields" is unenumerated; I couldn't tell which fields or whether
    existing stored manifests could fail to read. (CHANGELOG.md#12@1c5aced) [stored-data risk is conjecture]
 4. "keep their schemas" is followed at once by a rule tightening; I had to
    re-read it. (CHANGELOG.md#12@1c5aced)
 5. Line 12 is one overloaded bullet with four facts. (CHANGELOG.md#12@1c5aced)
 6. The PR's scoping sentence "affects only consumers that build on these
    schema objects" is missing from the CHANGELOG, so parse-only `./schema`
    users can't rule themselves out. (PR body vs CHANGELOG.md#13@1c5aced)
 7. Nothing tells TypeScript consumers that their own annotations using the old
    generic shapes will break; it's only implied. (CHANGELOG.md#13@1c5aced)
 8. No word on whether consumers need their own zod 4 install; zod is a
    regular dependency, not a peer. (package.json#121@1c5aced) [effect is conjecture]
 9. CI-internal bullet in the consumer CHANGELOG. (CHANGELOG.md#14@1c5aced)
10. No UPGRADING.md pointer or "if X, do Y" guidance, unlike the 6.0.0
    precedent. (CHANGELOG.md#448@1c5aced)
11. Minor: "2 failed" RED vs 3 added tests; it adds up (one is an accept case),
    but the reader has to check. (PR body; Manifest.test.js#350@1c5aced)

STRENGTHS ON RECORD:
 - Specific RED/GREEN evidence that matches issue #151's acceptance checks.
 - Error-wording change is concrete, with an example and the preserved prefixes.
 - Degraded diagnostic ("only `Invalid input`") is disclosed, not hidden.
 - Merge-conflict note re #150.

REPAIRS: withheld per charter; available on recall.
```

## Second Deposition: The Repair Menu

**Matter:** git-stunts/git-cas#152 @ `1c5aced`, base `25609d6`.

**What I read for this deposition:** both testimonies in full, `src/domain/schemas/ManifestSchema.js#1-140@1c5aced`, `src/domain/value-objects/Manifest.js#36-48@1c5aced`, `src/domain/services/ManifestRepository.js#315-321@1c5aced`, the type fixture at lines 165–175, `ci.yml#62`, and the section headings of `UPGRADING.md`. I changed nothing in the checkout and posted nothing.

### Before the menu: three things I found while reading

1. **Nobody's strike is fatal, and I agree.** Holmes found no false runtime claim. Moriarty ran 3,312 cases and the only change in what is accepted is the one the PR already discloses (Moriarty, "Attacks attempted and failed"). Everything below is repair to the *account* of the change, plus some test-strength gaps. None of it is a defect that should block the merge.
2. **S1 is smaller than it sounds.** Moriarty says users lose the field name. But `Manifest.js#44@1c5aced` builds its error text from `i.message` alone and never includes `i.path`. So under zod 3 the user already saw `Invalid manifest data: Expected integer, received float` with no field name. What changes is that message becoming `Invalid input`. The *issue* loses its path, but the *user-facing text* never had one. That is a real loss, but a narrower one.
3. **Independent convergence (the strongest evidence in the file):**
   - **Encryption-union message collapse.** Holmes D1 and reverse drift 5 (zod 3's dirty int check versus zod 4's abort, `v4/core/schemas.js#1223-1241@zod-4.6.7`) and Moriarty S1 (`checks.js#103-110`, `schemas.js#1230-1240@zod-4.6.7`, 24 fuzzed cases). They reached the same mechanism by different routes. Treat it as established.
   - **Safe-integer read path.** My stumble 3, Holmes #5 and Moriarty S3 all point at the same thing.
   - **Two zod majors.** Holmes reverse drift 1 and Moriarty S6 both cite `pnpm-lock.yaml#1172-1175@1c5aced`.
   - **`CHANGELOG.md#14@1c5aced` is attacked three ways:**
     - Holmes D2: only six inferences are guarded, so 3 of 5 constraint errors are caught.
     - Moriarty S5: the zod version under test is not the locked one.
     - My stumble 9: the line is internal to the project and not consumer-facing.

     Three independent objections to one line. Delete it.

---

### The menu, ordered by yield per unit of effort

#### R1. CHANGELOG: replace `[Unreleased]` lines 10–14. Type DOC/CHANGELOG, effort S. This PR.

This one repair covers my stumbles 2–7 and 9, Holmes D1, D2 and reverse drifts 1, 3 and 4, Moriarty S1, S2 and S3 (documentation side), and the dependency half of S6.

Replace `CHANGELOG.md#10-14@1c5aced` with the following. The maintainer chooses the first heading at release (see R3); the bullets are correct either way.

```markdown
### Breaking Changes

- **`@git-stunts/git-cas/schema` exports zod 4 schemas.** git-cas now depends on `zod` `^4.6.7` (was `^3.24.1`). If you only call `.parse()` or `.safeParse()` on these schemas, you need no change. If you embed them in your own schemas (for example `z.object({ chunk: ChunkSchema })`, `.extend()` or a union), use zod 4; zod 3 schemas cannot contain them. TypeScript annotations that spell out the old generics must use the zod 4 forms, for example `z.ZodEnum<{ gzip: "gzip" }>` instead of `z.ZodEnum<["gzip"]>`. See [UPGRADING.md](./UPGRADING.md).
- **Integer fields reject values above `Number.MAX_SAFE_INTEGER`.** This applies to every integer field in manifests and chunks, including `size`, `index`, `chunkCount`, `startIndex`, `frameBytes`, `keyVersion` and the KDF parameters. zod 3 accepted larger values. A stored manifest that holds one now fails to load with `Invalid manifest data:`; there is no fallback.

### Changed

- **Default error wording follows zod 4.** Messages that git-cas sets are unchanged, and errors keep their `Invalid manifest data:`, `Invalid chunk data:` and `Sub-manifest … contains invalid chunk data:` prefixes. Text that came from zod's defaults now uses zod 4 wording, for example `Invalid input: expected number, received string` (was `Expected number, received string`) and `Invalid input: expected string, received undefined` (was `Required`). The sub-manifest error embeds zod's issue dump, whose fields also changed. Match on the prefix, not the wording.
- **A non-integer in an encryption integer field now reports only `Invalid input`.** When `scheme` matches but a field such as `kdf.iterations`, `frameBytes` or `keyVersion` holds a fraction or ±Infinity, zod 3 reported `Expected integer, received float`; zod 4 reports `Invalid input`. Encryption metadata that matches no scheme reported `Invalid input` before and still does.
- **Your zod 4 configuration reaches git-cas errors.** zod 4 keeps its configuration global. If your application calls `z.config()` to set a locale or an error map, git-cas's default error wording follows it. Messages that git-cas sets are unaffected.
- `@git-stunts/plumbing` still depends on zod 3, so installs contain both zod 3 and zod 4.
```

Notes on R1:
- **Line 14 (the Deno check bullet):** deleted, not reworded. It is internal (my stumble 9), it overclaims (Holmes D2), and it is checked against a version that isn't locked (Moriarty S5). The accurate account goes in the PR body (R3).
- **The field list in the safe-integer bullet** comes from the `.int()` fields at `ManifestSchema.js#29-30,43-47,57,66,80,108,116-118,132-133,138@1c5aced`. The phrase "including …" keeps it honest if I've missed one.
- **The wording examples** (`Required`, the issue-dump fields) are Holmes's measurements (reverse drifts 3 and 4). I have not re-run them.

#### R2. UPGRADING.md: add a section above line 5. Type DOC, effort S. This PR.

This covers my stumbles 6, 7, 8 and 10. The convention is set by `UPGRADING.md#5@1c5aced` ("## v6.5.9 To v6.5.10"). Replace `<next>` with the release version.

```markdown
## v6.5.12 To <next>

git-cas now uses zod 4. Find your case:

| You… | Do this |
|---|---|
| Use only the main API (`@git-stunts/git-cas`) | Nothing, unless you match on error text. Match on the `Invalid manifest data:` / `Invalid chunk data:` prefix, not the words after it. |
| Call `.parse()` / `.safeParse()` on `@git-stunts/git-cas/schema` exports | Nothing. git-cas brings its own zod 4. |
| Embed those schemas in your own (`z.object`, `.extend`, unions) | Upgrade your code to zod 4. A zod 3 schema cannot contain them and throws `keyValidator._parse is not a function`. |
| Write the schema types out in TypeScript | Use zod 4 generics: `z.ZodEnum<{ a: "a" }>`, and `z.ZodDiscriminatedUnion<[...options], "key">` with the options first. |
| Store integers above 2^53 − 1 in a manifest | Such manifests no longer load. No real file approaches this size; other integer fields hold counts and parameters. |
```

The error string in row 3 is Holmes's measurement (#8). Row 5's "no real file" is Moriarty's judgement in S3 that 9 PiB is implausible. I adopt it as a judgement, not a verified fact.

#### R3. PR body, title and squash message. Type PR-BODY, effort S. This PR.

This covers my stumbles 1, 2 and 11, Holmes D1, D2, D3 and reverse drifts 1, 2 and 6, and the performance half of Moriarty S6.

- **Title** (`PR title`): if the release is major, use `chore(deps)!: upgrade zod to 4`. Otherwise keep the title and add a line to the body: "Not a chore for `./schema` composers; see Behaviour changes."
- **Body, Behaviour changes, bullet 2:** replace "A value that matches no encryption scheme reports only `Invalid input`" with: "When the encryption `scheme` matches but an integer field holds a fraction or ±Infinity, the error is now only `Invalid input` (zod 3: `Expected integer, received float`). Unmatched schemes already reported `Invalid input`."
- **Body, Change, bullet 3, and the commit message:** replace "silently `any`" with "silently unresolved: parse output degraded to `unknown`, and `skipLibCheck` hid the missing import" (Holmes #15).
- **Add a "Not covered" section:**
  - "The type fixture asserts six inferences; declaration drift elsewhere is not caught (with zod 3 declarations: 3 of 5 constraint errors)."
  - "The Deno check resolves `zod ^4.6.7` without a lockfile."
  - "`@git-stunts/plumbing` keeps zod 3, so both majors install. `@git-stunts/vault` moves from zod 4.3.6 to 4.6.7 through deduplication."
  - "Loading the schema module takes about 20 ms against about 5 ms on zod 3 (Moriarty's measurement)."
  - "JSR and bundle size are not examined."
- **Evidence table:** after "2 failed, 29 passed", add "(the 2 'rejects' tests fail; the 'accepts MAX_SAFE_INTEGER' test passes on both)".
- **Semver, with my recommendation stated:** "Recommend a major. `./schema` is a public export (`package.json#13@1c5aced`); its runtime objects stop composing with zod 3 and its declared generics change. Both are backward-incompatible under SemVer 2.0. A minor is defensible only if the maintainer declares composition outside the public contract, and then the CHANGELOG must still say so." The decision belongs to the maintainer. The PR currently hands over the question without the facts, and this adds them.
- **Squash message:** the maintainer should apply the D3 wording when squashing, so the integration commit doesn't carry the "any" claim into history.

#### R4. Strengthen the type fixture. Type TEST, effort S. This PR.

This covers Moriarty S4 and part of Holmes D2. Add after `test/types/public-api-compatibility.ts#172@1c5aced`, and extend the imports and `void` list to match:

```ts
const kdfKeyLengthOutput: Equal<z.infer<typeof KdfSchema>['keyLength'], number> = true;
const encryptedDefaultsTrue: Equal<z.infer<typeof EncryptionSchema>['encrypted'], true> = true;
const manifestVersionInput: Equal<z.input<typeof ManifestSchema>['version'], number | undefined> = true;
const chunkShape: Equal<z.infer<typeof ChunkSchema>, { index: number; size: number; digest: string; blob: string }> = true;
const subManifestRefShape: Equal<z.infer<typeof SubManifestRefSchema>, { oid: string; chunkCount: number; startIndex: number }> = true;
```

- **Acceptance check:** Moriarty's experiment. Mistype `ManifestSchema.d.ts#24` as `ZodOptional` and `deno check --config test/types/deno.json` must fail. This is RED/GREEN evidence for the PR body.
- **Caveat:** the exact object shapes are my reading of `ManifestSchema.js#28-33,130-134@1c5aced`. Confirm them on first run; adjust the expected type, not the assertion's intent.

#### R5. Declaration-constraint check with `skipLibCheck: false`. Type CI, effort M. Include if cheap, otherwise a follow-up issue.

This covers the rest of Holmes D2.
- **What to add:** a second `deno check` in `ci.yml#62@1c5aced` against a fixture that imports only `ManifestSchema.d.ts`, with its own config setting `"skipLibCheck": false`. Holmes's `only.ts` is the model: it gives 0 errors on head and 5 with the zod 3 declarations.
- **Why it can't just be switched on:** the full fixture fails under `skipLibCheck:false` on unrelated `index.d.ts` exports (Holmes #13).
- **Scope:** because R1 deletes the overclaim, this is no longer needed to make the PR truthful. It still meets the intent of issue #151 ("A CI type check fails when the declarations drift") more fully. If it lands in this PR, the R3 "Not covered" line shrinks.

#### R6. Follow-up issue: encryption union diagnostics (Moriarty S1). Type CODE, effort M. Follow-up.

**Should this PR fix S1 in code?** No. A file-and-defer.
- **The candidate fix:** `EncryptionSchema = z.discriminatedUnion('scheme', [...])` at `ManifestSchema.js#93-97@1c5aced`. Every branch has a literal `scheme` (lines 70, 78, 86), so the restructure is eligible.
- **It changes the public `./schema` export.** The runtime class and the declared type (`ZodUnion` → `ZodDiscriminatedUnion`) both change.
- **It changes the unmatched-scheme error**, the one case the PR says is unchanged.
- **It needs Moriarty's differential fuzzer re-run** to show acceptance parity.
- **It breaks the issue's own boundary:** issue #151 excludes "schema rule changes beyond those that zod 4 itself introduces".
- **Cost in this PR:** M, and it puts a schema restructure inside a dependency bump. Doing so breaks "one coherent PR".
- **Conjecture:** a zod 4 discriminated union would report the selected branch's own issues. The experiment is Moriarty's 24 `union-masking.out` cases against the restructured schema.

**A second follow-up with higher yield:** include `i.path.join('.')` in the messages built at `Manifest.js#44@1c5aced` and `Chunk.js#30@1c5aced`. It names the field for *every* error, not only encryption ones. It is independent of zod's version and a better diagnostic than zod 3 ever gave. File it as its own issue, with the `cool-ideas` label if the project uses one.

#### R7. Follow-up issue: isolating git-cas from host zod config (Moriarty S2). Type CODE, effort M. Follow-up, low priority.

My recommendation is to document now (R1 does) and evaluate later.
- **How isolation might work (conjecture, not verified):** pass a per-parse error customizer pinned to the English locale at the three internal parse sites (`Manifest.js`, `Chunk.js`, `ManifestRepository.js#317`). Whether zod 4's per-parse `error` outranks a host's global `customError` must be tested first. That is Moriarty's `probe3.mjs` with the customizer added.
- **Even if it works, isolation is partial:**
  - It cannot isolate `jitless` or the `postProcessor` hook (Moriarty, `core.js#106-108@zod-4.6.7`).
  - It cannot help `./schema` consumers who parse themselves.
- **There's a case for leaving it:** a host that sets a German locale may *want* git-cas's errors in German.

Yield is modest and the behaviour is arguably a feature. It doesn't belong in this PR.

#### R8. Follow-up issue: pin the Deno type check's zod (Moriarty S5). Type CI, effort S–M. Follow-up.

- **Problem:** there is no committed `deno.lock`, and `Dockerfile#54-57@1c5aced` installs from `package.json`.
- **Fix:** commit a lockfile for the type check, or install it from the pnpm-resolved tree.
- **Why a follow-up:** the problem predates this PR. R1 removes the PR's claim that depended on it.

#### R9. Follow-up issue in plumbing: move `@git-stunts/plumbing` to zod 4 (Moriarty S6, Holmes reverse drift 1). Type CODE, effort M. Follow-up.

- **Why it waits:** issue #151 excludes it explicitly.
- **What it buys:** it ends the two-major install.
- **First, check the conjecture:** Moriarty's double load at `index.js` import is unverified. Run his `--cpu-prof` experiment before claiming the cost.

---

### Every finding, mapped

| Finding | Repair / disposition |
|---|---|
| My stumble 1 (title "chore") | R3 |
| My stumble 2 (no Breaking heading; hedge lost) | R1, plus R3 semver recommendation |
| My stumble 3 (integer fields not listed; stored data) | R1 bullet 2, R2 row 5 |
| My stumble 4 ("keep their schemas" contradiction) | R1 (sentence removed) |
| My stumble 5 (overloaded bullet) | R1 (split into four) |
| My stumble 6 (parse-only scoping lost) | R1 bullet 1, R2 row 2 |
| My stumble 7 (TypeScript annotations) | R1 bullet 1, R2 row 4 |
| My stumble 8 (zod not a peer dependency) | R2 row 2. **No action** on making it a peer: that would force every consumer to install zod, which is a larger breaking change than this PR. |
| My stumble 9 (CI bullet in CHANGELOG) | R1 (deleted) |
| My stumble 10 (no UPGRADING pointer) | R2 |
| My stumble 11 (2 failed versus 3 tests) | R3 |
| Holmes D1 | R1 bullet 4, R3 (converges with Moriarty S1) |
| Holmes D2 | R1 deletion, R3 "Not covered", R4, R5 |
| Holmes D3 | R3 body and squash message |
| Holmes reverse drift 1 (two zods) | R1 last bullet, R3, R9 |
| Holmes reverse drift 2 (vault 4.3.6 → 4.6.7) | R3 only. **No CHANGELOG action:** it is a transitive patch-level move, invisible to consumers. |
| Holmes reverse drift 3 (sub-manifest issue dump) | R1 bullet 3 |
| Holmes reverse drift 4 (other wording changes) | R1 bullet 3 (`Required` example; the general statement covers the rest) |
| Holmes reverse drift 5 | Same as D1 / S1 |
| Holmes reverse drift 6 (JSR, bundle size) | R3 "Not covered". **No action:** neither was measured; nothing to repair on no evidence. |
| Holmes item 18 (Deno cache hazard) | **No action in this PR:** Holmes confirms the PR's RED run is unaffected, because errors aren't cached. Worth one line in the project's testing notes ("take Deno 'before' evidence in a fresh container"). That is a separate doc change, not a fix to this PR. |
| Moriarty S1 | R1 bullet 4 (now), R6 (follow-up) |
| Moriarty S2 | R1 bullet 5 (now), R7 (follow-up, low priority) |
| Moriarty S3 | R1 bullet 2, R2 row 5. **No code action:** disclosed, and the data is implausible. I agree with his P5. |
| Moriarty S4 | R4 |
| Moriarty S5 | R1 deletion, R3, R8 |
| Moriarty S6 | R1 last bullet, R3 timing note, R9 |

---

## VERDICT

```
WITNESS:         Dr. John Watson (second deposition, repair menu)
TARGET:          git-stunts/git-cas#152 @ 1c5aced (base 25609d6)
FATAL FINDINGS:  none. I concur with Holmes (B+) and Moriarty (no fatal strike).
MERGE BLOCKERS:  none in code. The account of the change (CHANGELOG, PR body) should be
                 repaired before merge, because the CHANGELOG is what consumers read.

IN THIS PR (one coherent PR; all S effort unless noted):
  R1  DOC/CHANGELOG  Rewrite [Unreleased]: Breaking/Changed split, scoped audiences,
                     corrected encryption wording (D1/S1), host z.config note (S2),
                     dual-zod note; delete the overclaiming CI bullet (D2/S5)
  R2  DOC            UPGRADING.md "v6.5.12 To <next>" table: who's affected, what to do
  R3  PR-BODY        Fix D1/D3 wording, add "Not covered", RED arithmetic, semver
                     recommendation (major); title "!" if major; fix squash message
  R4  TEST           Five more type assertions; RED check by mistyping keyLength
  R5  CI (M)         skipLibCheck:false check for ManifestSchema.d.ts only.
                     Optional here, else a follow-up.

FOLLOW-UP ISSUES (not this PR):
  R6  CODE (M)   EncryptionSchema -> discriminatedUnion('scheme'); separately, include
                 issue paths in Manifest/Chunk error text (higher yield)
  R7  CODE (M)   Evaluate per-parse error isolation from host z.config. Low priority;
                 partial at best; arguably a feature.
  R8  CI (S-M)   Pin zod for the Deno type check (no deno.lock); predates this PR
  R9  CODE (M)   Plumbing to zod 4 (excluded by #151); verify the double-load
                 conjecture first

S1 CODE FIX IN THIS PR?  No. Document now, restructure in a follow-up (cost here: M,
                         changes the public ./schema export, breaks #151's exclusion).
                         Note: the user-visible text never carried field paths
                         (Manifest.js#44@1c5aced); the loss is the specific message.
S2 CODE FIX IN THIS PR?  No. Document now. Isolation is partial (jitless/postProcessor
                         stay global; ./schema users unaffected by any fix) and of
                         modest value.

CONVERGENCE:     D1 ≡ S1 (independent mechanisms, same cause), established.
                 Safe-int read path (Watson 3, Holmes #5, Moriarty S3).
                 Dual zod (Holmes RD1, Moriarty S6).
                 CHANGELOG#14 attacked three independent ways; delete it.

SEMVER:          Recommend major. ./schema is a public export and changes
                 incompatibly in runtime composition and declared types.
                 Maintainer decides.
CLARITY AFTER R1-R4 (projected): A-
```