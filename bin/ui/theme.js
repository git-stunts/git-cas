/**
 * Shared visual language for git-cas terminal surfaces.
 * 
 * BIJOU_CYBER_HEX Theme: Derived from the Organic Flow SOC aesthetic.
 */

import { parseAnsiToSurface, extendTheme, CYAN_MAGENTA } from '@flyingrobots/bijou';

export const GIT_CAS_PALETTE = {
  ghost: [251, 252, 252],    // #fbfcfc - Primary Text
  slate: [148, 163, 184],    // #94a3b8 - Secondary Text
  cyan: [7, 190, 184],       // #07beb8 - Brand / Success
  orange: [255, 133, 82],    // #ff8552 - Accent / Warning
  midnight: [29, 37, 43],    // #1d252b - Background Surface
  ink: [18, 14, 46],         // #120e2e - Deep Shadow
  ruby: [230, 89, 111],      // #e6596f - Danger
  sky: [123, 170, 247],      // #7baaf7 - Info
  deepSlate: [61, 75, 89],   // Subdued Chrome
};

function rgbToHex(rgb) {
  return `#${rgb.map((ch) => ch.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Full Bijou v5 theme for git-cas.
 */
export const GIT_CAS_THEME = extendTheme(CYAN_MAGENTA, {
  surface: {
    background: { hex: rgbToHex(GIT_CAS_PALETTE.midnight) },
    foreground: { hex: rgbToHex(GIT_CAS_PALETTE.ghost) },
  },
  panel: {
    background: { hex: rgbToHex(GIT_CAS_PALETTE.midnight) },
    border: { hex: rgbToHex(GIT_CAS_PALETTE.deepSlate) },
    title: { hex: rgbToHex(GIT_CAS_PALETTE.cyan), bold: true },
  },
  status: {
    success: { hex: rgbToHex(GIT_CAS_PALETTE.cyan) },
    warning: { hex: rgbToHex(GIT_CAS_PALETTE.orange) },
    error: { hex: rgbToHex(GIT_CAS_PALETTE.ruby) },
    info: { hex: rgbToHex(GIT_CAS_PALETTE.sky) },
    muted: { hex: rgbToHex(GIT_CAS_PALETTE.slate) },
  },
});

const TEXT_TONES = {
  brand: { fg: GIT_CAS_PALETTE.cyan, bold: true },
  accent: { fg: GIT_CAS_PALETTE.orange, bold: true },
  primary: { fg: GIT_CAS_PALETTE.ghost },
  secondary: { fg: GIT_CAS_PALETTE.slate },
  subdued: { fg: GIT_CAS_PALETTE.deepSlate },
  info: { fg: GIT_CAS_PALETTE.sky, bold: true },
  success: { fg: GIT_CAS_PALETTE.cyan, bold: true },
  warning: { fg: GIT_CAS_PALETTE.orange, bold: true },
  danger: { fg: GIT_CAS_PALETTE.ruby, bold: true },
};

export function themeText(ctx, text, options = {}) {
  return applyThemeSpec(ctx, text, resolveSpec(options));
}

export function inlineSurface(ctx, text, options = {}) {
  const styled = themeText(ctx, text, options);
  const s = parseAnsiToSurface(styled, Math.max(1, text.length), 1);
  // Enforce theme background on all cells
  const bg = rgbToHex(GIT_CAS_PALETTE.midnight);
  for (let i = 0; i < s.buffer.length; i++) {
    // We can't set .bg directly on numbers in packed buffers, 
    // but in tests it might be an object if not packed.
    if (typeof s.buffer[i] === 'object') {
      s.buffer[i].bg = bg;
    }
  }
  return s;
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
