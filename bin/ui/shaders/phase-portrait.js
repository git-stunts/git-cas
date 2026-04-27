/**
 * Phase portrait shader for the title screen.
 * Adapts the polynomial roots phase visualization to the terminal grid.
 */

const TWILIGHT_STOPS = [
  [228, 207, 212], // Light pinkish-white
  [120, 130, 180], // Slate blue/periwinkle
  [50, 40, 80],    // Dark purple
  [30, 20, 40],    // Deep midnight/black
  [150, 60, 80],   // Deep red/burgundy
  [210, 130, 110], // Warm orange
  [228, 207, 212]  // Light pinkish-white
];

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
function rgbToHex(r, g, b) {
  return `#${  [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? `0${  hex}` : hex;
  }).join('')}`;
}

/**
 * Maps a normalized value [0..1] to the twilight colormap.
 * @param {number} t
 * @returns {string} hex color
 */
function twilightHex(t) {
  t = Math.max(0, Math.min(1, t));
  const max = TWILIGHT_STOPS.length - 1;
  const scaled = t * max;
  const idx = Math.floor(scaled);
  if (idx >= max) {return rgbToHex(TWILIGHT_STOPS[max][0], TWILIGHT_STOPS[max][1], TWILIGHT_STOPS[max][2]);}
  
  const frac = scaled - idx;
  const c1 = TWILIGHT_STOPS[idx];
  const c2 = TWILIGHT_STOPS[idx + 1];
  
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * frac);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * frac);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * frac);
  return rgbToHex(r, g, b);
}

/**
 * @param {import('@flyingrobots/bijou-tui').ShaderParams} params
 * @returns {import('@flyingrobots/bijou').Cell | string}
 */
export function phasePortraitShader({ u, v, time }) {
  // Grid bounds mapping u,v (0..1) to x,y (-1.5..1.5)
  // Adjust aspect ratio since we will be using sub-cell 'quad' resolution (2:2 or roughly 1:1 visually)
  // The 'quad' resolution mode samples at 2x2 per cell, bringing the aspect ratio much closer to 1:1
  // We'll leave the UV multiplier alone, or apply a slight correction if necessary.
  const dx = 1.5;
  const dy = 1.5;
  const zx = (u * 2 - 1) * dx;
  const zy = (v * 2 - 1) * dy;

  const nRoots = 8;
  let totalAngle = 0;

  for (let i = 0; i < nRoots; i++) {
    // Generate pseudo-random orbit
    const r = Math.sqrt(((i + 1) * 0.6180339887) % 1.0);
    const th = ((i + 1) * 2.39996) + time * (0.2 + i * 0.05);
    
    const rx = r * Math.cos(th);
    const ry = r * Math.sin(th);
    
    totalAngle += Math.atan2(zy - ry, zx - rx);
  }

  // Wrap total angle to 0..2PI
  let ang = (totalAngle + Math.PI) % (2 * Math.PI);
  if (ang < 0) {
    ang += 2 * Math.PI;
  }
  
  // Normalize to 0..1 for colormap
  const t = ang / (2 * Math.PI);

  const hex = twilightHex(t);

  // Return hex string. When using `canvas` with resolution 'quad', Bijou expects the shader
  // to return a color string which it will downsample into block characters.
  return hex;
}
