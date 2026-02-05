#!/usr/bin/env bats
# Run: bats --jobs 3 test/platform/runtimes.bats

@test "Node.js: full test suite passes" {
  docker compose run --rm test-node
}

@test "Bun: full test suite passes" {
  docker compose run --rm test-bun
}

@test "Deno: full test suite passes" {
  docker compose run --rm test-deno
}
