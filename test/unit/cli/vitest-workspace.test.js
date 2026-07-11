import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import workspace from '../../../vitest.workspace.js';

describe('vitest workspace', () => {
  it('pins integration tests to single-file execution', () => {
    const integrationProject = workspace.find(
      (project) => project.test?.name === 'integration',
    );

    expect(integrationProject).toBeDefined();
    expect(integrationProject.test?.include).toEqual(['test/integration/**/*.test.js']);
    expect(integrationProject.test?.fileParallelism).toBe(false);
  });

  it('makes integration serialization explicit in every package script', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));

    for (const name of [
      'test:integration',
      'test:integration:node',
      'test:integration:bun',
      'test:integration:deno',
    ]) {
      expect(scripts[name], name).toContain('--no-file-parallelism');
    }
  });
});
