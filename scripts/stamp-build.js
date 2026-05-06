#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * @fileoverview Stamps build metadata into build-info.json.
 *
 * Run before npm publish to bake the git SHA into the package.
 * In development, the CLI reads the SHA from git directly.
 *
 * Usage: node scripts/stamp-build.js [--quiet]
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '../build-info.json');
const quiet = process.argv.includes('--quiet');

const sha = resolveSha();
const timestamp = new Date().toISOString();

const info = { sha, timestamp };
writeFileSync(outPath, `${JSON.stringify(info, null, 2)}\n`);
if (!quiet) {
  console.log(`Stamped build-info.json: ${sha} @ ${timestamp}`);
}

function resolveSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return readExistingSha();
  }
}

function readExistingSha() {
  if (!existsSync(outPath)) {
    return 'unknown';
  }
  try {
    const existing = JSON.parse(readFileSync(outPath, 'utf8'));
    return typeof existing.sha === 'string' && existing.sha.length > 0 ? existing.sha : 'unknown';
  } catch {
    return 'unknown';
  }
}
