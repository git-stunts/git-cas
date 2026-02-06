# Contributing to @git-stunts/cas

## Philosophy
- **Domain Purity**: Keep crypto and chunking logic independent of Git implementation details.
- **Portability**: The `GitPersistencePort` allows swapping the storage backend.

## Development Workflow

1. **Install Dependencies**: Use `pnpm install` to ensure consistent dependency management.
2. **Install Git Hooks**: Run `bash scripts/install-hooks.sh` to set up local quality gates. This will ensure that linting and unit tests pass before every push.
3. **Run Tests Locally**:
   - `pnpm test` for unit tests.
   - `pnpm run test:integration` for integration tests (requires Docker).

## Quality Gates
We enforce high standards for code quality:
- **Linting**: Must pass `pnpm run lint`.
- **Unit Tests**: All unit tests must pass.
- **Integration Tests**: Must pass across Node, Bun, and Deno runtimes.

These gates are enforced both locally via git hooks and in CI/CD.