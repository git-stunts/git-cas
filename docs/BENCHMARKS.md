# Benchmarks

This document records published baseline measurements for `git-cas`.

These numbers are meant to be:

- honest
- reproducible enough for maintainers to refresh
- useful for human and agent tradeoff discussions

They are not meant to be universal truths across every machine, runtime, or
repository shape.

## Current Scope

The first published baseline focuses on chunking tradeoffs:

- fixed-size chunking
- CDC (content-defined chunking)

This is the highest-value first comparison because it exposes the core tradeoff
that users ask about most often:

- fixed chunking is cheaper and faster
- CDC preserves dedupe much better when small edits shift later bytes

The repo also contains broader CAS benchmarks in
[`test/benchmark/cas.bench.js`](../test/benchmark/cas.bench.js), but those
results are not yet published here as a maintained baseline.

## Benchmark Configuration

Observed on **March 30, 2026** with:

- command:
  `CI=1 npx vitest bench --run test/benchmark/chunking.bench.js`
- machine: Apple M1 Pro
- memory: 16 GiB
- OS: macOS 26.3 (`25D125`)
- runtime: Node `v25.8.1`
- package manager: npm `11.11.0`
- benchmark runner: Vitest `2.1.9`

The current harness uses:

- seeded pseudo-random input buffers for reproducibility
- buffer sizes: `1 MB`, `10 MB`, `100 MB`
- fixed chunking: `16 KiB`
- CDC:
  `minChunkSize=4096`, `targetChunkSize=16384`, `maxChunkSize=65536`
- dedupe scenario:
  a `1 MB` base file with deterministic inserted edits of `1`, `10`, `100`,
  and `1000` bytes about one-third into the file

One implementation detail to keep in mind:
Vitest emitted multiple pass blocks during the one-shot run on this machine.
The throughput table below records the final reported block from that run. The
dedupe table is deterministic in this harness and was stable across the
observed output.

## Throughput Baseline

Observed chunking throughput:

| Strategy | Buffer   |    Mean time |    Throughput |
| -------- | -------- | -----------: | ------------: |
| CDC      | `1 MB`   |  `4.0060 ms` |   `249.62 hz` |
| CDC      | `10 MB`  | `36.8944 ms` |  `27.1044 hz` |
| CDC      | `100 MB` |  `342.75 ms` |   `2.9176 hz` |
| Fixed    | `1 MB`   |  `0.1401 ms` | `7,137.96 hz` |
| Fixed    | `10 MB`  |  `1.1948 ms` |   `836.96 hz` |
| Fixed    | `100 MB` | `13.1405 ms` |  `76.1006 hz` |

Observed speed advantage for fixed chunking on this machine:

- `1 MB`: about `28.6x` faster than CDC
- `10 MB`: about `30.9x` faster than CDC
- `100 MB`: about `26.1x` faster than CDC

## Dedupe Reuse Baseline

Observed chunk reuse after deterministic inserted edits:

| Inserted edit | Fixed chunks | Fixed reuse | CDC chunks | CDC reuse |
| ------------- | -----------: | ----------: | ---------: | --------: |
| `1 B`         |         `65` |     `32.3%` |       `62` |   `98.4%` |
| `10 B`        |         `65` |     `32.3%` |       `62` |   `98.4%` |
| `100 B`       |         `65` |     `32.3%` |       `62` |   `98.4%` |
| `1000 B`      |         `65` |     `32.3%` |       `62` |   `98.4%` |

What this means:

- fixed chunking keeps a simple, cheap chunk boundary model
- a small inserted edit shifts later fixed boundaries, so most later chunks stop
  matching
- CDC pays much more CPU cost up front, but keeps chunk boundaries aligned well
  enough that nearly all later chunks still dedupe in this scenario

## What Falls Out

For current `git-cas` guidance:

- fixed chunking is the right default when ingest cost and simplicity matter
  more than edit-shift dedupe
- CDC is the better choice for large assets that change incrementally and where
  preserved chunk reuse matters enough to justify more CPU time
- these measurements are chunker-centric, not full end-to-end store or restore
  numbers

This baseline should be read as tradeoff guidance, not as a promise that one
strategy is categorically better.

## Limits Of This Baseline

- local-machine measurements are directional, not portable
- this run used Node `v25.8.1`, not the repo's minimum supported Node `22.x`
- the published baseline does not yet cover:
  end-to-end store/restore cost, encryption overhead, codec overhead, or Bun and
  Deno runtime comparisons

## Refreshing This Doc

To refresh the chunking baseline:

1. Run:
   `CI=1 npx vitest bench --run test/benchmark/chunking.bench.js`
2. Record the environment details of the machine and runtime used.
3. Update the throughput and dedupe tables.
4. Keep the narrative honest if the benchmark harness, target chunk sizes, or
   interpretation changes.
