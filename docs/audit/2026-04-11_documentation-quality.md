# AUDIT: DOCUMENTATION QUALITY (2026-04-11)

## 1. ACCURACY & EFFECTIVENESS ASSESSMENT

- **1.1. Core Mismatch:**
    - **Answer:** The `App` facade in `index.js` is described as "orchestration glue," but the `CasService` still carries most of the orchestration weight. The root `README.md` implies that `git-cas` can be used as a secrets management platform, but the "What It Is Not" section correctly refutes this. The most significant mismatch is in the `Quick Start` library example, which shows `ContentAddressableStore.createJson` while the code also supports lazy construction via the default constructor.

- **1.2. Audience & Goal Alignment:**
    - **Answer:**
        - **Target Audience:** Backend engineers and DevOps operators.
        - **Top 3 Questions addressed?**
            1. **"How do I store binary blobs in Git?"**: Yes (README Quick Start).
            2. **"Is it secure?"**: Yes (`SECURITY.md` and `THREAT_MODEL.md`).
            3. **"How does it scale?"**: Yes (`ADVANCED_GUIDE.md` Merkle section).

- **1.3. Time-to-Value (TTV) Barrier:**
    - **Answer:** Understanding the relationship between a `Manifest`, a `Tree`, and the `Vault`. The documentation uses these terms interchangeably in some places, which can confuse a new developer trying to understand the system of record.

## 2. REQUIRED UPDATES & COMPLETENESS CHECK

- **2.1. README.md Priority Fixes:**
    1. **Library Entrypoints**: Clarify the difference between `createJson`, `createCbor`, and the base constructor.
    2. **Vault Initialization**: Emphasize that `vault init` is a prerequisite for slug-based workflows.
    3. **Agent Protocol**: Add a one-liner explaining that `git-cas agent` provides machine-readable JSONL output for automation.

- **2.2. Missing Standard Documentation:**
    1. **`CONTRIBUTING.md`**: Exists, but needs to be aligned with the new `METHOD.md` and the "Red-Green-Retro" cycle loop.
    2. **`SECURITY.md`**: Needs to explicitly mention the "Substrate" vs "Bedrock" terminology used in sister projects for consistency.

- **2.3. Supplementary Documentation (Docs):**
    - **Answer:** **Encryption Envelope Doctrine**. A dedicated doc explaining the DEK/KEK model, multi-recipient support, and how recipient mutation works without re-encrypting chunks.

## 3. FINAL ACTION PLAN

- **3.1. Recommendation Type:** **A. Incremental updates to the existing README and documentation.** (The recent overhaul established the manifests; now they need terminological alignment and deep-track detail).

- **3.2. Deliverable (Prompt Generation):** `Align all code examples in README.md and GUIDE.md with current CasService method signatures. Create 'docs/ENVELOPE_ENCRYPTION.md' detailing the cryptographic model. Update CONTRIBUTING.md to reference the METHOD.md cycle loop.`

- **3.3. Mitigation Prompt:** `Update 'README.md' and root 'GUIDE.md' to ensure all library examples use the most ergonomic factory methods. Create a new manifest 'docs/ENVELOPE_ENCRYPTION.md' explaining the DEK/KEK model, recipient management, and key rotation mechanics. Ensure all documents use the term 'Substrate' to refer to Git's object database for consistency with the sister repositories.`
