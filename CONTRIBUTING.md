# Contributing to @git-stunts/cas

## Philosophy
- **Domain Purity**: Keep crypto and chunking logic independent of Git implementation details.
- **Portability**: The `GitPersistencePort` allows swapping the storage backend.

## Testing
- Use `npm test`.
- All domain logic should be tested with mocks for the persistence layer.
