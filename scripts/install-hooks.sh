#!/usr/bin/env bash

# install-hooks.sh
# Configures the local git repository to use the project's custom hooks.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="${SCRIPT_DIR}/git-hooks"

# Make all hooks executable
chmod +x "${HOOKS_DIR}"/*

# Point git to our hooks directory using absolute path
git config core.hooksPath "${HOOKS_DIR}"

echo "✅ Git hooks installed from ${HOOKS_DIR}"
echo "Current hooks directory: $(git config core.hooksPath)"