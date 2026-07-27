import { describe, expect, it } from 'vitest';
import { doctorTheme, themeContrastRatio } from '@flyingrobots/bijou';

import { GIT_CAS_PALETTE, GIT_CAS_THEME, GIT_CAS_THEME_SAFE_PAIRS } from '../../../bin/ui/theme.js';

function hex(rgb) {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

describe('git-cas cockpit theme', () => {
  it('keeps every declared text/surface relationship at WCAG AA contrast', () => {
    const report = doctorTheme(GIT_CAS_THEME, {
      contrastPairs: GIT_CAS_THEME_SAFE_PAIRS,
    });

    expect(report.issues.filter((issue) => issue.kind === 'low-contrast')).toEqual([]);
  });

  it('keeps manually styled text tones readable on the primary canvas', () => {
    const canvas = GIT_CAS_THEME.ui.canvas.hex;
    const textColors = [
      GIT_CAS_PALETTE.ghost,
      GIT_CAS_PALETTE.slate,
      GIT_CAS_PALETTE.cyan,
      GIT_CAS_PALETTE.orange,
      GIT_CAS_PALETTE.ruby,
      GIT_CAS_PALETTE.sky,
      GIT_CAS_PALETTE.violet,
    ];

    for (const foreground of textColors) {
      expect(themeContrastRatio(hex(foreground), canvas)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
