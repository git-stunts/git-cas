import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');

const PLATFORM_NEUTRAL_DIRS = [
  'src/domain',
  'src/ports',
  'src/helpers',
  'src/infrastructure/chunkers',
  'src/infrastructure/codecs',
];

const FORBIDDEN_CORE_PATTERNS = [
  { name: 'node imports', pattern: /(?:from\s+|import\s*\()\s*['"]node:/ },
  { name: 'Buffer runtime APIs', pattern: /\bBuffer\s*[.(]/ },
  { name: 'global runtime detection', pattern: /\bglobalThis\b/ },
  { name: 'process globals', pattern: /\bprocess\b/ },
  { name: 'platform text codecs', pattern: /\bText(?:Encoder|Decoder)\b/ },
  { name: 'Node stream classes', pattern: /\b(?:Readable|Writable)\b/ },
];

describe('platform boundary', () => {
  it('keeps domain, ports, helpers, chunkers, and codecs free of platform APIs', () => {
    const violations = [];

    for (const file of collectFiles(PLATFORM_NEUTRAL_DIRS)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const { name, pattern } of FORBIDDEN_CORE_PATTERNS) {
        if (pattern.test(source)) {
          violations.push(`${path.relative(repoRoot, file)}: ${name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps WebCryptoAdapter free of Node imports', () => {
    const source = readFileSync(path.join(repoRoot, 'src/infrastructure/adapters/WebCryptoAdapter.js'), 'utf8');
    expect(source).not.toMatch(/(?:from\s+|import\s*\()\s*['"]node:/);
  });
});

/**
 * @param {string[]} dirs
 * @returns {string[]}
 */
function collectFiles(dirs) {
  return dirs.flatMap((dir) => walk(path.join(repoRoot, dir)));
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}
