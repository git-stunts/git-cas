# Testimony of Sherlock Holmes: Verification Pass on git-stunts/git-cas#152

Watson, most of this PR checks out. The schemas run the same on zod 4 for every valid input I tried, and the type declarations match the runtime. Its counts are honest, and its RED evidence reproduces. Three of its claims go further than the evidence: one about encryption error wording, one about how much drift CI now catches, and one about the old Deno check making schema types `any`. It also leaves several consequences unmentioned.

**Method.** I made no changes to `/Users/j/git/git-cas-zod4`, and it was still clean when I finished. All probes ran in the existing images under the git-locks store, with `--network none`, 2 GiB of memory, 2 CPUs and a 600 s alarm. No container was left behind. The probe scripts and their raw output are in `/private/tmp/claude-501/-Users-j-git-reader/a63a32ca-c989-49a4-a04e-297a740b763a/scratchpad/baker-152/holmes/`:
- `probe.mjs` → `probe.out`: zod 3.25.76 and zod 4.6.7 run side by side on the same `ManifestSchema.js` source, 32 cases.
- `deno*.sh` → `deno*.out`: Deno 2.7.1 checks.
- `mirror.ts`: a field-by-field comparison of the declarations against the runtime types.

## I. Runtime claims

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | "The runtime schemas need no source change" | **CONFIRMED** | `ManifestSchema.js` is absent from the diff. In `probe.out`, every valid case gives identical output on both zods: defaults, the `kdf.keyLength` default of 32, `encrypted` defaulting to true, `version` defaulting to 1 (including an explicit `undefined`), unknown keys stripped, and explicit-`undefined` keys kept in the same order. |
| 2 | `import z from 'zod'` still works | **CONFIRMED** | `node_modules/zod/index.js#7@zod-4.6.7` (`export { z, z as default }`), used at `src/domain/schemas/ManifestSchema.js#6@1c5aced` |
| 3 | `ZodError` / `.issues` handling in Chunk.js and Manifest.js still works | **CONFIRMED** | `src/domain/value-objects/Manifest.js#43-44@1c5aced`, `src/domain/value-objects/Chunk.js#29-30@1c5aced`. The probe throws `Error: Invalid manifest data: …`, so the `instanceof` check catches zod 4 errors. |
| 4 | "Custom messages are unchanged" | **CONFIRMED** | The digest regex message, the refine messages (`nonce must decode to 12 bytes`) and the Git OID message are identical on both. The `.refine({message})` option and a string message passed to regex both still work. Oddly, the discriminator message is also unchanged (`Invalid discriminator value. Expected 'fixed' \| 'cdc'`); only its issue code changed. |
| 5 | Integer fields reject values above `MAX_SAFE_INTEGER`, which zod 3 accepted | **CONFIRMED** | `node_modules/zod/v4/core/checks.js#127@zod-4.6.7` and `v4/core/util.js#402@zod-4.6.7` (`safeint`). zod 3 accepts `2**60`; zod 4 gives `Too big: expected int to be <=9007199254740991`. |
| 6 | Example wording `Invalid input: expected number, received string` | **CONFIRMED** | Measured exactly (`size_string`) |
| 7 | "A value that matches no encryption scheme reports only `Invalid input`", listed as a behaviour change | **DRIFT** | See below. |
| 8 | Composing with zod 3 fails | **CONFIRMED** | `z3.object({x: S4.ChunkSchema})` throws `TypeError keyValidator._parse is not a function`. `z4.object(...)` and `.extend` work. |

**Item 7.** Wherever the input truly matches no scheme, zod 3 already reported `Invalid input`. That covers a missing scheme, a bad scheme, a missing nonce, a framed object with a nonce, `encrypted:false` and a bad KDF algorithm: all six cases are identical. What actually changed is narrower and goes unmentioned. When the scheme matches but an integer field holds a fraction, zod 3 gave a specific message and zod 4 collapses it to `Invalid input`:

- `keyVersion: 1.5` and `frameBytes: 1.5`: zod 3 said `Expected integer, received float`, zod 4 says `Invalid input`.
- The cause: zod 3 treated a failed int check as non-fatal (`v3/types.js#1087-1096@zod-3.25.76`, `status.dirty()`), so its union surfaced that option's issues (`#2279-2289`). zod 4 aborts on it, so `handleUnionResults` (`v4/core/schemas.js#1223-1241@zod-4.6.7`) falls through to `invalid_union`.
- Refine failures, by contrast, still report their specific message on zod 4 (`enc_whole_noncanonical_nonce`).

## II. Type-declaration claims

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 9 | `ZodEnum` takes an object map | **CONFIRMED** | `v4/classic/schemas.d.ts#600@zod-4.6.7`; `src/domain/schemas/ManifestSchema.d.ts#18,78@1c5aced` |
| 10 | `ZodDiscriminatedUnion` takes the options before the discriminator | **CONFIRMED** | `v4/classic/schemas.d.ts#548@zod-4.6.7` (`<Options, Disc extends string>`); `ManifestSchema.d.ts#101-104@1c5aced`. `mirror.ts` shows the declared type is exactly identical to the type inferred from the runtime code. |
| 11 | `ZodObject` without a config parameter, plus `ZodUnion`, `ZodDefault`, `ZodArray`, `ZodLiteral`, `ZodOptional`, `ZodUndefined` | **CONFIRMED** | `v4/classic/schemas.d.ts#486,533,662,471,621,643,432@zod-4.6.7`. `deno5.out` shows input and output types equal for all 10 exports, against the declarations and against runtime code copied into TypeScript. |
| 12 | Every declared schema matches the runtime JS, field by field | **CONFIRMED (one cosmetic difference)** | Input and output are equal for all 10 schemas, and the export sets match (10 exports in the JS; the `keyof` check passes). The one difference: the runtime `z.union` uses `const T` (`schemas.d.ts#538`), so it infers a `readonly` tuple where the `.d.ts` declares a mutable one (`ManifestSchema.d.ts#38-74`). `Equal<RO, Readonly<DO>>` passes. Inferred types are unaffected. |
| 13 | GREEN: `ManifestSchema.d.ts` passes with `skipLibCheck: false` | **CONFIRMED** | `only.ts` exits 0. With the zod 3 declarations the same check gives 5 TS2344 errors. The full fixture fails with `skipLibCheck:false`, but on unrelated `index.d.ts` exports, and the claim is scoped to the one file. |

## III. Deno check claims

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 14 | Under the base config, `zod` was unresolved | **CONFIRMED** | Deno's debug log says: `Resolved zod from …/ManifestSchema.d.ts to ("internal:///missing_dependency.d.ts")`. With `test/types/deno.json#2@1c5aced`, `deno info` shows `node_modules/.deno/zod@4.6.7`. |
| 15 | "so schema types were silently `any`" | **DRIFT (minor)** | `IsAny<typeof ManifestSchema>` is false under the base config (fresh container, `deno4.out`). What actually happened is that parse output became `unknown`, so any assertion would have failed with TS2339. It was silent only because no assertion existed and `skipLibCheck` hid the unresolved import. Calling it "silently degraded" would be accurate; "any" is not. |
| 16 | RED: zod 3 declarations against zod 4 give 3 errors (KDF enum, compression enum, chunking union) | **CONFIRMED** | `test/types/public-api-compatibility.ts#165,173,178@1c5aced` (`deno.out`, case C) |
| 17 | "Declaration drift from the installed zod fails CI" (CHANGELOG line 14) | **DRIFT (overclaim)** | See below. |
| 18 | Deno type-check cache hazard | **Not claimed by the PR; a finding of mine** | See below. |

**Item 17.** Only drift that changes the six asserted inferences is caught. With the zod 3 declarations, `skipLibCheck:false` reports 5 constraint errors, including `ManifestSchema.d.ts#114`, but the fixture reports only 3. `manifestVersionIsNumber` still passed even though the `ManifestSchema` declaration broke zod's constraint. Recipient, SubManifestRef, Chunk and FixedChunking/CdcChunking are not asserted at all.

**Item 18.** In one container, a base-config check run *after* a head-config check passed from cache with exit 0. Run fresh, the same check fails with 3 errors (`deno4.out`). Any "before" evidence taken from a reused Deno worker therefore needs a fresh container. The PR's RED run is not affected, because errors are not cached.

## IV. Evidence table and CI

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 19 | Node and Bun unit tests: 2,223 passed, 3 skipped; integration: 219 | **CONFIRMED** | PR CI run 41245693529: `Tests 2223 passed \| 3 skipped (2226)`, integration `219 passed` |
| 20 | Deno unit tests: 2,214 passed, 12 skipped, and "main also skips 12" | **CONFIRMED** | Same run: `2214 passed \| 12 skipped`. Main run 39366182397 at `25609d6`: `2211 passed \| 12 skipped (2223)`. The total rises by 3, which matches the 3 new tests. |
| 21 | RED on zod 3: 2 failed, 29 passed | **CONFIRMED by arithmetic and probe** | `Manifest.test.js` contains 31 tests. The probe shows zod 3 accepting `2**60` and `MAX_SAFE_INTEGER`, so the two "rejects" tests fail and the "accepts" test passes. I did not re-run the RED suite itself. |
| 22 | ESLint passes; all checks ran in Docker | **CONFIRMED / UNVERIFIABLE** | CI `lint` passed in run 41245693529. The local Docker runs are the PR author's testimony only. |
| 23 | Merge note about a CHANGELOG conflict with #150 | **UNVERIFIABLE** | Not examined |

## V. Reverse drift: consequences the PR does not mention

1. **Two zods stay installed.** `pnpm-lock.yaml#1172-1175@1c5aced` shows `@git-stunts/plumbing@3.3.2` still on `zod: 3.25.76`, and the Deno image holds both `zod@3.25.76` and `zod@4.6.7`. Issue #151 states this exclusion; the PR body and CHANGELOG are silent on it.
2. **A transitive bump for vault.** `@git-stunts/vault` moves from zod 4.3.6 to 4.6.7 (`pnpm-lock.yaml#1176-1179@1c5aced`). It is a side effect of deduplication and is not mentioned.
3. **One more error path changes shape.** `src/domain/services/ManifestRepository.js#317-319@1c5aced` puts the raw `ZodError.message` (a JSON dump of the issues) into `Sub-manifest … contains invalid chunk data:`. Its keys and wording change with zod 4: `origin` is added, `type`/`exact` are dropped, and the message becomes `Too small: expected number to be >0`. The CHANGELOG names only the `Invalid manifest data:` and `Invalid chunk data:` prefixes.
4. **Further unlisted wording changes.** These include `Required` becoming `Invalid input: expected string, received undefined`, and `formatVersion`'s bare `Invalid` becoming `Invalid string: must match pattern /^\d+\.\d+\.\d+$/`. Infinity and NaN wording also changed. The CHANGELOG's general statement covers all of these, so this is minor.
5. **Integer messages inside encryption are lost.** This is the narrower, real form of item 7.
6. **Not examined:** JSR publishing of the `./schema` types (`jsr.json` has no imports map; the mechanism itself is unchanged) and bundle size. Neither is measured, so I offer no judgment on them.

## VERDICT

```
VERDICT — PR git-stunts/git-cas#152 @ 1c5aced (base 25609d6)
CONFIRMED: 17   DRIFT: 3   PLANNED: 0   UNVERIFIABLE: 2 (local Docker runs; #150 conflict)
Partial: #21 (arithmetic + probe, RED suite not re-run); #18 (my finding, not a claim)
Reverse-drift findings: 5 (+1 not examined)

DRIFT
 D1  CHANGELOG#12 / PR body: "no encryption scheme → only `Invalid input`" offered as a change.
     zod 3 already did this for every truly unmatched case. The real change is non-integer
     fields in a scheme-matching option (zod-3 dirty int check vs zod-4 abort,
     v4/core/schemas.js#1223-1241@zod-4.6.7).
 D2  CHANGELOG#14: "declaration drift from the installed zod fails CI". Only drift in the six
     asserted inferences fails. skipLibCheck:true hides .d.ts constraint errors
     (5 real vs 3 caught).
 D3  Commit/PR body: base schema types were "silently any". They were unresolved
     (missing_dependency.d.ts) but degraded to `unknown` output, not `any`.

Worst drift: D1. It tells consumers the wrong thing about which error messages changed.
Fidelity grade: B+ (runtime parity, type declarations and test counts all hold up;
the error-wording, CI-coverage and "any" claims go beyond the evidence).
```