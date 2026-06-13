# v6.1.0 Bounded Residency

## Identity

| Field | Value |
| --- | --- |
| Goalpost id | `v6.1.0-gp-bounded-residency` |
| Release home | `v6.1.0` |
| Umbrella issue | `not opened yet` |
| Goalpost doc | `docs/goalposts/v6.1.0/bounded-residency.md` |
| Design cycle | `docs/design/0045-v6-1-bounded-residency/bounded-residency.md` |
| Slice budget | `5` |
| Status | `scaffolded` |
| Sponsor human | `James` |
| Sponsor agent | `Codex` |

## Outcome

Large vault and large blob operations are bounded by API contract instead of by
hope. `git-cas` can resolve single vault entries, list vault entries, and read
payload data through paths that do not accidentally materialize unbounded Git
trees or blobs.

## Current Truth

- [docs/method/backlog/bad-code/vault-tree-memory-loading.md](../../method/backlog/bad-code/vault-tree-memory-loading.md)
  names full vault tree loading as active debt.
- [docs/method/backlog/bad-code/TR_persistence-adapter-materialization.md](../../method/backlog/bad-code/TR_persistence-adapter-materialization.md)
  names `GitPersistenceAdapter.readBlob()` materialization pressure as active
  debt.
- [src/infrastructure/adapters/GitPersistenceAdapter.js](../../../src/infrastructure/adapters/GitPersistenceAdapter.js)
  already provides `readBlobStream()`, a default `readBlob()` safety limit, and
  tree iteration helpers.
- [src/domain/services/VaultPersistence.js](../../../src/domain/services/VaultPersistence.js)
  already contains direct tree-entry and streaming tree iteration boundaries.
- [src/domain/services/VaultService.js](../../../src/domain/services/VaultService.js)
  still has cached vault tree paths that can turn single-entry work into
  whole-tree residency.

## Scope

- Make single vault-entry resolution use targeted tree entry reads when
  supported.
- Keep vault listing streaming when `iterateTree()` is available.
- Define the remaining supported role for `readBlob()` as metadata-sized,
  guarded reads.
- Prefer `readBlobStream()` for unbounded payload data.
- Add tests and witnesses that prove the residency contract.

## Out Of Scope

- Changing the vault on-disk tree format.
- Browser or edge adapters.
- New encryption schemes.
- TUI presentation changes.
- Removing compatibility fallback behavior for custom adapters in this
  goalpost unless tests prove it is unsafe.

## Proof Stories

```text
A maintainer needs single-entry vault lookup to avoid whole-tree residency
so that large vaults remain usable in constrained runtimes,
without relying on every vault operation being a list operation.
```

| Story issue | Actor | Need | Reason | Slice budget |
| --- | --- | --- | --- | ---: |
| `not opened yet` | maintainer | targeted vault entry lookup | avoid O(number of vault entries) reads for one slug | 1 |
| `not opened yet` | operator | streaming vault list | inspect large vaults without forcing a full resident map first | 1 |
| `not opened yet` | agent | explicit residency errors | distinguish bounded metadata reads from payload stream reads | 1 |
| `not opened yet` | maintainer | fallback compatibility tests | keep custom adapters honest while preserving old behavior where safe | 1 |
| `not opened yet` | release owner | release evidence | tag `v6.1.0` with replayable scale proof | 1 |

## Slice Budget

| Slice | Status | Description | Expected proof |
| ---: | --- | --- | --- |
| 1 | open | Add RED tests for targeted vault slug lookup. | unit test |
| 2 | open | Add RED tests for streaming vault list and fallback behavior. | unit test |
| 3 | open | Finish `readBlob()`/`readBlobStream()` residency contract tests. | unit and integration tests |
| 4 | open | Implement bounded vault and blob read behavior. | runtime behavior |
| 5 | open | Update docs, changelog, and release witness. | doc update and witness |

## Acceptance Criteria

- [ ] Single-slug vault lookup does not call `readTree()` when
      `readTreeEntry()` is available.
- [ ] Vault list streams via `iterateTree()` when supported.
- [ ] `readBlob()` has a documented metadata-sized safety role.
- [ ] Unbounded payload restore paths use `readBlobStream()` or fail with an
      explicit capability error.
- [ ] `npx eslint .` passes.
- [ ] `npm test` passes.
- [ ] `npm run release:verify -- --skip-jsr` passes before release.

## Deterministic Evidence

| Claim | Canonical fixture or input | Witness | Replay command | Expected deterministic result |
| --- | --- | --- | --- | --- |
| Targeted lookup avoids full tree | mocked persistence with `readTreeEntry` spy | unit test | `npx vitest run test/unit/vault` | `readTree()` not called |
| Streaming list uses iterator | mocked persistence with `iterateTree` generator | unit test | `npx vitest run test/unit/vault` | entries yielded without full read |
| Payload reads prefer stream | CAS restore fixture | unit test | `npx vitest run test/unit/domain/services/CasService.readBlobStream.test.js` | `readBlobStream()` used |
| Release readiness | full repo | release verifier | `npm run release:verify -- --skip-jsr` | all non-JSR steps pass |

## Substrate / Residency Geometry

| Reading claim | Basis | Aperture | Law/projection | Support obligations | Witness posture |
| --- | --- | --- | --- | --- | --- |
| Single vault entry lookup is bounded | `refs/cas/vault` tree OID | one encoded slug path | `ls-tree <tree> -- <path>` when available | fallback behavior documented | spy test proves no `readTree()` |
| Vault list is streaming-capable | `refs/cas/vault` tree OID | one tree entry at a time | async iterator projection | iterator fallback covered | generator test proves incremental path |
| Payload reads are stream-first | manifest chunk OIDs | chunk stream | `readBlobStream()` over blob content | capability error for hard-limited modes | restore tests assert stream use |

## Validation Plan

```bash
npx vitest run test/unit/vault
npx vitest run test/unit/infrastructure/adapters/GitPersistenceAdapter.readBlob.test.js
npx vitest run test/unit/domain/services/CasService.readBlobStream.test.js
npx eslint .
npm test
npm run release:verify -- --skip-jsr
```

## Release Gate Impact

`v6.1.0` should ship with a changelog entry that describes bounded residency as
a scale hardening release. No storage migration is expected. Public API changes
should be avoided unless the design cycle proves a compatibility break is
required.

## Residual Risks

| Risk | Rationale | Owner | Follow-up issue |
| --- | --- | --- | --- |
| Custom adapters may still materialize internally | The port cannot inspect third-party implementation details. | maintainer | `not opened yet` |
| Git CLI output is still the storage transport | This goalpost bounds how output is consumed, not how Git produces it. | maintainer | `not opened yet` |

## Closeout

- [ ] Slices complete or honestly dispositioned.
- [ ] Proof matrix replayed.
- [ ] Goalpost issue updated.
- [ ] Child proof-story issues closed, superseded, or carried forward.
- [ ] Pull request merged for this goalpost.
- [ ] Release evidence updated when release-relevant.
- [ ] Retrospective or closeout note written.
