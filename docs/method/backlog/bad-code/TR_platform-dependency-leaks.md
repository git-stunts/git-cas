# TR — Platform Dependency Leaks

Legend: [TR — Truth](../../legends/TR-truth.md)

## Idea

`src/domain/services/CasService.js` currently imports `node:zlib` and `node:stream`. This violates the hexagonal goal of keeping the domain logic isolated from the physical platform. These imports prevent the core from being used in browser-native or edge environments without heavy polyfilling.

Extract compression and stream handling into a dedicated `StreamPort` and `CompressionPort`. Provide Node-specific adapters in `src/infrastructure/adapters/` and wire them through the facade.

## Why

1. **Multi-Runtime Integrity**: Ensures the domain is truly portable across Node, Bun, Deno, and the Web.
2. **Testability**: Allows for in-memory stream mocking without relying on Node's EventEmitter-based stream implementation.
3. **Purity**: Aligns the project with the industrial-grade standard established across the monorepo.

## Effort

Medium — requires defining the new ports and refactoring the store/restore pipelines to use them.
