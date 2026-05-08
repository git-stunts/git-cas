# git-cas Encryption Modes

`git-cas` supports three distinct envelope encryption schemes, each optimized for different security and performance profiles.

| Mode | Integrity | Privacy | Deduplication | Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **Whole** | Full Object | High | None | Small sensitive files (keys, configs). |
| **Framed** | Per-Frame | High | None | Standard large assets. Prevents blob swapping. |
| **Convergent**| Block-Level | Medium | **High** | Shared libraries or public binaries where storage cost is priority. |

## 1. Whole-Object Encryption (`whole`)
The entire file is encrypted as a single ciphertext. 
- **Mechanism:** AES-256-GCM with a random 96-bit nonce.
- **Deduplication:** None (each store creates a unique ciphertext even for identical content).
- **Integrity:** The GCM auth tag covers the entire object.

## 2. Framed Encryption (`framed`)
The default for v6.0.0. The file is split into chunks, and each chunk is encrypted as an independent AES-GCM "frame".
- **Mechanism:** AES-256-GCM. The frame index is bound to the AAD (Additional Authenticated Data).
- **Integrity Guarantee:** Prevents "Replay Attacks" or blob-swapping between different manifests, as each frame's metadata is cryptographically bound to its position in the asset.
- **Deduplication:** None.

## 3. Convergent Encryption (`convergent`)
Allows deduplication across different files or versions while still providing encryption at rest.
- **Mechanism:** The encryption key is derived from the SHA-256 hash of the content itself.
- **Trade-off:** Vulnerable to "Confirmation Attacks" (an attacker who guesses the content can verify its presence in the CAS).
- **Deduplication:** **Global**. Identical chunks across any file share the same ciphertext and OID.

## Key Management
All modes use **Envelope Encryption**:
1. A **Data Encryption Key (DEK)** is generated per asset (or per chunk).
2. The DEK is encrypted for one or more **Key Encryption Keys (KEKs)** (e.g., passphrases or OS keys).
3. The encrypted DEK is stored in the manifest or vault metadata.
