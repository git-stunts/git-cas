/**
 * Organic Flow shader for the title screen.
 * Recreates the dense Braille aesthetic of background.txt with liquid animation.
 * Uses Braille resolution (2x4 sub-pixels per cell).
 */

let frameBuffer = new Uint8Array(0);
let bufferW = 0;
let bufferH = 0;
let lastSimTime = -1;

function setBufferPixel(x, y, state) {
  if (x >= 0 && x < bufferW && y >= 0 && y < bufferH) {
    frameBuffer[y * bufferW + x] = state;
  }
}

function rasterizeFlow(time) {
  // Generative organic flow logic
  // We use multiple overlapping sines to simulate a complex scalar field
  for (let py = 0; py < bufferH; py++) {
    const y = (py / bufferH) * 2.0 - 1.0;
    for (let px = 0; px < bufferW; px++) {
      const x = (px / bufferW) * 3.0 - 1.5;

      // Multi-layered interference pattern
      let v = Math.sin(x * 3.0 + time * 0.5);
      v += Math.sin((y * 4.0 + time * 0.7) * 1.5);
      v += Math.sin((x * 2.0 + y * 2.0 + time * 0.3) * 0.8);

      // Domain warp
      const cx = x + 0.5 * Math.sin(time * 0.2);
      const cy = y + 0.5 * Math.cos(time * 0.4);
      v += Math.sin(Math.sqrt(100.0 * (cx * cx + cy * cy) + 1.0) + time);

      // Normalize and threshold with high-frequency "dither" noise
      const val = (v + 4.0) / 8.0;
      const dither = (Math.sin(px * 12.9898 + py * 78.233) * 43758.5453) % 1.0;

      setBufferPixel(px, py, val > (0.45 + dither * 0.1) ? 1 : 0);
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
    frameBuffer = new Uint8Array(bufferW * bufferH);
    lastSimTime = -1;
  }

  if (time !== lastSimTime) {
    rasterizeFlow(time);
    lastSimTime = time;
  }

  const px = Math.floor(u * (bufferW - 1));
  const py = Math.floor(v * (bufferH - 1));
  const state = frameBuffer[py * bufferW + px];

  // In 'braille' resolution mode, Bijou expects:
  // - A string/char to represent "on"
  // - Or a Cell object.
  // For high-res Braille, we return a color string if "on", or ' ' if "off".
  // The Braille renderer will handle the bitmasking.

  return state ? '#07BEB8' : ' ';
}
