/**
 * @fileoverview Resolves the full version string: semver + git SHA.
 *
 * In development (git repo present): reads SHA from git at runtime.
 * In published packages: reads SHA from build-info.json (stamped at publish time).
 * Fallback: version only, no SHA.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads the git SHA from build-info.json (published package).
 * @returns {string|null}
 */
export function readStampedSha() {
  try {
    const info = JSON.parse(
      readFileSync(path.resolve(__dirname, '../build-info.json'), 'utf8'),
    );
    return info.sha || null;
  } catch {
    return null;
  }
}

/**
 * Reads the git SHA from the live repo (development).
 * @returns {string|null}
 */
export function readGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Returns the full version string: `<semver>+<sha>` or just `<semver>`.
 * @param {string} semver - The package version from package.json.
 * @returns {string}
 */
export function resolveVersionString(
  semver,
  { readGitSha: readGit = readGitSha, readStampedSha: readStamped = readStampedSha } = {}
) {
  const sha = readGit() || readStamped();
  return sha ? `${semver}+${sha}` : semver;
}
