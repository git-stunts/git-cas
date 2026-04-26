#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * @fileoverview Stamps build metadata into build-info.json.
 *
 * Run before npm publish to bake the git SHA into the package.
 * In development, the CLI reads the SHA from git directly.
 *
 * Usage: node scripts/stamp-build.js
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '../build-info.json');

const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const timestamp = new Date().toISOString();

const info = { sha, timestamp };
writeFileSync(outPath, `${JSON.stringify(info, null, 2)}\n`);
console.log(`Stamped build-info.json: ${sha} @ ${timestamp}`);
