/**
 * Mandelbrot fractal zoom shader for the title screen.
 * Optimized via monolithic rasterization for 60fps performance.
 */

const TWILIGHT_STOPS = [
  [228, 207, 212], [120, 130, 180], [50, 40, 80],
  [30, 20, 40], [150, 60, 80], [210, 130, 110], [228, 207, 212]
];

function rgbToHex(r, g, b) {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

const PALETTE = new Array(256).fill(0).map((_, i) => twilightHex(i / 255));

function twilightHex(t) {
  const nt = Math.max(0, Math.min(1, t));
  const max = TWILIGHT_STOPS.length - 1;
  const scaled = nt * max;
  const idx = Math.floor(scaled);
  if (idx >= max) {return rgbToHex(...TWILIGHT_STOPS[max]);}
  const frac = scaled - idx;
  const c1 = TWILIGHT_STOPS[idx];
  const c2 = TWILIGHT_STOPS[idx + 1];
  return rgbToHex(
    Math.round(c1[0] + (c2[0] - c1[0]) * frac),
    Math.round(c1[1] + (c2[1] - c1[1]) * frac),
    Math.round(c1[2] + (c2[2] - c1[2]) * frac)
  );
}

let frameBuffer = new Int16Array(0);
let bufferW = 0;
let bufferH = 0;
let lastSimTime = -1;

function rasterizeFractal(time) {
  const period = 20;
  const t = time % period;
  const zoom = Math.pow(10, (t / period) * 7);
  const cx = -0.743643135;
  const cy = 0.131825963;
  const maxIteration = 100 + Math.floor((t / period) * 300);
  const invZoom = 2.5 / zoom;
  const log2 = Math.log(2);

  for (let py = 0; py < bufferH; py++) {
    const y0 = cy + ((py / (bufferH - 1)) * 2.4 - 1.2) * invZoom;
    for (let px = 0; px < bufferW; px++) {
      const x0 = cx + ((px / (bufferW - 1)) * 2.0 - 1.0) * invZoom;

      let x = 0; let y = 0; let x2 = 0; let y2 = 0; let iteration = 0;
      while (x2 + y2 <= 4 && iteration < maxIteration) {
        y = 2 * x * y + y0;
        x = x2 - y2 + x0;
        x2 = x * x;
        y2 = y * y;
        iteration++;
      }

      if (iteration === maxIteration) {
        frameBuffer[py * bufferW + px] = -1;
      } else {
        // Coarse smooth coloring for speed
        const mu = iteration + 1 - Math.log(Math.log(x2 + y2) / 2) / log2;
        frameBuffer[py * bufferW + px] = Math.floor((mu / 50) * 255) % 255;
      }
    }
  }
}

/**
 * @param {import('@flyingrobots/bijou-tui').ShaderParams} params
 * @returns {import('@flyingrobots/bijou').Cell}
 */
export function fractalZoomShader({ u, v, time, uniforms }) {
  const tw = (uniforms?.width ?? 80) * 2;
  const th = (uniforms?.height ?? 24) * 2;

  if (tw !== bufferW || th !== bufferH) {
    bufferW = tw;
    bufferH = th;
    frameBuffer = new Int16Array(bufferW * bufferH);
    lastSimTime = -1;
  }

  if (time !== lastSimTime) {
    rasterizeFractal(time);
    lastSimTime = time;
  }

  const px = Math.floor(u * (bufferW - 1));
  const py = Math.floor(v * (bufferH - 1));
  const val = frameBuffer[py * bufferW + px];

  if (val === -1) {return { char: ' ', bg: '#1d252b' };}
  return { char: '█', fg: PALETTE[val], bg: '#1d252b' };
}
