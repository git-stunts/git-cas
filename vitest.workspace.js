import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.js',
    test: {
      name: 'unit',
      include: ['test/unit/**/*.test.js'],
    },
  },
  {
    extends: './vitest.config.js',
    test: {
      name: 'integration',
      include: ['test/integration/**/*.test.js'],
      // Integration files spawn real git/CLI subprocesses; keep them single-file
      // to avoid Bun/Deno EPIPE races regardless of how Vitest is invoked.
      fileParallelism: false,
    },
  },
  {
    extends: './vitest.config.js',
    test: {
      name: 'benchmark',
      include: ['test/benchmark/**/*.bench.js'],
    },
  },
]);
