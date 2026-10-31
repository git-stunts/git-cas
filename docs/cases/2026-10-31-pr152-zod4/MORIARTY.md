# Testimony of Professor James Moriarty: PR git-stunts/git-cas#152, "chore(deps): upgrade zod to 4"

*Head `1c5aced`, base `25609d6`.*

I came for a severe break in stored-data compatibility, and I owe the court the truth: the schema held. I ran 3,312 differential cases across seven seed manifests, comparing base `ManifestSchema.js` on zod 3.25.76 against head on zod 4.6.7. The only change in what is accepted is the one the PR already discloses. What I did break was the PR's description of its own error behaviour, plus a few things it never mentions.

The schema source is byte-identical between base and head; I diffed the two `git show` outputs. So every divergence below comes from the library, not from an edit.

Method and evidence are in `/private/tmp/claude-501/-Users-j-git-reader/a63a32ca-c989-49a4-a04e-297a740b763a/scratchpad/baker-152/moriarty/`:
- the differential fuzzer: `probe.mjs` (summary in `probe.out`, every case in `out-diffs.json`)
- the base and head schema copies: `schema-v3.mjs` and `schema-v4.mjs`
- the zod internals, config-leak test and source dumps: `probe2.sh`, `probe3.mjs`, `probe4.sh`, `probe5.sh`, and their `.out` files
- the analyses: `union-masking.out` and `custom-msg-analysis.out`

Every container ran under the git-locks lease with `--network none` and memory and CPU limits. No containers are left behind (`docker ps -a` shows 0). Scratch usage is 496 KiB.

---

## Strikes

### Strike 1 (P4): a float in an encryption field now reports only "Invalid input", which the PR's description does not cover

**What the PR says.** The PR body and `CHANGELOG.md#12@1c5aced` say: "a value that matches no encryption scheme reports only `Invalid input`."

**What actually happens.** Take a block that does match a scheme (correct `scheme` and `algorithm`) and put a non-integer or ±Infinity in any of its integer fields:
- `kdf.iterations`, `kdf.cost`, `kdf.blockSize`, `kdf.parallelization`, `kdf.keyLength`
- `frameBytes`, `keyVersion`, `recipients[].keyVersion`

zod 4 then reports a single `Invalid input`, and the error path is the root of the encryption block rather than the bad field. zod 3 named the field and the fault. For example:
- `iterations: 1.5`: zod 3 reports `Expected integer, received float@kdf.iterations`; zod 4 reports `Invalid input@` (`probe2.out`).
- The fuzzer found 24 such cases (`union-masking.out`).

**Why.**
- zod 4's integer check raises an issue marked `continue: false` (`node_modules/zod/v4/core/checks.js#103-110@zod-4.6.7`).
- That marks the branch as aborted (`node_modules/zod/v4/core/util.js#520-528@zod-4.6.7`).
- With all three union branches aborted, there is no single surviving branch to report, so the union emits `invalid_union` (`node_modules/zod/v4/core/schemas.js#1230-1240@zod-4.6.7`).
- zod 3 only marked the result dirty (`node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js#1087-1096@zod-3.25.76`), so the union returned that one branch's own issues (`…/v3/types.js#2340@zod-3.25.76`).

**Effect.** These messages reach users through `Manifest.js#44@1c5aced`. Someone with a corrupted manifest now loses the field name. Not fatal, but the PR's error-behaviour description is incomplete.

### Strike 2 (P4): any other zod 4 code in the process can now change git-cas's error text

**The mechanism.** zod 4 keeps its global configuration and registry on `globalThis`:
- `node_modules/zod/v4/core/core.js#135-140@zod-4.6.7` (config)
- `node_modules/zod/v4/core/registries.js#50-51@zod-4.6.7` (registry)

So a host application, or any dependency that calls `z.config(...)`, now changes the default wording of git-cas's `Invalid manifest data:` and `Invalid chunk data:` errors.

**Demonstrated** (`probe3.out`):
- Baseline: `Invalid input: expected number, received string`
- After `z.config(z.locales.de())`: `Ungültige Eingabe: erwartet Zahl, erhalten string`
- After `z.config({ customError })`: `HOST-SAYS-NO`
- Same host config on the base schema with zod 3: still `Expected number, received string`, so base was immune.

**What I concede.** Messages the schema sets itself still win; the digest message survived the host's `customError`. The same `globalThis` slot also carries `jitless` and an internal `postProcessor` hook (`core.js#106-108@zod-4.6.7`), so a host can also change how git-cas schemas are built and how fast they run.

**What the PR omits.** It says nothing about this new coupling and offers no evidence on it. One correction to my own probe: the line labelled `distinct module : false` does not prove separate module copies share this state. The globalThis point rests on the source lines cited above.

### Strike 3 (P5, disclosed): manifests already in Git with an integer above 2^53 now fail to load

**What changed.** Base accepted a stored manifest with `size`, `index`, `chunkCount` or another integer field above `Number.MAX_SAFE_INTEGER`; head rejects it. Of the 90 accept/output divergences, 84 are this case (`out-diffs.json`). The cause is `node_modules/zod/v4/core/checks.js#121-133@zod-4.6.7`. There is no fallback on the read path: `Manifest.js#24@1c5aced` and `ManifestRepository.js#317@1c5aced` call `parse` directly.

**Why the severity is low.** The PR and `CHANGELOG.md#12@1c5aced` disclose it, and a real file of 9 PiB or more is implausible.

### Strike 4 (P5): the type assertions are too weak to catch the mistake they exist to catch

**The gap.** `kdfKeyLengthDefaults` (`test/types/public-api-compatibility.ts#169-172@1c5aced`) asserts only that the input type is `number | undefined`. Nothing asserts that the output (`z.infer`) of `keyLength` is plain `number`, and nothing checks `encrypted` or the input side of `version`.

**CONJECTURE.** If `keyLength: z.ZodDefault<z.ZodNumber>` (`ManifestSchema.d.ts#24@1c5aced`) were mistyped as `z.ZodOptional<z.ZodNumber>`, every new assertion would still pass, and consumers would get `keyLength?: number` on output.

**Experiment.** Make that substitution, then run `deno check --config test/types/deno.json test/types/public-api-compatibility.ts` in the deno image and expect it to pass.

### Strike 5 (P5): the Deno type check runs against a zod version the lockfile does not pin

**The facts.**
- No `deno.lock` is committed (`git ls-files` shows only `test/types/deno.json`).
- The deno image runs `deno install` from `package.json` alone (`Dockerfile#54-57@1c5aced`), and `.dockerignore` excludes `node_modules`.
- So the CI type check (`.github/workflows/ci.yml#59-63@1c5aced`) resolves `zod ^4.6.7` to whatever is current when the image is built, not the pnpm-locked 4.6.7. The image happens to hold 4.6.7 today (`probe4.out`).

**Why it matters.** The CHANGELOG says "declaration drift from the installed zod fails CI" (`CHANGELOG.md#14@1c5aced`). That checks a moving version, not the one Node consumers lock. This setup predates the PR, but the PR's new claim depends on it.

### Strike 6 (P5): a heavier import, and two zod majors in the dependency graph

**Measured** (`probe2.out`, 5 runs):
- importing zod 4 takes 15.9–17.6 ms, against 3.6–3.8 ms for zod 3
- loading the schema module takes 20.1–22.7 ms, against 5.3–5.5 ms
- the first parse takes about 1.1 ms, against 0.4 ms

**Dependency graph.** `@git-stunts/plumbing` still pins zod 3.25.76 (`pnpm-lock.yaml#1173-1175@1c5aced`), and `index.js` imports plumbing. Base resolved to a single zod 3.25.76 copy shared with plumbing; head carries both majors. Vault loads its zod 4 lazily, only from the CLI (`bin/passphrase-source.js#209@1c5aced`), so library users were not already paying for zod 4.

**CONJECTURE.** Importing `index.js` now evaluates both zod majors.

**Experiment.** Run `node --cpu-prof -e "await import('/app/index.js')"` on head and on base and compare which zod modules load.

---

## Attacks attempted and failed

- **Stored-data edge values: survived.** Across 3,312 cases, no difference in acceptance or output for:
  - `-0`, `NaN`, numeric strings, `null`, booleans, arrays, `{}`, `Date`, `BigInt`
  - explicit `undefined` versus a missing key, at top level and inside encryption, including `z.undefined().optional()` fields
  - deleting any key
  - the defaults: `version`, `encrypted: z.literal(true).default(true)`, and `keyLength` inside `KdfSchema.optional()`
  - stripping unknown keys at every level
  - an own `__proto__` key, set directly or through `JSON.parse`
  - objects with a null prototype, frozen objects, class instances, inherited properties
  - sparse arrays and all-hole arrays

  The fuzzer's output serializer tells missing keys from `undefined`, `-0` from `0`, array holes, key order and prototype (`probe.mjs`).
- **Getters: a false alarm, withdrawn.** An apparent difference was an artifact: my probe shared one counter between both libraries. A clean recount shows both read the property once and return the same value (`probe2.out`).
- **"Custom messages are unchanged": survived.** Of 1,782 cases where only the message differed, none dropped or added a schema-set message (`custom-msg-analysis.out`). They also survive a host `customError` (Strike 2).
- **Callers that depend on error shape: survived.** Repo callers use only `error.issues.map(i => i.message)` (`Manifest.js#44`, `Chunk.js#30@1c5aced`) or `err.message` (`ManifestRepository.js#318-320@1c5aced`). No `.errors`, `.format()` or `.flatten()` calls, and no tests that match zod's default wording, turned up in `src/`, `bin/`, `index.js` or `test/`.
- **`nodeModulesDir: "manual"` with no `node_modules`: survived.** The CI image always runs `deno install` (`Dockerfile#55-57`).
- **Wrong generics in the `.d.ts`: no error found.** The zod 4 `ZodEnum` map form and the `ZodDiscriminatedUnion<[...], "strategy">` argument order look right. I did not run a compile-time adversarial check beyond Strike 4.
- **CSP / eval: surrendered.** zod 4 probes `new Function` (`node_modules/zod/v4/core/util.js#218-229@zod-4.6.7`), but git-cas is not a browser library and Deno needs no permission for it. I ran no CSP experiment.
- **The evidence table: not refuted.** I did not re-run their test suites.

---

## VERDICT

```
TARGET:        git-stunts/git-cas#152 @ 1c5aced (base 25609d6)
STRIKES LANDED:
  S1  P4  non-fatal  Float/±Infinity in any integer field of a matching encryption scheme collapses to
                     root "Invalid input"; refutes the PR/CHANGELOG description of error behaviour
  S2  P4  non-fatal  zod 4 globalThis config: host z.config (locale/customError/jitless) now rewrites
                     git-cas default error text; base was immune (probe3.out)
  S3  P5  non-fatal  Stored integers > 2^53 now unreadable, no fallback (disclosed; implausible data)
  S4  P5  non-fatal  Type fixture too weak: ZodDefault vs ZodOptional of keyLength undetected (CONJECTURE + experiment)
  S5  P5  non-fatal  Deno type check resolves floating zod (no deno.lock); the "installed zod" in the claim is not the locked one
  S6  P5  non-fatal  ~4x import/load cost for the schema module; two zod majors in the library graph
                     (double load at index.js import is CONJECTURE)
FATAL STRIKES: none
FAILED ATTACKS: stored-data edge values (no divergence beyond the disclosed safe-int change, 3,312 cases);
                getters (false alarm withdrawn); custom messages unchanged (claim survives);
                caller error-shape contract; nodeModulesDir manual; d.ts generics
SURRENDERED:   CSP/eval (no browser surface, no experiment); evidence-table re-run
RESILIENCE GRADE: B
```