/**
 * Merkle Tree visualization shader for the title screen.
 * Animates data flowing from leaves to root with glowing hash propagation.
 */

let frameBuffer = new Int32Array(0);
let bufferW = 0;
let bufferH = 0;
let lastSimTime = -1;

const COLORS = {
  BG: 0x1d252b,
  LEAF: 0x07BEB8,   // Cyan/Teal
  NODE: 0x120e2e,   // Darker
  ROOT: 0xFF8552,   // Orange/Brand
  EDGE: 0x3d4b59,   // Subdued grey-blue
  GLOW: 0xffffff    // White for pulse
};

const INT_TO_HEX = {
  [COLORS.BG]: '#1d252b',
  [COLORS.LEAF]: '#07BEB8',
  [COLORS.NODE]: '#120e2e',
  [COLORS.ROOT]: '#FF8552',
  [COLORS.EDGE]: '#3d4b59',
  [COLORS.GLOW]: '#ffffff'
};

function setBufferPixel(x, y, color) {
  if (x >= 0 && x < bufferW && y >= 0 && y < bufferH) {
    frameBuffer[y * bufferW + x] = color;
  }
}

function drawLine({ x0, y0, x1, y1, color }) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let cx = x0;
  let cy = y0;
  while (true) {
    setBufferPixel(cx, cy, color);
    if (cx === x1 && cy === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; cx += sx; }
    if (e2 <= dx) { err += dx; cy += sy; }
  }
}

function drawCircle({ x, y, radius, color }) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        setBufferPixel(x + dx, y + dy, color);
      }
    }
  }
}

function calculateNodes({ depth, treeW, treeH, margin }) {
  const nodes = [];
  for (let d = 0; d <= depth; d++) {
    const levelNodes = Math.pow(2, d);
    const y = margin + (d / depth) * treeH;
    const row = [];
    for (let i = 0; i < levelNodes; i++) {
      const x = margin + ((i + 0.5) / levelNodes) * treeW;
      row.push({ x: Math.floor(x), y: Math.floor(y), level: d });
    }
    nodes.push(row);
  }
  return nodes;
}

function drawTreeEdges(nodes, depth, pulseLevel) {
  for (let d = depth; d > 0; d--) {
    for (let i = 0; i < nodes[d].length; i++) {
      const child = nodes[d][i];
      const parent = nodes[d - 1][Math.floor(i / 2)];
      const isPulse = Math.abs(d - 1 - (depth - pulseLevel)) < 0.5;
      drawLine({ x0: child.x, y0: child.y, x1: parent.x, y1: parent.y, color: isPulse ? COLORS.LEAF : COLORS.EDGE });
    }
  }
}

function drawTreeNodes(nodes, depth, pulseLevel) {
  for (let d = 0; d <= depth; d++) {
    const isPulse = Math.abs(d - (depth - pulseLevel)) < 0.5;
    for (const node of nodes[d]) {
      let color = COLORS.NODE;
      if (d === 0) { color = COLORS.ROOT; }
      else if (d === depth) { color = COLORS.LEAF; }
      if (isPulse) { color = COLORS.GLOW; }
      drawCircle({ x: node.x, y: node.y, radius: d === 0 ? 3 : 2, color });
    }
  }
}

function rasterizeTree(time, entryCount) {
  frameBuffer.fill(COLORS.BG);
  const count = Math.max(8, Math.min(32, entryCount));
  const depth = Math.ceil(Math.log2(count));
  const margin = 10;
  const treeW = bufferW - (margin * 2);
  const treeH = bufferH - (margin * 2);
  const pulseLevel = (time * 2) % (depth + 1);

  const nodes = calculateNodes({ depth, treeW, treeH, margin });
  drawTreeEdges(nodes, depth, pulseLevel);
  drawTreeNodes(nodes, depth, pulseLevel);
}

function updateFrameBuffer({ time, entryCount, tw, th }) {
  if (tw !== bufferW || th !== bufferH) {
    bufferW = tw;
    bufferH = th;
    frameBuffer = new Int32Array(bufferW * bufferH);
    lastSimTime = -1;
  }
  if (time !== lastSimTime) {
    rasterizeTree(time, entryCount);
    lastSimTime = time;
  }
}

export function merkleTreeShader({ u, v, time, uniforms }) {
  const tw = (uniforms?.width ?? 80) * 2;
  const th = (uniforms?.height ?? 24) * 2;
  updateFrameBuffer({ time, entryCount: uniforms?.entryCount ?? 120, tw, th });
  const px = Math.floor(u * (bufferW - 1));
  const py = Math.floor(v * (bufferH - 1));
  const colorInt = frameBuffer[py * bufferW + px];
  return { 
    char: colorInt === COLORS.BG ? ' ' : '█', 
    fg: INT_TO_HEX[colorInt] || '#1d252b', 
    bg: '#1d252b' 
  };
}
