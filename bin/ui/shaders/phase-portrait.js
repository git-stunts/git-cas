/**
 * Phase portrait shader for the title screen.
 * Adapts the polynomial roots phase visualization to the terminal grid.
 */

/**
 * HSL to RGB conversion helper.
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {[number, number, number]}
 */
function hslToRgb(h, s, l) {
  let r; let g; let b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) {t += 1;}
      if (t > 1) {t -= 1;}
      if (t < 1/6) {return p + (q - p) * 6 * t;}
      if (t < 1/2) {return q;}
      if (t < 2/3) {return p + (q - p) * (2/3 - t) * 6;}
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

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
 * Maps an angle to a twilight-like color map.
 * @param {number} angle 
 * @returns {string} hex color
 */
function angleToTwilightHex(angle) {
  // Map angle from -PI..PI to 0..1
  const normalized = (angle + Math.PI) / (2 * Math.PI);
  // We can simulate twilight with HSL.
  // Real twilight is more complex, but a hue sweep from purple/blue to orange/red works decently well.
  const rgb = hslToRgb(normalized, 0.65, 0.45);
  return rgbToHex(rgb[0], rgb[1], rgb[2]);
}

/**
 * @param {import('@flyingrobots/bijou-tui').ShaderParams} params
 * @returns {import('@flyingrobots/bijou').Cell | string}
 */
export function phasePortraitShader({ u, v, time }) {
  // Grid bounds mapping u,v (0..1) to x,y (-1.5..1.5)
  const dx = 1.5;
  const dy = 1.5;
  const zx = (u * 2 - 1) * dx;
  const zy = (v * 2 - 1) * dy;

  const nRoots = 8;
  let totalAngle = 0;

  for (let i = 0; i < nRoots; i++) {
    // Generate pseudo-random orbit
    // Fixed random-ish radius for each root
    const r = Math.sqrt(((i + 1) * 0.6180339887) % 1.0);
    // Different rotation speeds to make them move around
    const th = ((i + 1) * 2.39996) + time * (0.2 + i * 0.05);
    
    const rx = r * Math.cos(th);
    const ry = r * Math.sin(th);
    
    totalAngle += Math.atan2(zy - ry, zx - rx);
  }

  // Wrap total angle to -PI to PI
  let ang = (totalAngle + Math.PI) % (2 * Math.PI);
  if (ang < 0) {ang += 2 * Math.PI;}
  ang -= Math.PI;

  const hex = angleToTwilightHex(ang);

  // Return a solid colored cell
  return { char: ' ', bg: hex, empty: false };
}
