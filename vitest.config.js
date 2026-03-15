import { defineConfig } from 'vitest/config';

const isIntegrationRun = process.argv.some((arg) => arg.includes('test/integration'));

export default defineConfig({
  test: {
    // Integration files spawn real git/CLI subprocesses; Bun's parallel
    // file runner can surface nondeterministic EPIPEs when they overlap.
    fileParallelism: !isIntegrationRun,
  },
});
