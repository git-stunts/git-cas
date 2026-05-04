/**
 * Bak-Sneppen SOC model shader for the title screen.
 * Optimized via internal rasterization to handle high species counts at 60fps.
 */

let currentNumSpecies = 120;
let fitnessState = new Float32Array(currentNumSpecies);
let initialized = false;
let lastSimTime = -1;

// Backing buffer for rasterized sub-pixels
let frameBuffer = new Int32Array(0);
let bufferW = 0;
let bufferH = 0;

// Convert hex string to integer for faster buffer storage
function hexToInt(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

const BG_INT = hexToInt('#1d252b');
const DR_INT = hexToInt('#fbfcfc');
const STEM_INT = hexToInt('#FF8552');
const HEAD_INT = hexToInt('#07BEB8');
const INT_TO_HEX = {
  [BG_INT]: '#1d252b',
  [DR_INT]: '#fbfcfc',
  [STEM_INT]: '#FF8552',
  [HEAD_INT]: '#07BEB8'
};

function initBakSneppen(numSpecies) {
  currentNumSpecies = numSpecies;
  fitnessState = new Float32Array(currentNumSpecies);
  for (let i = 0; i < currentNumSpecies; i++) {
    fitnessState[i] = Math.random();
  }
  initialized = true;
}

function stepBakSneppen(steps) {
  for (let s = 0; s < steps; s++) {
    let minIdx = 0;
    let minVal = fitnessState[0];
    for (let i = 1; i < currentNumSpecies; i++) {
      if (fitnessState[i] < minVal) {
        minVal = fitnessState[i];
        minIdx = i;
      }
    }
    const leftIdx = (minIdx - 1 + currentNumSpecies) % currentNumSpecies;
    const rightIdx = (minIdx + 1) % currentNumSpecies;
    fitnessState[leftIdx] = Math.random();
    fitnessState[minIdx] = Math.random();
    fitnessState[rightIdx] = Math.random();
  }
}

function project3D({ x, y, z, elevation, azimuth }) {
  const el = elevation * (Math.PI / 180);
  const az = azimuth * (Math.PI / 180);
  const x1 = x * Math.cos(az) - y * Math.sin(az);
  const y1 = x * Math.sin(az) + y * Math.cos(az);
  const y2 = y1 * Math.cos(el) - z * Math.sin(el);
  const z2 = y1 * Math.sin(el) + z * Math.cos(el);
  return { px: x1, py: y2, pz: z2 };
}

function mapToBuffer(x, y) {
  const ix = Math.round(((x / 1.6) + 1) * 0.5 * (bufferW - 1));
  const iy = Math.round(((y / 1.2) + 1) * 0.5 * (bufferH - 1));
  return { ix, iy };
}

function setBufferPixel(x, y, color) {
  if (x < 0 || x >= bufferW || y < 0 || y >= bufferH) {
    return;
  }
  frameBuffer[y * bufferW + x] = color;
}

function drawLine({ x0, y0, x1, y1, color }) {
  const p0 = mapToBuffer(x0, y0);
  const p1 = mapToBuffer(x1, y1);
  const dx = Math.abs(p1.ix - p0.ix);
  const dy = -Math.abs(p1.iy - p0.iy);
  const sx = p0.ix < p1.ix ? 1 : -1;
  const sy = p0.iy < p1.iy ? 1 : -1;
  let err = dx + dy;
  let cx = p0.ix;
  let cy = p0.iy;

  while (true) {
    setBufferPixel(cx, cy, color);
    if (cx === p1.ix && cy === p1.iy) {
      break;
    }
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
}

function drawPoint({ x, y, color, radius = 1 }) {
  const ix = Math.round(((x / 1.6) + 1) * 0.5 * (bufferW - 1));
  const iy = Math.round(((y / 1.2) + 1) * 0.5 * (bufferH - 1));

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      if (cx >= 0 && cx < bufferW && cy >= 0 && cy < bufferH) {
        frameBuffer[cy * bufferW + cx] = color;
      }
    }
  }
}

function rasterizeFrame(time) {
  frameBuffer.fill(BG_INT);
  const elevation = 35;
  const azimuth = 45 + (time * 15);

  for (let i = 0; i < currentNumSpecies; i++) {
    const theta = (i / currentNumSpecies) * 2 * Math.PI + (time * 0.5);
    const baseProj = project3D({ x: Math.cos(theta), y: Math.sin(theta), z: 0, elevation, azimuth });
    const headProj = project3D({ x: Math.cos(theta), y: Math.sin(theta), z: fitnessState[i], elevation, azimuth });

    drawLine({ x0: baseProj.px, y0: baseProj.py, x1: headProj.px, y1: headProj.py, color: STEM_INT });

    const nextTheta = ((i + 1) / currentNumSpecies) * 2 * Math.PI + (time * 0.5);
    const nextBaseProj = project3D({ x: Math.cos(nextTheta), y: Math.sin(nextTheta), z: 0, elevation, azimuth });
    drawLine({ x0: baseProj.px, y0: baseProj.py, x1: nextBaseProj.px, y1: nextBaseProj.py, color: DR_INT });

    drawPoint({ x: headProj.px, y: headProj.py, color: HEAD_INT });
  }
}

function updateFrameBuffer(time, uniforms) {
  const tw = (uniforms?.width ?? 80) * 2;
  const th = (uniforms?.height ?? 24) * 2;

  if (tw !== bufferW || th !== bufferH) {
    bufferW = tw;
    bufferH = th;
    frameBuffer = new Int32Array(bufferW * bufferH);
    lastSimTime = -1;
  }

  if (time !== lastSimTime) {
    stepBakSneppen(3);
    rasterizeFrame(time);
    lastSimTime = time;
  }
}

/**
 * @param {import('@flyingrobots/bijou-tui').ShaderParams} params
 * @returns {import('@flyingrobots/bijou').Cell}
 */
export function bakSneppenShader({ u, v, time, uniforms }) {
  const targetNumSpecies = Math.max(50, Math.min(300, uniforms?.entryCount ?? 120));
  if (!initialized || currentNumSpecies !== targetNumSpecies) {
    initBakSneppen(targetNumSpecies);
  }

  updateFrameBuffer(time, uniforms);

  const colorInt = frameBuffer[Math.floor(v * (bufferH - 1)) * bufferW + Math.floor(u * (bufferW - 1))];
  if (colorInt !== BG_INT) {
    return { char: '█', fg: INT_TO_HEX[colorInt], bg: '#1d252b' };
  }
  return { char: ' ', bg: '#1d252b' };
}
