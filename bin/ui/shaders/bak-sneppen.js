/**
 * Bak-Sneppen SOC model shader for the title screen.
 * Simulates a ring of species where the weakest and its neighbors are replaced,
 * leading to a self-organized critical state.
 * Maps fitness values to a 3D stem plot projection in terminal space.
 */

const NUM_SPECIES = 120;
const fitnessState = new Float32Array(NUM_SPECIES);
let initialized = false;
let lastTickMs = 0;

/**
 * Initialize the fitness array with random values
 */
function initBakSneppen() {
  for (let i = 0; i < NUM_SPECIES; i++) {
    fitnessState[i] = Math.random();
  }
  initialized = true;
}

/**
 * Perform N steps of the Bak-Sneppen evolution
 * @param {number} steps
 */
function stepBakSneppen(steps) {
  for (let s = 0; s < steps; s++) {
    let minIdx = 0;
    let minVal = fitnessState[0];
    for (let i = 1; i < NUM_SPECIES; i++) {
      if (fitnessState[i] < minVal) {
        minVal = fitnessState[i];
        minIdx = i;
      }
    }

    // Replace the weakest link and its two nearest neighbors
    const leftIdx = (minIdx - 1 + NUM_SPECIES) % NUM_SPECIES;
    const rightIdx = (minIdx + 1) % NUM_SPECIES;

    fitnessState[leftIdx] = Math.random();
    fitnessState[minIdx] = Math.random();
    fitnessState[rightIdx] = Math.random();
  }
}

/**
 * Perspective projection helper
 * @param {{ x: number, y: number, z: number, elevation: number, azimuth: number }} params
 */
function project3D({ x, y, z, elevation, azimuth }) {
  // Convert angles to radians
  const el = elevation * (Math.PI / 180);
  const az = azimuth * (Math.PI / 180);

  // Rotate around Z axis (azimuth)
  const x1 = x * Math.cos(az) - y * Math.sin(az);
  const y1 = x * Math.sin(az) + y * Math.cos(az);

  // Rotate around X axis (elevation)
  const y2 = y1 * Math.cos(el) - z * Math.sin(el);
  const z2 = y1 * Math.sin(el) + z * Math.cos(el);

  // Simple orthographic projection since we just need screen x,y
  return { px: x1, py: y2, pz: z2 };
}

// Colors matching the Marimo notebook
const BG_COLOR = '#1d252b';
const DR_COLOR = '#fbfcfc';
const STEM_COLOR = '#FF8552';
const HEAD_COLOR = '#07BEB8';

function distToSegment({ px, py, x1, y1, x2, y2 }) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/**
 * Checks intersection with a single stem
 * @param {number} screenX
 * @param {number} screenY
 * @param {number} i
 * @param {number} elevation
 * @param {number} azimuth
 * @returns {{ hitColor: string | null, closestZ: number }}
 */
function checkStemHit({ screenX, screenY, i, elevation, azimuth }) {
  const theta = (i / NUM_SPECIES) * 2 * Math.PI;
  const r = 1.0;
  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta);
  const z = fitnessState[i];

  const baseProj = project3D({ x, y, z: 0, elevation, azimuth });
  const headProj = project3D({ x, y, z, elevation, azimuth });

  let hitColor = null;
  let closestZ = -Infinity;

  const lineDist = distToSegment({ px: screenX, py: screenY, x1: baseProj.px, y1: baseProj.py, x2: headProj.px, y2: headProj.py });
  if (lineDist < 0.015) {
    hitColor = STEM_COLOR;
    closestZ = headProj.pz;
  }

  const headDist = Math.hypot(screenX - headProj.px, screenY - headProj.py);
  if (headDist < 0.035) {
    hitColor = HEAD_COLOR;
    closestZ = headProj.pz;
  }
  
  const baseDist = Math.hypot(screenX - baseProj.px, screenY - baseProj.py);
  if (baseDist < 0.02) {
    hitColor = DR_COLOR;
    closestZ = baseProj.pz;
  }

  return { hitColor, closestZ };
}

/**
 * @param {import('@flyingrobots/bijou-tui').ShaderParams} params
 * @returns {string} hex color
 */
export function bakSneppenShader({ u, v, time }) {
  if (!initialized) {
    initBakSneppen();
  }

  const currentTickMs = Math.floor(time * 1000);
  if (currentTickMs - lastTickMs > 50) {
    stepBakSneppen(5);
    lastTickMs = currentTickMs;
  }

  const dx = 1.5;
  const dy = 1.5;
  const screenX = (u * 2 - 1) * dx;
  const screenY = (v * 2 - 1) * dy;

  const elevation = 30;
  const azimuth = 45 + (time * 10); 

  let finalColor = BG_COLOR;
  let maxZ = -Infinity;

  for (let i = 0; i < NUM_SPECIES; i++) {
    const { hitColor, closestZ } = checkStemHit({ screenX, screenY, i, elevation, azimuth });
    if (hitColor && closestZ > maxZ) {
      finalColor = hitColor;
      maxZ = closestZ;
    }
  }

  return finalColor;
}
