# Preparatory playback evidence

These are preparatory results for issue [#131](https://github.com/git-stunts/git-cas/issues/131), not release or registry-publication evidence.

## Coordinates

Git-cas preparation source: `d7717d3`; base: `c02c87ee0d7a72b0371762e5239223adb3ac4781`. Upstream candidate source: `d728cbf56ac85ccef9b276422e6168a68a9e6ad0`. The baseline Docker dependency reports Plumbing `3.3.0`; the packed-candidate Docker dependency reports `3.3.2`.

Packed Plumbing candidate SHA-512 (hex): `c86840045f5efa8f867366fc2fc2e45c9804d000ab248d0c6f2b7147285970728b25f645bfd2c0b3c44dc6fe0ab485cbc501e3d92b655bb4f5e300e4d1b5d63f`. The artifact was produced with `npm pack` inside COPY-based Docker; it was installed only in a preparation image. It is not a registry artifact, and no file/tarball dependency is added to the tracked package or lockfile.

## Executed checks

| Surface | Outcome | Qualification |
| --- | --- | --- |
| CI/release isolation regression | 3 failed, 17 passed before fix | Detected host unit and example paths |
| Public mktree/persistence recovery regression | 4 failed, 2 passed before upstream adoption | Actual protocol instances against locked 3.3.0 |
| Same recovery regression with candidate | 6 passed | Packed 3.3.2, not yet npm |
| Node unit preparation | 2,197 passed, 3 skipped | Existing skips retained |
| Bun unit preparation | 2,197 passed, 3 skipped | Existing skips retained |
| Deno unit preparation | 2,188 passed, 12 skipped | Existing runtime skips retained |
| Node integration with candidate | 207 passed | 14 integration files, serialized |
| ESLint | Passed | Entire preparation checkout |

Selected raw summaries are in [preparation-evidence.txt](./preparation-evidence.txt). Complete hosted CI for `d7717d3`, including all three integration runtimes and public Deno types, is [run 36995996685](https://github.com/git-stunts/git-cas/actions/runs/36995996685).

All executions used COPY-based Docker with no host repository or Git-directory mounts. Environment flags did not authorize a host execution. The new guard checks the physical Docker marker before test modules load.

## Playback

Human: the packed candidate can recover the stale-transport fault and the 207 Git-backed integration checks pass. Agent: deterministic fault cases show canonical OIDs, two attempts at most, and unchanged unrelated/producer failure identities. Those are separate claims from actual external GC and registry consumer delivery.

## Remaining release evidence

Merge and publish Plumbing 3.3.2; update the registry dependency minimum and lockfile; rerun complete release verification against that immutable registry version; review/merge git-cas; verify synced main; publish 6.5.11; record registry integrity and fresh consumer proof; adopt it in git-warp. No tagged or published 6.5.11 is claimed here.
