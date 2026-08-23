# PERF-0058 Verification

Date: 2026-08-23

Issue: https://github.com/git-stunts/git-cas/issues/115

## Identity

- RED specification commit:
  `f35775f7b8aac0f613cc76bf6bb482815f0ed934`
- bounded-session implementation commit:
  `135a8ff416b12e6abede0b0f78a3e6ba00ca1255`
- machine-readable witness:
  [`bounded-stream-session-reads.json`](./bounded-stream-session-reads.json)
- witness command:
  `node scripts/diagnostics/measure-bounded-stream-session-reads.js`

## RED Calibration

At the RED specification commit, before the production adapter changed:

- the focused adapter unit run failed only the two new routing laws: a small
  stream still came from the legacy one-shot command, and no persistent
  session content read occurred;
- the Docker-backed real-Git run failed the new small and oversized topology
  expectations because `readBlobStream()` opened no metadata session;
- the pre-existing stream contract tests remained green;
- the initial 10 MiB equality assertion exhausted the matcher while rendering
  a failure diff, so the test was corrected to compare length and
  `Buffer.equals()` before implementation. That was a test-harness correction,
  not product evidence.

## Deterministic Process Witness

The implementation witness used 32 deterministic 4,096-byte payloads and one
10 MiB + 1 byte payload on Node v26.0.0, Git 2.50.1 (Apple Git-155), macOS
arm64.

| Route | Session children | One-shot children | Session info | Session read |
| --- | ---: | ---: | ---: | ---: |
| 32 fallback small reads | 0 | 32 | 0 | 0 |
| 32 session small reads | 1 | 0 | 32 | 32 |
| 1 oversized read | 1 | 1 | 1 | 0 |

The fallback and session small-read digests are identical:
`4eac8ed135f35f38f32a7e9a9889f273146dd5bd15daa991963f084befa91974`.
The oversized payload digest is
`af6af04dc3eab0d6c1b484c187d6be27eafa9a0d105d6a012942adf916ed27fd`.
Every session count is zero after adapter close.

These counts are structural evidence. They are not a wall-clock guarantee, an
aggregate-memory bound, or proof that all downstream Git processes disappear.

## Behavioral Coverage

Unit tests prove:

- admitted blobs use one bounded session `info()` plus `read()` and never call
  `executeStream()`;
- objects above the fixed 10 MiB ceiling are inspected but never session-read,
  even if `maxBlobSize` is raised;
- missing, non-blob, metadata-failure, content-read-failure, and no-session
  states retain the legacy one-shot route;
- a failed bounded content read retires the affected session before fallback.

Docker-backed real-Git tests prove:

- 12 repeated small reads in both SHA-1 and SHA-256 repositories use one
  persistent child and return exact bytes;
- the 10 MiB + 1 byte object uses exactly one one-shot content stream and no
  session content read;
- explicit adapter close leaves no active session.

## Release Verification

`npm run release:verify` passed all 14 gates on the implementation tree:

| Surface | Result |
| --- | ---: |
| Lint | PASS |
| Node unit tests | 2,108 passed; 2 skipped |
| Bun unit tests | 2,107 passed; 3 skipped |
| Deno unit tests | 2,098 passed; 12 skipped |
| Public type compatibility | PASS |
| Node integration tests | 202 passed |
| Bun integration tests | 202 passed |
| Deno integration tests | 202 passed |
| Example: store-and-restore | PASS |
| Example: encrypted-workflow | PASS |
| Example: progress-tracking | PASS |
| Build metadata stamp | PASS |
| npm pack dry-run | PASS |
| JSR publish dry-run | PASS |

The verifier reported 6,919 observed Vitest tests. The three example-process
checks and non-test packaging/type gates are not included in that total.

## Remaining Publication Gates

- implementation PR [#116](https://github.com/git-stunts/git-cas/pull/116)
  merged normally as `1e30740c8670bf42b8bb863f8feb99a5e0f0f29b`;
- prepare and fully verify a separate v6.5.7 release candidate from merged
  `main`;
- merge the reviewed release PR normally;
- create and push one signed `v6.5.7` tag that peels to the verified release
  commit;
- independently verify the publish workflow, npm package and provenance, and
  GitHub Release;
- record publication truth before closing issue #115 and its milestone.
