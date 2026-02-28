# ADR-001: Vault as a Separate Domain Service Composed by the Facade

## Status

Accepted

## Context

`CasService` handles single-asset I/O: chunking, encryption, tree creation, and restore. Vault handles multi-asset lifecycle: ref indexing, slug management, history, and GC safety. Both services require the same three ports (persistence, codec, crypto) plus observability.

The question is whether vault logic should live inside `CasService` or as a separate domain service.

## Decision

Vault logic lives in `VaultService`, a separate domain service. `ContentAddressableStore` (the facade) composes both `CasService` and `VaultService`, wiring them to shared port instances. The facade exposes a unified API and provides a `getVaultService()` accessor for advanced use cases.

## Rationale

- **Single Responsibility**: CasService owns content-addressed storage mechanics (chunking, crypto, trees). VaultService owns lifecycle management (ref indexing, slug resolution, GC safety). These are distinct domain concerns.
- **Independent testability**: Each service can be unit-tested in isolation with mocked ports. No need to set up vault infrastructure to test encryption, or vice versa.
- **Independent injectability**: Consumers who only need CAS operations (e.g., a build tool storing artifacts) can instantiate `CasService` directly without vault overhead.
- **Facade simplicity**: The facade provides the "batteries-included" developer experience. Users get one import, one constructor, and a flat method surface.

## Alternatives Rejected

1. **Merge vault into CasService** — Bloats the core service with ref management, slug indexing, and history tracking. Mixes content mechanics with lifecycle concerns. Makes CasService harder to test and reason about.

2. **Separate facade per service** — Users would manage two objects (`cas` and `vault`) and wire ports manually. Doubles the setup boilerplate and creates coupling at the call site instead of inside the library.

## Consequences

- The facade has 7 vault pass-through methods (`vaultInit`, `vaultStore`, `vaultRestore`, `vaultList`, `vaultInfo`, `vaultRemove`, `vaultHistory`). This is acceptable given the flat API benefit.
- Users must go through the facade or explicitly create `VaultService` — there is no implicit vault available on a bare `CasService`.
- VaultService can evolve independently (e.g., named vaults, cross-repo sync) without touching CasService internals.
