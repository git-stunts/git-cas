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
});
