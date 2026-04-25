# Threat Model

This document describes the security boundary of `git-cas`.

It answers a different question than [SECURITY.md](../SECURITY.md).

- [SECURITY.md](../SECURITY.md)
  - cryptographic design, limits, and security-relevant implementation notes
- this document
  - attacker models, protected assets, exposed metadata, trust boundaries, and
    explicit non-goals

`git-cas` is a content-addressed storage system with optional encryption.
It is not a full secret-management platform, access-control system, or secure
deletion system.

## System Under Evaluation

At a high level, `git-cas`:

1. stores content as Git blobs
2. records reconstruction metadata in manifests
3. emits Git trees that keep manifests and chunk blobs reachable
4. optionally indexes trees by slug through `refs/cas/vault`

Optional protections include:

- AES-256-GCM encryption for stored content
- passphrase-derived keys through PBKDF2 or scrypt
- envelope encryption for multi-recipient access
- SHA-256 chunk verification during restore and verify flows

## Assets

### Assets `git-cas` Can Protect

- plaintext content bytes when encryption is enabled and keys remain secret
- integrity of stored and restored content through digest verification and
  authenticated decryption
- long-term reachability of stored assets through Git trees and the vault ref

### Assets `git-cas` Does Not Fully Hide

The following are not fully confidential simply because encryption is enabled:

- slugs
- filenames
- manifest structure
- chunk counts
- chunk sizes
- tree and blob object IDs
- recipient labels
- wrapped-recipient records and related encryption metadata
- vault metadata in `.vault.json`
- the existence of stored assets and their relationship to particular slugs

When `convergent-v1` encryption is active, identical plaintext chunks produce
identical ciphertext blobs. An attacker with read access to the Git object
database can observe that two manifests reference the same blob OID, inferring
that those chunks contain identical plaintext. This is the well-known limitation
of convergent encryption (Tahoe-LAFS, etc.). For scenarios where content
equality itself is sensitive, use `framed-v2` or `whole-v2` instead.

This is especially important for repository exposure scenarios: encrypted
content can remain confidential while metadata remains visible.

## Trust Boundaries

The main trust boundaries are:

- the Git repository and its object database
- the local host running `git-cas`
- the key and passphrase sources used by callers
- any logs, terminals, CI systems, or automation layers handling secrets

`git-cas` controls how bytes are chunked, verified, encrypted, and indexed.
It does not control who can read the repository, who can inspect the host, or
how callers store and transport keys.

## Attacker Models

### A1. Repository Reader Without Keys

This attacker can read Git objects, manifests, trees, and `refs/cas/vault`, but
does not have the relevant encryption key or passphrase.

What `git-cas` does protect:

- encrypted content bytes remain confidential
- tampering with encrypted content is detected during decryption
- chunk corruption or substitution is detected during verification and restore

What remains exposed:

- asset existence
- slugs and filenames
- manifest structure and object relationships
- chunk sizes and counts
- recipient labels and wrapped-recipient metadata
- vault metadata including KDF parameters

### A2. Repository Reader With Keys Or Passphrases

This attacker can read the repository and also has the relevant key material.

What `git-cas` protects:

- integrity verification still detects accidental or malicious corruption

What it does not protect:

- confidentiality of encrypted content

Once the attacker has both repository access and valid key material, `git-cas`
is not an access-control barrier.

### A3. Repository Writer Without Keys

This attacker can alter Git objects or refs but does not possess the key
material.

What `git-cas` does protect:

- SHA-256 chunk verification detects chunk substitution or corruption
- AES-GCM authentication detects encrypted-content tampering
- encrypted restore rejects downgraded manifest metadata instead of silently
  returning ciphertext
- encrypted `verifyIntegrity()` only passes when ciphertext authentication also
  succeeds with valid credentials

What it does not protect:

- availability
- ref deletion
- denial-of-service through repository damage or object removal

An attacker who can mutate or delete repository state can still break restores
or make content unavailable.

### A4. Host Compromise

This attacker can inspect process memory, local files, terminals, environment
variables, CI logs, or the working tree on a host where `git-cas` is used.

What `git-cas` does not protect:

- plaintext present on the host during normal file input or restore flows
- keys or passphrases stored in files, environment variables, or process memory
- passphrase prompts captured by compromised terminals or host tooling

Host compromise defeats the core confidentiality boundary. `git-cas` is not a
host-hardening system.

### A5. Lost Keys Or Passphrases

This is not an attacker, but it is a relevant failure mode.

What `git-cas` does not provide:

- key escrow
- recovery service
- passphrase reset
- alternate recovery path for encrypted content

If the relevant key material is lost, encrypted content may become permanently
unrecoverable.

## Scenario Notes

### Exposure Of `refs/cas/vault` Without The Passphrase

Exposing `refs/cas/vault` does not by itself expose encrypted content bytes.

It does expose:

- the existence of the vault
- the slug-to-tree mapping
- `.vault.json` metadata, including KDF parameters
- the audit trail of vault commits

The vault passphrase does not make the vault index itself opaque. It provides
KDF-backed key derivation context used by vault-oriented encryption workflows.

### Manifest Exposure

Manifests are written as ordinary Git blobs through the configured codec.
They are not themselves wrapped in a second confidential container.

That means repository readers can still inspect manifest metadata even when the
content chunks are encrypted.

### Envelope Encryption

Envelope encryption protects the data encryption key by wrapping it per
recipient, but it does not hide:

- the fact that envelope encryption is in use
- recipient labels
- the presence of wrapped DEK records in the manifest

It improves key distribution and rotation behavior. It is not metadata
obfuscation.

### Vault Passphrase Rotation

Vault passphrase rotation does not re-encrypt arbitrary repository metadata.

It re-wraps envelope-encrypted vault entries with a new KEK derived from the new
passphrase and updates the vault KDF metadata. Non-envelope entries are skipped.

## Security Guarantees

When used correctly, `git-cas` aims to provide:

- confidentiality of encrypted content at rest against repository readers who
  lack the relevant key material
- integrity checking for stored and restored content
- explicit failure on ciphertext tampering, digest mismatch, and key mismatch
- durable reachability of stored assets through trees and the vault ref

These guarantees depend on:

- strong keys or passphrases
- correct operator handling of key material
- a non-compromised host
- intact repository state

## Explicit Non-Goals

`git-cas` does not attempt to provide:

- authorization or ACL enforcement
- user identity management
- key custody or centralized key management
- secure deletion from Git history or all storage backends
- metadata confidentiality
- protection against host compromise
- protection against compromised CI systems, terminals, or logs
- remote attestation or hardware-backed execution guarantees

## Operator Responsibilities

Operators are responsible for:

- generating and storing strong keys and passphrases
- avoiding secret leakage in environment variables, logs, and shell history
- treating local hosts and CI runners as part of the trust boundary
- understanding that encrypted content may still have visible metadata
- establishing backup and recovery procedures for key material
- rotating keys or passphrases before operational limits are approached

## How To Read This With Other Docs

- [SECURITY.md](../SECURITY.md)
  - crypto design, nonce limits, KDF guidance, and error semantics
- [ARCHITECTURE.md](../ARCHITECTURE.md)
  - system shape, storage layout, and service boundaries
- [docs/API.md](./API.md)
  - library and CLI reference
