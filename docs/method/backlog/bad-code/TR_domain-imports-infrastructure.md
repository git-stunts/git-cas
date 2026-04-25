# TR: CasService imports directly from infrastructure

- **File**: `src/domain/services/CasService.js:10,13`
- **Severity**: Medium
- **Category**: Architecture drift / dependency inversion violation

## Description

CasService imports `FixedChunker` and `NodeCompressionAdapter` from
`src/infrastructure/`. These are used as constructor defaults when the caller
doesn't provide them. A domain service should not know about infrastructure
implementations — this violates the hexagonal architecture's dependency rule.

The defaults should be wired in the facade layer (`index.js`) or via a factory,
not hard-coded in the domain service.

## Fix

1. Make `chunker` and `compressionAdapter` required constructor params (no defaults)
2. Move the default wiring to `ContentAddressableStore` facade in `index.js`
3. Remove the infrastructure imports from CasService
