# Vault Internals

This document is the maintainer map for the v6 vault implementation. Public API
details belong in [docs/API.md](./API.md); this file explains the internal
collaborators, durability boundaries, cache rules, and security invariants that
keep `VaultService` small.

## Purpose

The vault is a GC-safe slug index rooted at `refs/cas/vault`. Each vault commit
points to a Git tree containing:

- `.vault.json` metadata
- zero or more slug-to-asset tree entries
- `.privacy-index` when privacy mode is enabled

`VaultService` is the use-case orchestrator. It validates inputs, chooses the
plain or privacy path, coordinates vault-key verification, asks collaborators to
read or write durable state, and emits observability events. It must not become
the owner of Git tree formatting, metadata parsing, retry timing, or cache
policy.

## Collaborators

`VaultPersistence`

Owns the Git/ref substrate behind the vault. It resolves the vault head, reads
tree entries, streams entries when the adapter supports it, writes metadata and
privacy-index blobs, creates the next commit, and performs the compare-and-swap
ref update against `refs/cas/vault`. It is intentionally stateless: it does not
cache commit OIDs, tree OIDs, or parsed state.

`VaultStateCache`

Owns parse-stable memoization keyed by immutable tree OID. Cached snapshots keep
raw tree entries, cloned metadata, parsed plain entries, privacy entries by
encryption-key object identity, and verified vault keys. Public state returned
to callers is defensively copied so a caller cannot mutate cached state. Keyed
memoization stores a byte snapshot beside the key object, so mutating a reused
`Uint8Array` key cannot reuse stale privacy or verifier cache entries.

`VaultMetadataCodec`

Owns the `.vault.json` boundary format. It encodes and decodes bytes, validates
metadata version, KDF policy, verifier metadata, and encryption counters. It is
pure: it does not read Git, write Git, derive keys, or perform vault mutations.

`VaultTreeCodec`

Owns persisted tree records. Plain vault slugs use `Slug.toTreePath()` for the
Git tree entry name, and decode through `Slug.decode()`. Privacy-enabled vaults
use HMAC tree names and keep the slug mapping in `.privacy-index`. The codec is
pure and must not perform I/O.

`VaultPrivacyIndex`

Owns privacy-mode persisted names and the encrypted slug-to-HMAC index. It
derives a privacy key from the vault encryption key, computes HMAC-SHA256 names,
encrypts the index blob, decrypts it on read, and validates both slugs and HMAC
names before returning a map.

`VaultKeyVerifier`

Owns encrypted vault-key verifier metadata. New encrypted vaults store a small
AES-GCM verifier in `.vault.json`; reads and keyed writes use it to reject a
wrong vault key before accepting empty-vault mutations. Verifier plaintext is
compared with a constant-time byte comparison.

`VaultMutationRetryPolicy`

Owns optimistic contention policy. It decides whether an error is retryable and
computes exponential backoff with jitter between attempts. `VaultService`
receives the policy through dependency injection so CLIs, TUIs, and long-running
agents can tune contention behavior without changing vault use-case logic. The
policy validates injected timing hooks during construction and freezes the
instance after initialization.

## Read Paths

`getVaultMetadata()`

Resolves the current vault head and reads `.vault.json` directly when the
persistence adapter supports targeted tree lookups. It only falls back to full
tree reads when the adapter cannot resolve a single entry.

`resolveVaultEntry({ slug })`

Validates the slug through `Slug`, then resolves only the relevant persisted
name when the vault is plain. Privacy mode must decrypt `.privacy-index` because
the persisted name is derived from the caller-provided encryption key.

`listVault()`

Returns a sorted array for API compatibility. Internally it delegates to
`iterateVault()`, which streams tree entries when the persistence adapter can do
so instead of materializing the whole vault as the default read primitive.

`readState()`

Returns a defensive copy of the current entries, metadata, and parent commit
OID. Use it when the caller needs a full state snapshot. Do not route targeted
reads through `readState()` unless the full snapshot is actually required.

`rotateVaultPassphrase()`

Reads `.vault.json` first through `getVaultMetadata()` so privacy-enabled vaults
can derive and verify the old key before decrypting `.privacy-index`. Only after
the old key is available should rotation call `readState({ encryptionKey })`.
This preserves privacy-mode slug resolution while rebuilding the privacy index
under the new vault key.

`git cas doctor`

Treats `refs/cas/vault` as unhealthy when the vault head exists but `.vault.json`
metadata is missing or invalid. In that case doctor reports
`VAULT_METADATA_INVALID` before scanning entry manifests, because the vault
boundary metadata is the authority for encryption, privacy, and verifier state.
If the vault ref exists but cannot be read, or its commit cannot resolve to a
tree, `VaultPersistence` reports `VAULT_HEAD_INVALID` instead of treating the
vault as absent.
When manifests can be read, doctor reports both chunk-reference dedupe and
byte-level efficiency (`logical-size` compared with `unique-chunk-bytes`) so
operators can see whether repeated content actually reduces stored chunk bytes.

## Write Path

Vault mutations follow one draft-based loop:

1. Resolve the current vault head.
2. Read enough state for the mutation.
3. Build a draft entries map and metadata object.
4. Verify or create vault-key verifier metadata when encryption is configured.
5. Build privacy persisted names and `.privacy-index` bytes when privacy mode is enabled.
6. Ask `VaultPersistence.writeCommit()` to write blobs, tree, commit, and CAS-update the ref.
7. Retry through `VaultMutationRetryPolicy` when the CAS update reports `VAULT_CONFLICT`.

The service talks in domain terms: vault head, entries, metadata, privacy index,
and vault key. Git terms such as refs, mktree records, commit creation, and
compare-and-swap updates stay inside `VaultPersistence` and `VaultTreeCodec`.

## Cache Rules

Tree OIDs are immutable, so a tree-OID keyed cache is safe. Commit refs are
mutable, so ref resolution must not be cached by `VaultStateCache` or
`VaultPersistence`.

Cache entries may contain:

- raw immutable tree entries copied from persistence
- cloned `.vault.json` metadata
- parsed plain entries
- privacy entries keyed by the exact `Uint8Array` encryption-key object
- a verified-key set keyed by the exact `Uint8Array` encryption-key object

Returned state must always be copied. A caller mutating a returned `Map` or
metadata object must not mutate the cache.

## Boundary Compatibility

The durable vault format is compatibility-sensitive:

- `refs/cas/vault` remains the vault head ref.
- `.vault.json` remains the metadata entry.
- `.privacy-index` remains the encrypted privacy-mode index entry.
- Plain slugs are encoded only through `Slug.toTreePath()`.
- Plain slugs are decoded only through `Slug.decode()`.
- `VaultMetadataCodec` and `VaultTreeCodec` must stay pure.

Changing plain tree-entry encoding is a data migration, not an internal refactor:
any drift would make existing vault entries unreachable by their public slug.

## Testing Posture

Vault tests should assert behavior rather than collaborator shape:

- plain and privacy vault round trips preserve slug-to-tree mappings
- wrong vault keys fail before empty-vault writes
- verifier migration occurs on the next keyed write for older metadata
- targeted resolve and streaming list paths work when the adapter exposes them
- CAS conflicts are retried through the policy
- codecs reject malformed bytes and remain I/O-free

Use injected memory adapters for domain behavior where possible. Git-backed
integration tests remain valuable for verifying the actual ref, tree, blob, and
commit substrate.
