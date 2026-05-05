import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function dockerStage(name) {
  const dockerfile = read('Dockerfile');
  const start = dockerfile.indexOf(`FROM ubuntu-base AS ${name}`);
  const next = dockerfile.indexOf('\n# ---', start + 1);
  return dockerfile.slice(start, next === -1 ? undefined : next);
}

describe('release Docker test context', () => {
  it('keeps Markdown docs available to package and release truth tests', () => {
    const dockerignore = read('.dockerignore');

    expect(dockerignore).not.toMatch(/^\\*\\.md$/mu);
  });

  it('provides npm in Bun and Deno unit-test images for npm pack assertions', () => {
    expect(dockerStage('bun')).toContain("COPY --from=node-runtime /usr/local/ /usr/local/");
    expect(dockerStage('deno')).toContain("COPY --from=node-runtime /usr/local/ /usr/local/");
  });
});
