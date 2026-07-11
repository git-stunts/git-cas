import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function jobBlock(source, jobName) {
  const match = source.match(
    new RegExp(`\\n  ${jobName}:\\n[\\s\\S]*?(?=\\n  [a-z0-9-]+:\\n|\\n*$)`, 'u')
  );
  return match?.[0] ?? '';
}

describe('release workflow publishing', () => {
  it('uses npm trusted publishing without globally self-upgrading npm', () => {
    const workflow = read('.github/workflows/release.yml');
    const publishJob = jobBlock(workflow, 'publish-npm');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('release_ref:');
    expect(publishJob).toContain('node-version: 24');
    expect(publishJob).toContain('package-manager-cache: false');
    expect(publishJob).toContain('npm --version');
    expect(publishJob).toContain('npm publish --access public');
    expect(publishJob).not.toMatch(/npm install -g npm@/u);
  });

  it('checks out the selected release ref before validation, tests, publish, and release creation', () => {
    const workflow = read('.github/workflows/release.yml');
    const jobs = ['validate', 'test', 'publish-npm', 'github-release'];

    for (const job of jobs) {
      expect(jobBlock(workflow, job)).toContain('ref: ${{ env.RELEASE_REF }}');
    }
  });

  it('opts the GitHub Release action into the Node 24 action runtime', () => {
    const workflow = read('.github/workflows/release.yml');
    const releaseJob = jobBlock(workflow, 'github-release');

    expect(releaseJob).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true');
    expect(releaseJob).not.toContain('ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION');
  });

  it('serializes every runtime integration command', () => {
    for (const relPath of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      const workflow = read(relPath);
      expect(workflow.match(/--no-file-parallelism/gu)).toHaveLength(3);
    }
  });
});
