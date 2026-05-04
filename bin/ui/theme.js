/**
 * Shared visual language for git-cas terminal surfaces.
 */

import { parseAnsiToSurface } from '@flyingrobots/bijou';

export const GIT_CAS_PALETTE = {
  ghost: [251, 252, 252],
  pearl: [228, 235, 241],
  slate: [188, 203, 216],
  cyan: [35, 221, 210],
  orange: [255, 163, 102],
  midnight: [37, 49, 58],
  ink: [34, 39, 64],
  ruby: [255, 111, 136],
  sky: [151, 194, 255],
  violet: [186, 155, 255],
  deepSlate: [108, 130, 148],
};

function rgbToHex(rgb) {
  return `#${rgb.map((ch) => ch.toString(16).padStart(2, '0')).join('')}`;
}

function token(rgb, modifiers = [], bg) {
  return {
    hex: rgbToHex(rgb),
    fgRGB: rgb,
    ...(bg ? { bg: rgbToHex(bg), bgRGB: bg } : {}),
    ...(modifiers.length ? { modifiers } : {}),
  };
}

const {
  ghost, pearl, slate, cyan, orange, midnight, ink, ruby, sky, violet, deepSlate,
} = GIT_CAS_PALETTE;

/**
 * Bijou v5 theme for the git-cas cockpit.
 *
 * Keep this object aligned with Bijou's public Theme shape. App-specific
 * colors belong in local helpers, not in stray token groups that components
 * will never read.
 */
export const GIT_CAS_THEME = {
  name: 'git-cas-cockpit',
  status: {
    success: token(cyan, ['bold']),
    error: token(ruby, ['bold']),
    warning: token(orange, ['bold']),
    info: token(sky),
    pending: token(slate),
    active: token(cyan, ['bold']),
    muted: token(deepSlate),
  },
  semantic: {
    success: token(cyan, ['bold']),
    error: token(ruby, ['bold']),
    warning: token(orange, ['bold']),
    info: token(sky),
    accent: token(orange, ['bold']),
    muted: token(slate),
    primary: token(ghost),
  },
  gradient: {
    brand: [
      { pos: 0, color: cyan },
      { pos: 0.38, color: sky },
      { pos: 0.72, color: violet },
      { pos: 1, color: orange },
    ],
    progress: [
      { pos: 0, color: deepSlate },
      { pos: 0.5, color: sky },
      { pos: 1, color: cyan },
    ],
  },
  border: {
    primary: token(cyan),
    secondary: token(slate),
    success: token(cyan),
    warning: token(orange),
    error: token(ruby),
    muted: token(deepSlate),
  },
  ui: {
    cursor: token(cyan, ['bold']),
    scrollThumb: token(cyan),
    scrollTrack: token(deepSlate),
    sectionHeader: token(orange, ['bold']),
    logo: token(cyan, ['bold']),
    tableHeader: token(ghost, ['bold']),
    trackEmpty: token(deepSlate),
  },
  surface: {
    primary: token(ghost, [], midnight),
    secondary: token(pearl, [], [43, 58, 68]),
    elevated: token(ghost, [], [51, 68, 78]),
    overlay: token(ghost, [], ink),
    muted: token(slate, [], [31, 41, 49]),
  },
};

const TEXT_TONES = {
  brand: { fg: cyan, bold: true },
  accent: { fg: orange, bold: true },
  primary: { fg: ghost },
  secondary: { fg: slate },
  subdued: { fg: deepSlate },
  info: { fg: sky, bold: true },
  violet: { fg: violet, bold: true },
  success: { fg: cyan, bold: true },
  warning: { fg: orange, bold: true },
  danger: { fg: ruby, bold: true },
};

export function themeText(ctx, text, options = {}) {
  return applyThemeSpec(ctx, text, resolveSpec(options));
}

export function inlineSurface(ctx, text, options = {}) {
  const styled = themeText(ctx, text, options);
  return parseAnsiToSurface(styled, Math.max(1, text.length), 1);
}

export function sectionHeading(ctx, label, tone = 'brand') {
  return themeText(ctx, `◆ ${label}`, { tone, bold: true });
}

export function shellRule(ctx, width) {
  return themeText(ctx, '─'.repeat(Math.max(1, width)), { tone: 'subdued' });
}

function resolveSpec(options = {}) {
  const tone = options.tone ? TEXT_TONES[options.tone] : null;
  return {
    fg: options.fg ?? tone?.fg,
    bg: options.bg ?? tone?.bg,
    bold: options.bold ?? tone?.bold ?? false,
  };
}

function applyThemeSpec(ctx, text, spec) {
  let styled = text;
  if (spec.fg) {
    styled = ctx.style.rgb(spec.fg[0], spec.fg[1], spec.fg[2], styled);
  }
  if (spec.bg) {
    styled = ctx.style.bgRgb(spec.bg[0], spec.bg[1], spec.bg[2], styled);
  }
  if (spec.bold) {
    styled = ctx.style.bold(styled);
  }
  return styled;
}
