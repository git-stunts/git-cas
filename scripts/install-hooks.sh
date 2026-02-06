#!/usr/bin/env bash

# install-hooks.sh
# Configures the local git repository to use the project's custom hooks.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="${SCRIPT_DIR}/git-hooks"

# Make hooks executable
chmod +x "${HOOKS_DIR}/pre-push"

# Point git to our hooks directory
git config core.hooksPath "scripts/git-hooks"

echo "✅ Git hooks installed from ${HOOKS_DIR}"
echo "Current hooks directory: $(git config core.hooksPath)"
