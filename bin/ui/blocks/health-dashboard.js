/**
 * HealthDashboard block — structured doctor report rendering with badges.
 *
 * Takes a pre-computed DoctorReport and returns a formatted string
 * with badge-decorated status, key metrics, and issue details.
 */

import { badge, surfaceToString } from '@flyingrobots/bijou';
import { hstackSurface } from '@flyingrobots/bijou-tui';
import { themeText } from '../theme.js';

/**
 * @typedef {import('../vault-report.js').DoctorReport} DoctorReport
 * @typedef {import('../vault-report.js').DoctorIssue} DoctorIssue
 * @typedef {import('@flyingrobots/bijou').BijouContext} BijouContext
 */

/** @type {Record<string, 'success' | 'warning' | 'danger'>} */
const STATUS_VARIANTS = {
  ok: 'success',
  warn: 'warning',
  fail: 'danger',
};

/**
 * Format bytes with binary units.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 bytes';
  }
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Render the status badge row.
 *
 * @param {DoctorReport} report
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderHealthStatusRow(report, ctx) {
  const variant = STATUS_VARIANTS[report.status] ?? 'danger';
  const statusBadge = badge(report.status.toUpperCase(), { variant, ctx });
  const vaultBadge = badge(report.hasVault ? 'vault present' : 'no vault', {
    variant: report.hasVault ? 'info' : 'warning',
    ctx,
  });
  const encBadge = badge(report.metadataEncrypted ? 'encrypted' : 'plaintext', {
    variant: report.metadataEncrypted ? 'warning' : 'neutral',
    ctx,
  });
  return surfaceToString(hstackSurface(1, statusBadge, vaultBadge, encBadge), ctx.style);
}

/**
 * Render key health metrics.
 *
 * @param {DoctorReport} report
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderHealthMetrics(report, ctx) {
  const lines = [
    `${themeText(ctx, 'entries', { tone: 'accent' })}        ${report.entryCount}`,
    `${themeText(ctx, 'valid', { tone: 'accent' })}          ${report.validEntries}`,
    `${themeText(ctx, 'invalid', { tone: 'accent' })}        ${report.invalidEntries}`,
    `${themeText(ctx, 'logical size', { tone: 'accent' })}   ${formatBytes(report.stats.totalLogicalSize)}`,
    `${themeText(ctx, 'chunk refs', { tone: 'accent' })}     ${report.stats.totalChunkRefs}`,
    `${themeText(ctx, 'unique chunks', { tone: 'accent' })}  ${report.stats.uniqueChunks}`,
    `${themeText(ctx, 'dedup ratio', { tone: 'accent' })}    ${report.stats.dedupRatio.toFixed(2)}x`,
  ];
  return lines.join('\n');
}

/**
 * Render issue details with severity badges.
 *
 * @param {DoctorIssue[]} issues
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderHealthIssues(issues, ctx) {
  if (issues.length === 0) {
    return '';
  }
  const lines = [themeText(ctx, `Issues (${issues.length})`, { tone: 'danger', bold: true })];
  for (const issue of issues) {
    const scope = issue.scope === 'entry'
      ? `${themeText(ctx, issue.slug ?? '-', { tone: 'primary' })} `
      : '';
    lines.push(`  ${scope}${themeText(ctx, issue.code, { tone: 'warning' })}: ${issue.message}`);
  }
  return lines.join('\n');
}

/**
 * Render a full health dashboard: status badges + metrics + issues.
 *
 * @param {DoctorReport} report
 * @param {BijouContext} ctx
 * @returns {string}
 */
export function renderHealthDashboard(report, ctx) {
  const sections = [
    renderHealthStatusRow(report, ctx),
    renderHealthMetrics(report, ctx),
  ];
  const issues = renderHealthIssues(report.issues, ctx);
  if (issues) {
    sections.push(issues);
  }
  return sections.join('\n\n');
}
