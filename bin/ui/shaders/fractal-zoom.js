/**
 * Mandelbrot fractal zoom shader for the title screen.
 * Zooms into a seahorse valley coordinate until float precision limits,
 * then loops back for a "forever" feel.
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

function rgbToHex(r, g, b) {
  return `#${  [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? `0${  hex}` : hex;
  }).join('')}`;
}

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
 * @returns {import('@flyingrobots/bijou').Cell}
 */
export function fractalZoomShader({ u, v, time }) {
  // Infinite zoom logic:
  // We use a modular time to reset the zoom factor before float precision breaks
  // Zoom period: 30 seconds
  const period = 30;
  const t = time % period;
  
  // Exponential zoom: 1.0 to 10^12
  const zoom = Math.pow(10, (t / period) * 12);
  
  // Center coordinate (Seahorse Valley)
  const cx = -0.743643887037158;
  const cy = 0.131825904205312;
  
  // Map UV to complex plane
  const x0 = cx + (u * 2 - 1) * (2.5 / zoom);
  const y0 = cy + (v * 2 - 1) * (2.5 / zoom);
  
  let x = 0;
  let y = 0;
  let iteration = 0;
  const maxIteration = 40;
  
  while (x * x + y * y <= 4 && iteration < maxIteration) {
    const xTemp = x * x - y * y + x0;
    y = 2 * x * y + y0;
    x = xTemp;
    iteration++;
  }
  
  if (iteration === maxIteration) {
    return { char: ' ', bg: '#000000' };
  }
  
  // Smooth coloring
  const mu = iteration + 1 - Math.log(Math.log(Math.sqrt(x * x + y * y))) / Math.log(2);
  const colorT = (mu / maxIteration) % 1.0;
  
  return { char: '█', fg: twilightHex(colorT), bg: '#1d252b' };
}
