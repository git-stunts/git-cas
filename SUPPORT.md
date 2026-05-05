# Support

This project is maintained as an open-source library and CLI. Support is
best-effort unless a separate commercial agreement exists.

## Maintainer Contact

Primary maintainer: [James Ross](mailto:james@flyingrobots.dev).

Use GitHub issues for normal bugs, documentation corrections, and feature
requests. Use private email for conduct reports, suspected vulnerabilities, or
anything that should not be posted publicly.

## Before Opening an Issue

Check these documents first:

- [README.md](./README.md) for quick start and feature overview
- [GUIDE.md](./GUIDE.md) for normal CLI and library workflows
- [ADVANCED_GUIDE.md](./ADVANCED_GUIDE.md) for internals, security limits, and
  direct service construction
- [docs/EXTENDING.md](./docs/EXTENDING.md) for custom adapters and extension
  points
- [SECURITY.md](./SECURITY.md) for security boundaries and vulnerability
  handling
- [CHANGELOG.md](./CHANGELOG.md) and [UPGRADING.md](./UPGRADING.md) for release
  and migration notes

## What To Include

For bugs or usage questions, include:

- `git-cas` version
- runtime and version (`node --version`, Bun, or Deno)
- operating system
- the exact command or API call
- the relevant manifest/vault shape with secrets removed
- full error output, including `CasError.code` and `meta` when available
- whether the repository is bare or worktree-backed

Do not paste passphrases, raw encryption keys, key files, private vault
contents, or unreduced proprietary artifacts into public issues.

## Security Reports

Do not open public issues for suspected vulnerabilities. Use the private
reporting path in [SECURITY.md](./SECURITY.md) and include a minimal
reproduction, impact assessment, affected versions, and any known mitigations.

## Expected Response

Issues with clear reproductions and release impact are handled first. Feature
requests should describe the user workflow, the current friction, and why the
existing facade, CLI, agent, or extension points cannot cover the need.
