# Architecture: @git-stunts/cas

Content Addressable Store (CAS) for Git.

## 🧱 Core Concepts

### Domain Layer (`src/domain/`)
- **Value Objects**: `Manifest` and `Chunk` represent the structured metadata of an asset.
- **Services**: `CasService` implements chunking, encryption, and manifest generation.

### Ports Layer (`src/ports/`)
- **GitPersistencePort**: Defines how blobs and trees are saved to Git.

### Infrastructure Layer (`src/infrastructure/`)
- **GitPersistenceAdapter**: Implementation of the port using `@git-stunts/plumbing`.

## 📂 Directory Structure

```
src/
├── domain/
│   ├── schemas/        # Zod and JSON schemas
│   ├── services/       # CasService
│   └── value-objects/  # Manifest, Chunk
├── infrastructure/
│   └── adapters/       # GitPersistenceAdapter
└── ports/              # GitPersistencePort
```
