/**
 * Organic Flow shader for the title screen.
 * Recreates the dense Braille aesthetic of background.txt with liquid animation.
 * Uses Braille resolution (2x4 sub-pixels per cell).
 */

import { GIT_CAS_PALETTE } from '../theme.js';

let frameBuffer = new Int16Array(0);
let bufferW = 0;
let bufferH = 0;
let lastSimTime = -1;

const COLOR_STOPS = [
  GIT_CAS_PALETTE.cyan,
  GIT_CAS_PALETTE.sky,
  GIT_CAS_PALETTE.violet,
  GIT_CAS_PALETTE.orange,
  GIT_CAS_PALETTE.ruby,
  GIT_CAS_PALETTE.ghost,
];

const FLOW_PALETTE = Array.from({ length: 192 }, (_, index) =>
  interpolateColor(index / 191));

function rgbToHex(rgb) {
  return `#${rgb.map((ch) => ch.toString(16).padStart(2, '0')).join('')}`;
}

function interpolateColor(t) {
  const scaled = Math.max(0, Math.min(1, t)) * (COLOR_STOPS.length - 1);
  const index = Math.floor(scaled);
  const next = Math.min(COLOR_STOPS.length - 1, index + 1);
  const mix = scaled - index;
  return rgbToHex(COLOR_STOPS[index].map((ch, offset) =>
    Math.round(ch + (COLOR_STOPS[next][offset] - ch) * mix)));
}

function setBufferPixel(x, y, state) {
  if (x >= 0 && x < bufferW && y >= 0 && y < bufferH) {
    frameBuffer[y * bufferW + x] = state;
  }
}

function rasterizeFlow(time) {
  for (let py = 0; py < bufferH; py++) {
    const y = (py / bufferH) * 2.0 - 1.0;
    for (let px = 0; px < bufferW; px++) {
      const x = (px / bufferW) * 3.0 - 1.5;

      let v = Math.sin(x * 3.0 + time * 0.5);
      v += Math.sin((y * 4.0 + time * 0.7) * 1.5);
      v += Math.sin((x * 2.0 + y * 2.0 + time * 0.3) * 0.8);

      const cx = x + 0.5 * Math.sin(time * 0.2);
      const cy = y + 0.5 * Math.cos(time * 0.4);
      v += Math.sin(Math.sqrt(100.0 * (cx * cx + cy * cy) + 1.0) + time);

      const val = (v + 4.0) / 8.0;
      const dither = (Math.sin(px * 12.9898 + py * 78.233) * 43758.5453) % 1.0;
      const colorWave = Math.sin(x * 2.6 - y * 1.9 + time * 0.9)
        + Math.sin((x + y) * 3.1 + time * 0.35);
      const colorIndex = Math.floor((((colorWave + 2) / 4) ** 0.85) * (FLOW_PALETTE.length - 1));

      setBufferPixel(px, py, val > (0.41 + dither * 0.12) ? colorIndex : -1);
    }
  }
}

/**
 * @param {import('@flyingrobots/bijou-tui').ShaderParams} params
 * @returns {import('@flyingrobots/bijou').Cell | string}
 */
export function organicFlowShader({ u, v, time, uniforms }) {
  // Braille resolution is 2x4 per cell
  const tw = (uniforms?.width ?? 80) * 2;
  const th = (uniforms?.height ?? 24) * 4;

  if (tw !== bufferW || th !== bufferH) {
    bufferW = tw;
    bufferH = th;
    frameBuffer = new Int16Array(bufferW * bufferH);
    lastSimTime = -1;
  }

  if (time !== lastSimTime) {
    rasterizeFlow(time);
    lastSimTime = time;
  }

  const px = Math.floor(u * (bufferW - 1));
  const py = Math.floor(v * (bufferH - 1));
  const colorIndex = frameBuffer[py * bufferW + px];

  return colorIndex >= 0 ? FLOW_PALETTE[colorIndex] : ' ';
}
