# Deno locked-install witness

## Result and scope

The repaired installation uses the committed pnpm graph and executes the existing
Deno runtime/declaration gates. This local rehearsal reused the existing immutable
toolchain image and a fresh runtime filesystem. It did not rebuild the changed
Dockerfile; the PR's hosted CI owns that additional acceptance check.

## The upstream failure changed while the repair was underway

Hosted run `41456162064`, Deno job `125314087172`, failed at 13:50 UTC on
2026-11-02 because the Windows optional extraction package at 2.2.3 was absent.
Registry metadata later recorded its publication at 13:57:25.342 UTC. The
`deno-install-red-01` baseline therefore exited zero, freshly installing 154
packages including `cbor-x@1.6.9` and `cbor-extract@2.2.3`. It is a successful
baseline install, despite the historical phase name. It also emitted an ESLint
9.39.5 deprecation warning; that newly resolved release is not in the repaired
locked graph. The installer failure is not claimed to remain reproducible after
the missing version became available.

The separate `deno-lock-drift-red-01` phase runs the original unlocked install on
clean base `ae3a81cddf5f45a54a676c62bdb0335db77da5a0`, then asserts the committed
graph's extraction version. It exits 1 at the actual assertion: expected 2.2.0,
observed 2.2.3. This proves graph drift independently of package availability.

## Repaired installation and runtime execution

`deno-install-green-01` starts without project node_modules or a populated pnpm
store. It installs pnpm 10.34.9, then runs `pnpm install --frozen-lockfile` with an
owned store. A Deno probe observes `cbor-extract@2.2.0`. SHA-256 checks confirm
package and lock bytes are unchanged before and after the entire phase.

A separate fixture changes the declared commander version from 14.0.3 to 14.0.2
while retaining the original lock. The same frozen installation refuses with
`ERR_PNPM_OUTDATED_LOCKFILE`. No nonzero installer exit is ignored in the repaired
image. pnpm can still omit optional packages; installation success alone is not
evidence that the optional native accelerator loaded.

Executed with Deno 2.7.1, V8 14.5.201.2-rusty, TypeScript 5.9.2, Node 22.23.4,
Vitest 2.1.9, on Linux aarch64:

| Check | Result |
| --- | --- |
| Deno unit suite | 2,214 passed; 12 existing conditional skips |
| Deno integration suite | 219 passed |
| Public declaration compatibility | passed |
| Strict schema declaration compatibility | passed |
| ESLint | passed |
| Node unit suite | 2,223 passed; 3 existing conditional skips |
| Installed extraction version | 2.2.0 |
| Stale manifest with frozen lock | rejected |
| Source package/lock hashes after all checks | unchanged |
| New deno.lock | absent |

Runtime invocations use `deno run --node-modules-dir=manual -A npm:vitest`.
Declaration invocations use the repository's two existing configurations, both
with manual node_modules mode. The local phase caps Vitest at two workers and
serializes integration files. The repaired Dockerfile, workflow and npm script
retain their existing test selection and explicit Deno execution.

## Resource and evidence boundaries

The existing `git-cas-tests` worker/image was reused, with a readonly root,
3 GiB runtime tmpfs, three additional 16 MiB filesystems, 4 CPU, 8 GiB memory,
512 PID limit, rotated Docker logs, 8 MiB phase log cap and 120 MiB aggregate host
evidence cap. Canonical workstation admission precedes every phase; the runner
checks host/VM 50 GiB floors and stops the entire worker on limits, monitor errors
or the 900-second deadline. No host tests or host repository mounts occurred.

The successful phase lasted about 55 seconds. Its final runtime measurement was
126,852 KiB under `/data` plus 1,624 KiB under the bounded home filesystem.
These are end measurements, not peaks. Stopping the worker clears those tmpfs
outputs. Raw logs remain separate; [receipt](install.json) identifies their exact
hashes, source hashes, phase results and registry observation.

Manual SSJS review: no domain concepts, capabilities, encoding, time/entropy or
runtime dispatch changed. All changed executable paths are installation/runtime
invocations at the tooling boundary. Documentation review preserves existing
links and adds this cycle to the design index; issue/milestone remain canonical.

This evidence does not establish a deterministic whole image, release readiness
for reservations, or a fresh registry consumer installation. Existing image tags
and pnpm major selection remain separate toolchain inputs.

## Optional acceleration is a separate condition

Review identified an overbroad error contract: pnpm can omit optional dependencies
without returning a failing status. The image propagates nonzero installer exits;
it does not redefine pnpm's optional-dependency policy. The pinned
[cbor-x source](https://github.com/kriszyp/cbor-x/blob/v1.6.0/node-index.js)
explicitly catches a missing native extractor and retains its JavaScript codec.

The `deno-optional-fallback-01` phase performs a fresh frozen install, then removes
only the disposable installed cbor-extract package. A fresh Node process and a
fresh Deno process both observe `isNativeAccelerationEnabled === false`. Each
runtime passes all 41 cases in BundleService, CasService.codec and
CasService.readManifest; lint also passes. [Phase receipt](optional-fallback.json)
records the exact result. This is a controlled missing-accelerator check, not a
claim to have induced every possible pnpm fetch or build failure. Production
installation still attempts optional packages normally.
