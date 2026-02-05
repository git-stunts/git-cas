# Architecture: @git-stunts/cas

Content Addressable Store (CAS) for Git.

## 🧱 Core Concepts

### Domain Layer (`src/domain/`)
- **Value Objects**: `Manifest` and `Chunk` represent the structured metadata of an asset.
- **Services**: `CasService` implements streaming chunking, encryption (AES-256-GCM), and manifest generation.

### Ports Layer (`src/ports/`)
- **GitPersistencePort**: Defines how blobs and trees are saved to Git.
- **CodecPort**: Defines how manifests are encoded (JSON, CBOR).

### Infrastructure Layer (`src/infrastructure/`)
- **Adapters**: `GitPersistenceAdapter` implementation using `@git-stunts/plumbing`.
- **Codecs**: `JsonCodec` and `CborCodec`.

## 🚀 Scalability & Limits

- **Chunk Size**: Configurable, default 256KB. Minimum 1KB.
- **Streaming**: Encryption and chunking are fully streamed. Memory usage is constant (O(1)) relative to file size.
- **Manifest Limit**: Currently, all chunk metadata is stored in a single flat `manifest` blob. For extremely large files (>100GB), the manifest itself may become unwieldy (linear growth). Future iterations may require a Merkle Tree structure for the manifest itself.

## 📂 Directory Structure

```text
src/
├── domain/
│   ├── schemas/        # Zod and JSON schemas
│   ├── services/       # CasService
│   └── value-objects/  # Manifest, Chunk
├── infrastructure/
│   ├── adapters/       # GitPersistenceAdapter
│   └── codecs/         # JsonCodec, CborCodec
└── ports/              # GitPersistencePort, CodecPort
```