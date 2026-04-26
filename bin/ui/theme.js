/**
 * Shared visual language for git-cas terminal surfaces.
 *
 * The goal is not to paint everything. It is to give the shell a recognizable
 * voice with a small, consistent set of semantic color roles.
 */

import { parseAnsiToSurface, extendTheme, CYAN_MAGENTA } from '@flyingrobots/bijou';

export const GIT_CAS_PALETTE = {
  ivory: [246, 239, 221],
  sand: [224, 212, 186],
  brass: [247, 196, 90],
  copper: [224, 123, 57],
  ember: [109, 48, 20],
  teal: [50, 205, 194],
  deepTeal: [18, 96, 96],
  orchid: [235, 92, 172],
  plum: [104, 38, 84],
  lime: [182, 224, 78],
  moss: [52, 110, 57],
  sky: [123, 170, 247],
  indigo: [40, 74, 126],
  ruby: [230, 89, 111],
  wine: [117, 29, 45],
  slate: [148, 163, 184],
  smoke: [92, 104, 125],
  ink: [12, 16, 24],
};

/**
 * Convert an [r, g, b] palette tuple to a TokenValue hex string.
 *
 * @param {[number, number, number]} rgb
 * @returns {string}
 */
function rgbToHex(rgb) {
  return `#${rgb.map((ch) => ch.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Bijou v5 theme derived from the git-cas palette.
 *
 * Extends the CYAN_MAGENTA base with git-cas semantic color overrides.
 * Dashboard views will pass this to `startApp()` once the full framed-app
 * migration is complete; for now it is exported for incremental adoption.
 */
export const GIT_CAS_THEME = extendTheme(CYAN_MAGENTA, {
  status: {
    success: { hex: rgbToHex(GIT_CAS_PALETTE.lime) },
    warning: { hex: rgbToHex(GIT_CAS_PALETTE.brass) },
    error: { hex: rgbToHex(GIT_CAS_PALETTE.ruby) },
    info: { hex: rgbToHex(GIT_CAS_PALETTE.sky) },
    muted: { hex: rgbToHex(GIT_CAS_PALETTE.slate) },
  },
});

const TEXT_TONES = {
  brand: { fg: GIT_CAS_PALETTE.brass, bold: true },
  accent: { fg: GIT_CAS_PALETTE.teal, bold: true },
  primary: { fg: GIT_CAS_PALETTE.ivory },
  secondary: { fg: GIT_CAS_PALETTE.sand },
  subdued: { fg: GIT_CAS_PALETTE.slate },
  info: { fg: GIT_CAS_PALETTE.sky, bold: true },
  success: { fg: GIT_CAS_PALETTE.lime, bold: true },
  warning: { fg: GIT_CAS_PALETTE.brass, bold: true },
  danger: { fg: GIT_CAS_PALETTE.ruby, bold: true },
};

const CHIP_TONES = {
  brand: { fg: GIT_CAS_PALETTE.ivory, bg: GIT_CAS_PALETTE.ember, bold: true },
  info: { fg: GIT_CAS_PALETTE.ivory, bg: GIT_CAS_PALETTE.deepTeal, bold: true },
  accent: { fg: GIT_CAS_PALETTE.ivory, bg: GIT_CAS_PALETTE.plum, bold: true },
  warning: { fg: GIT_CAS_PALETTE.ivory, bg: [148, 82, 23], bold: true },
  success: { fg: GIT_CAS_PALETTE.ivory, bg: GIT_CAS_PALETTE.moss, bold: true },
  danger: { fg: GIT_CAS_PALETTE.ivory, bg: GIT_CAS_PALETTE.wine, bold: true },
  neutral: { fg: GIT_CAS_PALETTE.ivory, bg: [51, 65, 85], bold: true },
};

/**
 * Apply semantic git-cas styling to one text fragment.
 *
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @param {string} text
 * @param {{
 *   tone?: keyof typeof TEXT_TONES,
 *   fg?: [number, number, number],
 *   bg?: [number, number, number],
 *   bold?: boolean,
 * }} [options]
 * @returns {string}
 */
export function themeText(ctx, text, options = {}) {
  return applyThemeSpec(ctx, text, resolveSpec(options));
}

/**
 * Create a one-line surface for inline shell chrome.
 *
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @param {string} text
 * @param {Parameters<typeof themeText>[2]} [options]
 * @returns {import('@flyingrobots/bijou').Surface}
 */
export function inlineSurface(ctx, text, options = {}) {
  return parseAnsiToSurface(themeText(ctx, text, options), Math.max(1, text.length), 1);
}

/**
 * Create a compact filled chip surface.
 *
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @param {string} label
 * @param {keyof typeof CHIP_TONES} [tone]
 * @returns {import('@flyingrobots/bijou').Surface}
 */
export function chipSurface(ctx, label, tone = 'neutral') {
  const text = ` ${label} `;
  const spec = CHIP_TONES[tone] ?? CHIP_TONES.neutral;
  return inlineSurface(ctx, text, spec);
}

/**
 * Create a compact filled chip as ANSI text for string-based renderers.
 *
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @param {string} label
 * @param {keyof typeof CHIP_TONES} [tone]
 * @returns {string}
 */
export function chipText(ctx, label, tone = 'neutral') {
  const text = ` ${label} `;
  const spec = CHIP_TONES[tone] ?? CHIP_TONES.neutral;
  return themeText(ctx, text, spec);
}

/**
 * Render a section-eyebrow line used inside panels and drawers.
 *
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @param {string} label
 * @param {keyof typeof TEXT_TONES} [tone]
 * @returns {string}
 */
export function sectionHeading(ctx, label, tone = 'brand') {
  return themeText(ctx, `◆ ${label}`, { tone, bold: true });
}

/**
 * Render a subdued shell rule.
 *
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @param {number} width
 * @returns {string}
 */
export function shellRule(ctx, width) {
  return themeText(ctx, '─'.repeat(Math.max(1, width)), { tone: 'subdued' });
}

/**
 * Resolve a semantic text spec from a tone and optional overrides.
 *
 * @param {Parameters<typeof themeText>[2]} [options]
 * @returns {{ fg?: [number, number, number], bg?: [number, number, number], bold: boolean }}
 */
function resolveSpec(options = {}) {
  const tone = options.tone ? TEXT_TONES[options.tone] : null;
  return {
    fg: options.fg ?? tone?.fg,
    bg: options.bg ?? tone?.bg,
    bold: options.bold ?? tone?.bold ?? false,
  };
}

/**
 * Apply resolved foreground/background/bold styling.
 *
 * @param {import('@flyingrobots/bijou').BijouContext} ctx
 * @param {string} text
 * @param {{ fg?: [number, number, number], bg?: [number, number, number], bold: boolean }} spec
 * @returns {string}
 */
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
