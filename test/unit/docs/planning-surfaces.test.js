import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function sectionBody(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) {
    return '';
  }

  const afterHeading = markdown.slice(start + heading.length);
  const nextSectionOffset = afterHeading.search(/\n## |\n### /);
  if (nextSectionOffset === -1) {
    return afterHeading;
  }
  return afterHeading.slice(0, nextSectionOffset);
}

function markdownLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
}

function statusLine(markdown) {
  return markdown.match(/^-\s+\*\*Status\*\*:\s*(.+)$/mu)?.[1] ?? '';
}

function activeLinksForLane(markdown, lane) {
  const body = sectionBody(markdown, `### \`${lane}/\``);
  const activeStart = body.indexOf('Active:');
  if (activeStart === -1) {
    return [];
  }
  const activeBody = body.slice(activeStart);
  const resolvedStart = activeBody.indexOf('\nResolved');
  return markdownLinks(resolvedStart === -1 ? activeBody : activeBody.slice(0, resolvedStart));
}

function laneFiles(lane) {
  return readdirSync(path.join(repoRoot, 'docs/method/backlog', lane))
    .filter((name) => !name.startsWith('.'))
    .sort();
}

function cycleDirs() {
  return readdirSync(path.join(repoRoot, 'docs/design'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

describe('planning surfaces', () => { // eslint-disable-line max-lines-per-function
  it('uses the canonical empty-state bullet across planning surfaces', () => {
    const checks = [
      ['docs/design/README.md', '## Landed METHOD Cycles'],
      ['docs/method/backlog/README.md', "### `inbox/`"],
      ['docs/legends/RL-relay.md', '## Current METHOD Backlog'],
      ['docs/method/legends/RL_relay.md', '## Current Backlog'],
    ];

    for (const [file, heading] of checks) {
      expect(sectionBody(read(file), heading)).toContain('- none currently');
    }
  });

  it('keeps the backlog index in sync with the live lane files', () => {
    const backlog = read('docs/method/backlog/README.md');

    const expectations = [
      ['### `asap/`', laneFiles('asap')],
      ['### `up-next/`', laneFiles('up-next')],
      ['### `cool-ideas/`', laneFiles('cool-ideas')],
      ['### `bad-code/`', laneFiles('bad-code')],
    ];

    for (const [heading, files] of expectations) {
      const links = markdownLinks(sectionBody(backlog, heading)).map((link) => path.basename(link)).sort();
      expect(links).toEqual(files);
    }
  });

  it('keeps the active design index in sync with numbered cycle directories', () => {
    const designReadme = read('docs/design/README.md');
    const links = markdownLinks(sectionBody(designReadme, '## Active METHOD Cycles'))
      .map((link) => link.split('/')[1])
      .sort();

    expect(links).toEqual(cycleDirs());
  });

  it('does not list resolved bad-code cards under Active', () => {
    const backlog = read('docs/method/backlog/README.md');
    const resolvedActiveCards = activeLinksForLane(backlog, 'bad-code')
      .map((link) => path.normalize(path.join('docs/method/backlog', link)))
      .filter((file) => statusLine(read(file)).startsWith('Resolved'));

    expect(resolvedActiveCards).toEqual([]);
  });

  it('keeps current legend backlog links pointed at real backlog files', () => {
    const files = [
      'docs/method/legends/TR_truth.md',
      'docs/legends/TR-truth.md',
    ];

    for (const file of files) {
      const section = sectionBody(read(file), '## Current Backlog') || sectionBody(read(file), '## Current METHOD Backlog');
      const links = markdownLinks(section);
      for (const link of links) {
        expect(() => read(path.join(path.dirname(file), link))).not.toThrow();
      }
    }
  });
});
