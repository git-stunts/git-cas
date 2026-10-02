/* global gsap, ScrollTrigger */
/* =====================================================================
   git-cas explainer — the Vault (WebGPU layer, progressive enhancement)

   One scene: the Git object database as a vault. The scroll is a camera
   dolly; GSAP ScrollTrigger scrubs a master timeline of camera poses.
   Phase 1 set pieces:
     1. Arrival  — hero.psd as a 12 MiB slab of 3,072 voxels (4 KiB each)
     2. Forge    — a 64-segment SHA-256 ring driven by the hash lab
     3. Shatter  — the real Buzhash / FastCDC math from CdcChunker.js run
                   as a compute pass over 12,582,912 synthetic bytes, next
                   to fixed 256 KiB cuts; the slider re-chunks both
   Without WebGPU nothing here runs and the SVG site stands on its own.
   ===================================================================== */
(async () => {
  if (!('gpu' in navigator)) return;
  const canvas = document.getElementById('vault');
  if (!canvas) return;
  let device;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return;
    device = await adapter.requestDevice();
  } catch { return; }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'premultiplied' });
  root.classList.add('has-gpu');
  const badge = document.getElementById('gpuBadge'); if (badge) badge.textContent = 'WebGPU vault: on';

  /* ---- tiny mat4 -------------------------------------------------- */
  const M = {
    perspective(fov, aspect, near, far) { const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far); return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]); },
    lookAt(e, t, up = [0, 1, 0]) {
      let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2]; let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
    },
    mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
  };

  /* ---- theme colors → linear rgb ---------------------------------- */
  const probe = document.createElement('span'); probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'; document.body.appendChild(probe);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const oklabToLinear = (L, a, b) => { const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3; return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((v) => Math.min(1, Math.max(0, v))); };
  const parseColor = (str) => {
    const nums = str.match(/-?[\d.]+%?/g)?.map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v))) || [0, 0, 0];
    if (str.startsWith('rgb')) return [lin(nums[0] / 255), lin(nums[1] / 255), lin(nums[2] / 255)];
    if (str.startsWith('color(srgb-linear')) return nums.slice(0, 3);
    if (str.startsWith('color(srgb')) return nums.slice(0, 3).map(lin);
    if (str.startsWith('oklab')) return oklabToLinear(nums[0], nums[1], nums[2]);
    if (str.startsWith('oklch')) { const [L, C, h] = nums; const r = (h * Math.PI) / 180; return oklabToLinear(L, C * Math.cos(r), C * Math.sin(r)); }
    return [0.5, 0.5, 0.5];
  };
  const token = (name) => { probe.style.color = `var(${name})`; return parseColor(getComputedStyle(probe).color); };
  const theme = { ink: [1, 1, 1], accent: [0.5, 0.5, 0.5], accent2: [0.5, 0.5, 0.5], good: [0, 1, 0], danger: [1, 0, 0], vizL: 0.74, vizC: 0.11 };
  const readTheme = () => {
    theme.ink = token('--ink'); theme.accent = token('--accent'); theme.accent2 = token('--accent-2'); theme.good = token('--good'); theme.danger = token('--danger');
    const cs = getComputedStyle(root); theme.vizL = parseFloat(cs.getPropertyValue('--viz-l')) / 100 || 0.74; theme.vizC = parseFloat(cs.getPropertyValue('--viz-c')) || 0.11;
  };
  const hueColor = (h) => { const r = (h * Math.PI) / 180; return oklabToLinear(theme.vizL, theme.vizC * Math.cos(r), theme.vizC * Math.sin(r)); };

  /* ---- the bytes of hero.psd (synthetic, 12,582,912 of them) -------- */
  const N = 12582912;
  const makeBytes = (prefix) => {
    const out = new Uint8Array(prefix + N);
    let s = 0x9e3779b9 >>> 0; // xorshift32 fill, seeded; same bytes every load
    for (let i = 0; i < prefix; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; out[i] = s & 255; }
    s = 0x2545f491 >>> 0;
    for (let i = prefix; i < out.length; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; out[i] = s & 255; }
    out.set([0x38, 0x42, 0x50, 0x53], prefix); // "8BPS": the PSD signature
    return out;
  };
  // Buzhash table exactly as CdcChunker.js builds it.
  const BUZ = (() => { const t = new Uint32Array(256); let s = 0x6a09e667f3bcc908n; const m = 0xffffffffffffffffn; for (let i = 0; i < 256; i++) { s ^= s << 13n; s &= m; s ^= s >> 7n; s &= m; s ^= s << 17n; s &= m; t[i] = Number(s & 0xffffffffn); } return t; })();
  const TARGET = 262144, MIN = 65536, MAX = 1048576, BITS = Math.floor(Math.log2(TARGET));
  const HARD = ((1 << Math.min(BITS + 1, 31)) - 1) >>> 0, EASY = ((1 << Math.max(BITS - 1, 1)) - 1) >>> 0;
  const fnv = (a, s, e) => { let h = 2166136261; for (let i = s; i < e; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };

  /* ---- compute pass: Buzhash candidates ----------------------------- */
  const computeWGSL = /* wgsl */`
    struct P { n: u32, hard: u32, easy: u32, cap: u32 };
    @group(0) @binding(0) var<storage, read> data: array<u32>;
    @group(0) @binding(1) var<storage, read> table: array<u32>;
    @group(0) @binding(2) var<storage, read_write> out: array<atomic<u32>>;
    @group(0) @binding(3) var<uniform> p: P;
    fn byteAt(i: u32) -> u32 { return (data[i >> 2u] >> ((i & 3u) * 8u)) & 0xffu; }
    @compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g: vec3<u32>) {
      let i = g.x;
      if (i < 63u || i >= p.n) { return; }
      // Buzhash over the 64-byte window ending at i. In CdcChunker.js the
      // window fills with h = rotl(h,1) ^ T[b] and rolls with
      // h = rotl(h,1) ^ T[out] ^ T[in]; rotl by 64 is the identity on 32
      // bits, so h(i) = XOR_k rotl(T[b(i-63+k)], (63-k) mod 32).
      var h: u32 = 0u;
      for (var k: u32 = 0u; k < 64u; k = k + 1u) {
        let t = table[byteAt(i - 63u + k)];
        let r = (63u - k) & 31u;
        h = h ^ ((t << r) | (t >> ((32u - r) & 31u)));
      }
      if ((h & p.easy) == 0u) {
        let idx = atomicAdd(&out[0], 1u);
        if (idx + 1u < p.cap) { atomicStore(&out[idx + 1u], (i << 1u) | select(0u, 1u, (h & p.hard) == 0u)); }
      }
    }`;
  const CAP = 8192;
  const cpipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: computeWGSL }), entryPoint: 'main' } });
  const tableBuf = device.createBuffer({ size: 1024, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(tableBuf, 0, BUZ);
  const dataBuf = device.createBuffer({ size: Math.ceil((N + 64) / 4) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const outBuf = device.createBuffer({ size: CAP * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const readBuf = device.createBuffer({ size: CAP * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const paramBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cbind = device.createBindGroup({ layout: cpipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: dataBuf } }, { binding: 1, resource: { buffer: tableBuf } }, { binding: 2, resource: { buffer: outBuf } }, { binding: 3, resource: { buffer: paramBuf } }] });
  let computeBusy = false;
  async function cdcBoundaries(bytes) {
    computeBusy = true;
    const n = bytes.length;
    device.queue.writeBuffer(dataBuf, 0, bytes.buffer, bytes.byteOffset, Math.ceil(n / 4) * 4 <= dataBuf.size ? Math.ceil(n / 4) * 4 : dataBuf.size);
    device.queue.writeBuffer(paramBuf, 0, new Uint32Array([n, HARD, EASY, CAP]));
    device.queue.writeBuffer(outBuf, 0, new Uint32Array(1));
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass(); pass.setPipeline(cpipe); pass.setBindGroup(0, cbind); pass.dispatchWorkgroups(Math.ceil(n / 256)); pass.end();
    enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, CAP * 4);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const res = new Uint32Array(readBuf.getMappedRange().slice(0)); readBuf.unmap();
    const count = Math.min(res[0], CAP - 1);
    const cands = Array.from(res.subarray(1, 1 + count)).map((v) => ({ pos: v >>> 1, hard: (v & 1) === 1 })).sort((a, b) => a.pos - b.pos);
    // Sequential cut selection, as CdcChunker.js phases 2 and 3 do it:
    // no cuts before minSize; hard mask below target, easy mask above;
    // forced cut at maxSize. A cut at i ends the chunk after byte i.
    const bounds = [0]; let start = 0, ci = 0;
    while (start < n) {
      let cut = Math.min(start + MAX, n);
      while (ci < cands.length && cands[ci].pos < start + MIN - 1) ci++;
      for (let j = ci; j < cands.length && cands[j].pos < cut - 1; j++) {
        const len = cands[j].pos - start + 1;
        if (len < TARGET ? cands[j].hard : true) { cut = cands[j].pos + 1; break; }
      }
      if (cut >= n) break;
      bounds.push(cut); start = cut;
    }
    computeBusy = false;
    return bounds;
  }
  const fixedBoundaries = (n) => { const b = []; for (let i = 0; i < n; i += TARGET) b.push(i); return b; };
  const chunkify = (bytes, bounds) => bounds.map((s, i) => { const e = bounds[i + 1] ?? bytes.length; return { s, e, h: fnv(bytes, s, Math.min(e, s + 65536)) }; });

  /* ---- render pipeline: instanced cubes ----------------------------- */
  const renderWGSL = /* wgsl */`
    struct U { viewProj: mat4x4<f32>, time: f32, shatter: f32, aspect: f32, pad0: f32, fades: vec4<f32>, scales: vec4<f32>, light: vec4<f32>, accent: vec4<f32> };
    struct Inst { pos: vec3<f32>, scale: f32, color: vec4<f32>, shard: u32, group: u32, flags: u32, pad: u32 };
    @group(0) @binding(0) var<uniform> u: U;
    @group(0) @binding(1) var<storage, read> inst: array<Inst>;
    struct VS { @builtin(position) p: vec4<f32>, @location(0) n: vec3<f32>, @location(1) c: vec4<f32>, @location(2) w: vec3<f32>, @location(3) f: f32 };
    fn hash3(n: u32) -> vec3<f32> {
      var x = n * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; x = (x >> 22u) ^ x;
      var y = x * 747796405u + 2891336453u; y = ((y >> ((y >> 28u) + 4u)) ^ y) * 277803737u; y = (y >> 22u) ^ y;
      var z = y * 747796405u + 2891336453u; z = ((z >> ((z >> 28u) + 4u)) ^ z) * 277803737u; z = (z >> 22u) ^ z;
      return vec3<f32>(f32(x & 0xffffu) / 65535.0, f32(y & 0xffffu) / 65535.0, f32(z & 0xffffu) / 65535.0) * 2.0 - 1.0;
    }
    @vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VS {
      let I = inst[ii];
      let face = vi / 6u; let v = vi % 6u;
      var uv = vec2<f32>(-1.0, -1.0);
      switch v { case 1u: { uv = vec2<f32>(1.0, -1.0); } case 2u, 4u: { uv = vec2<f32>(1.0, 1.0); } case 5u: { uv = vec2<f32>(-1.0, 1.0); } default: {} }
      var n = vec3<f32>(0.0, 0.0, 1.0); var p = vec3<f32>(uv.x, uv.y, 1.0);
      switch face {
        case 1u: { n = vec3<f32>(0.0, 0.0, -1.0); p = vec3<f32>(-uv.x, uv.y, -1.0); }
        case 2u: { n = vec3<f32>(1.0, 0.0, 0.0); p = vec3<f32>(1.0, uv.y, -uv.x); }
        case 3u: { n = vec3<f32>(-1.0, 0.0, 0.0); p = vec3<f32>(-1.0, uv.y, uv.x); }
        case 4u: { n = vec3<f32>(0.0, 1.0, 0.0); p = vec3<f32>(uv.x, 1.0, -uv.y); }
        case 5u: { n = vec3<f32>(0.0, -1.0, 0.0); p = vec3<f32>(uv.x, -1.0, uv.y); }
        default: {}
      }
      let gs = u.scales[I.group];
      var world = I.pos * gs + p * I.scale * 0.5 * gs;
      if ((I.flags & 1u) != 0u) {
        // shatter: every voxel of a shard shares one direction, so chunks
        // move as rigid pieces; new shards travel a little further.
        let d = normalize(hash3(I.shard * 7919u + 17u) + vec3<f32>(0.0, 0.35, 0.0));
        let extra = select(1.0, 1.6, (I.flags & 2u) != 0u);
        world = world + d * u.shatter * (2.2 + 1.8 * abs(hash3(I.shard).x)) * extra;
      }
      if (I.group == 2u) {
        // the hash ring breathes with time
        world = world + n * 0.0 + vec3<f32>(0.0, sin(u.time * 1.3 + f32(I.shard) * 0.4) * 0.04, 0.0);
      }
      var o: VS; o.p = u.viewProj * vec4<f32>(world, 1.0); o.n = n; o.c = I.color; o.w = world; o.f = u.fades[I.group] * select(1.0, 1.35, (I.flags & 2u) != 0u);
      return o;
    }
    @fragment fn fs(i: VS) -> @location(0) vec4<f32> {
      let L = normalize(u.light.xyz);
      let lambert = max(dot(i.n, L), 0.0) * 0.75 + 0.35;
      let rim = pow(1.0 - abs(dot(i.n, normalize(vec3<f32>(0.2, 0.3, 1.0)))), 3.0) * 0.25;
      var c = i.c.rgb * lambert + u.accent.rgb * rim;
      let a = clamp(i.f, 0.0, 1.0) * i.c.a;
      return vec4<f32>(c * a, a);
    }`;
  const rmod = device.createShaderModule({ code: renderWGSL });
  const rpipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: rmod, entryPoint: 'vs' }, fragment: { module: rmod, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } });
  const UNI = 64 + 16 + 16 + 16 + 16 + 16;
  const uniBuf = device.createBuffer({ size: UNI, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // Instances: group 0 = CDC slab (3,072), group 1 = fixed slab (3,072), group 2 = ring (64).
  const VOX = 3072, GX = 16, GY = 12, GZ = 16, RING = 64, TOTAL = VOX * 2 + RING, STRIDE = 12;
  const instData = new ArrayBuffer(TOTAL * STRIDE * 4); const f32 = new Float32Array(instData), u32 = new Uint32Array(instData);
  const instBuf = device.createBuffer({ size: instData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const SLAB = [[0, 0, 0], [12, 0, 0]], RING_C = [0, 10, 0];
  const setInst = (i, pos, scale, color, shard, group, flags) => { const o = i * STRIDE; f32[o] = pos[0]; f32[o + 1] = pos[1]; f32[o + 2] = pos[2]; f32[o + 3] = scale; f32[o + 4] = color[0]; f32[o + 5] = color[1]; f32[o + 6] = color[2]; f32[o + 7] = color[3] ?? 1; u32[o + 8] = shard; u32[o + 9] = group; u32[o + 10] = flags; u32[o + 11] = 0; };
  const voxelByte = (v) => v * 4096; // voxel v stands for bytes [v*4096, v*4096+4096)
  const voxelPos = (v, c) => { const x = v % GX, y = Math.floor(v / GX) % GY, z = Math.floor(v / (GX * GY)); return [c[0] + (x - (GX - 1) / 2) * 0.5, c[1] + (y - (GY - 1) / 2) * 0.5, c[2] + (z - (GZ - 1) / 2) * 0.5]; };
  const assignSlab = (group, chunks, prevHashes) => {
    let ci = 0;
    for (let v = 0; v < VOX; v++) {
      const b = voxelByte(v);
      while (ci + 1 < chunks.length && chunks[ci + 1].s <= b) ci++;
      while (ci > 0 && chunks[ci].s > b) ci--;
      const ch = chunks[ci]; const isNew = prevHashes ? !prevHashes.has(ch.h) : false;
      setInst(group * VOX + v, voxelPos(v, SLAB[group]), 0.92, hueColor(ch.h % 360), ci, group, 1 | (isNew ? 2 : 0));
    }
  };
  const setRing = (digest) => { for (let k = 0; k < RING; k++) { const b = digest ? digest[k % 32] : 128; const a = (k / RING) * Math.PI * 2; const r = 2.6 + (b / 255) * 1.6; setInst(VOX * 2 + k, [RING_C[0] + Math.cos(a) * r, RING_C[1] + Math.sin(a) * r * 0.55, RING_C[2] + Math.sin(a * 2) * 0.3], 0.55 + (b / 255) * 0.5, hueColor(Math.round((b / 255) * 360)), k, 2, 0); } };
  const upload = () => device.queue.writeBuffer(instBuf, 0, instData);
  const bind = device.createBindGroup({ layout: rpipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniBuf } }, { binding: 1, resource: { buffer: instBuf } }] });

  /* ---- chunking state --------------------------------------------- */
  const base = makeBytes(0);
  const cdcBase = await cdcBoundaries(base);
  const fixedBase = fixedBoundaries(N);
  const baseCdcChunks = chunkify(base, cdcBase), baseFixedChunks = chunkify(base, fixedBase);
  const baseCdcSet = new Set(baseCdcChunks.map((c) => c.h)), baseFixedSet = new Set(baseFixedChunks.map((c) => c.h));
  readTheme();
  assignSlab(0, baseCdcChunks, null); assignSlab(1, baseFixedChunks, null); setRing(null); upload();
  const stats = { cdc: baseCdcChunks.length, fixed: baseFixedChunks.length, cdcChanged: 0, fixedChanged: 0, inserted: 0 };
  const gpuReadout = document.getElementById('gpuChunkReadout');
  const showStats = () => { if (gpuReadout) gpuReadout.innerHTML = `<span>WebGPU · 12,582,912 real bytes · Buzhash 64-byte window</span><span>inserted <b>${stats.inserted}</b> bytes</span><span>fixed: <b>${stats.fixedChanged}/${stats.fixed}</b> changed</span><span>cdc: <b>${stats.cdcChanged}/${stats.cdc}</b> changed</span>`; };
  showStats();
  let pending = null;
  async function rechunk(k) {
    if (computeBusy) { pending = k; return; }
    const bytes = k ? makeBytes(k) : base;
    const cdc = k ? chunkify(bytes, await cdcBoundaries(bytes)) : baseCdcChunks;
    const fixed = k ? chunkify(bytes, fixedBoundaries(bytes.length)) : baseFixedChunks;
    assignSlab(0, cdc, k ? baseCdcSet : null); assignSlab(1, fixed, k ? baseFixedSet : null); upload();
    stats.cdc = cdc.length; stats.fixed = fixed.length; stats.inserted = k;
    stats.cdcChanged = k ? cdc.filter((c) => !baseCdcSet.has(c.h)).length : 0; stats.fixedChanged = k ? fixed.filter((c) => !baseFixedSet.has(c.h)).length : 0;
    showStats(); dirty = true;
    if (pending !== null) { const p = pending; pending = null; rechunk(p); }
  }
  const slider = document.getElementById('chunkInsert');
  if (slider) { let t; slider.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => rechunk(+slider.value), 60); }); }

  /* ---- hash ring follows the hash lab ------------------------------- */
  const hashInput = document.getElementById('hashInput');
  const enc = new TextEncoder();
  async function forge() { try { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(hashInput.value))); setRing(d); upload(); dirty = true; } catch { /* no subtle crypto */ } }
  if (hashInput) { let t; hashInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(forge, 90); }); forge(); }

  /* ---- camera rig scrubbed by scroll ------------------------------- */
  const cam = { x: 0, y: 4, z: 26, tx: 0, ty: 0, tz: 0, fov: 42, shatter: 0, fadeA: 1, fadeB: 0, fadeR: 0, scaleA: 1, scaleB: 1, scaleR: 1, orbit: 1 };
  const poses = {
    // Targets sit left of the slab so the slab lands right of the text column.
    hero: { x: 6, y: 4, z: 24, tx: -7, ty: 0.5, tz: 0, fov: 42, fadeA: 1, fadeB: 0, fadeR: 0, scaleA: 1, shatter: 0, orbit: 1 },
    'c-orient': { x: 1.2, y: 0.4, z: 4.6, tx: -0.4, ty: 0.3, tz: 0, fov: 38, fadeA: 1, fadeB: 0, fadeR: 0, scaleA: 1, shatter: 0, orbit: 0 },
    'c-problem': { x: 12, y: 9, z: 32, tx: -8, ty: 0, tz: 0, fov: 42, fadeA: 0.3, fadeB: 0, fadeR: 0, scaleA: 1, shatter: 0, orbit: 0 },
    'c-example': { x: 5, y: 3, z: 18, tx: -5.5, ty: 0, tz: 0, fov: 40, fadeA: 1, fadeB: 0, fadeR: 0, scaleA: 1, shatter: 0, orbit: 0 },
    'c-hash': { x: 0, y: 10.5, z: 12, tx: -4.5, ty: 10, tz: 0, fov: 42, fadeA: 0.25, fadeB: 0, fadeR: 1, scaleA: 0.25, shatter: 0, orbit: 0 },
    'c-chunk': { x: 6, y: 6, z: 30, tx: -2, ty: 0, tz: 0, fov: 44, fadeA: 1, fadeB: 1, fadeR: 0, scaleA: 1, shatter: 1, orbit: 0 },
    'c-dedup': { x: 6, y: 14, z: 30, tx: -2, ty: 0, tz: 0, fov: 44, fadeA: 0.45, fadeB: 0.45, fadeR: 0, scaleA: 1, shatter: 1, orbit: 0 },
    'c-manifest': { x: -6, y: 10, z: 34, tx: -4, ty: 0, tz: 0, fov: 42, fadeA: 0.3, fadeB: 0.15, fadeR: 0, scaleA: 1, shatter: 0.6, orbit: 0 },
    rest: { x: -10, y: 16, z: 44, tx: -4, ty: 0, tz: 0, fov: 42, fadeA: 0.2, fadeB: 0.1, fadeR: 0.1, scaleA: 1, shatter: 0.4, orbit: 0 },
  };
  let master = null;
  const buildMaster = () => {
    if (master) { master.scrollTrigger?.kill(); master.kill(); }
    const content = document.getElementById('smooth-content');
    const total = Math.max(1, content.scrollHeight - innerHeight);
    master = gsap.timeline({ paused: true, defaults: { ease: 'power2.inOut' } });
    Object.assign(cam, poses.hero);
    const stops = [...document.querySelectorAll('.chapter[id]')];
    let lastPose = poses.hero;
    stops.forEach((el, i) => {
      const pose = poses[el.id] || poses.rest;
      const at = Math.min(total, Math.max(0, el.offsetTop - innerHeight * 0.45));
      const span = Math.max(1, (stops[i + 1]?.offsetTop ?? content.scrollHeight) - el.offsetTop);
      // the pose change happens over the first 45% of the chapter, so the
      // camera has arrived before the first step activates
      master.to(cam, { ...pose, duration: span * 0.45, ease: 'power2.inOut' }, at);
      if (el.id === 'c-chunk') { master.fromTo(cam, { shatter: 0 }, { shatter: 1, duration: span * 0.9, ease: 'power3.inOut' }, at + span * 0.1); }
      lastPose = pose;
    });
    master.to(cam, { ...lastPose, duration: 1 }, total);
    ScrollTrigger.create({ trigger: content, start: 'top top', end: 'bottom bottom', scrub: 0.5, onUpdate: (self) => { master.progress(self.progress); dirty = true; } });
  };
  buildMaster();
  ScrollTrigger.addEventListener('refresh', buildMaster);

  /* ---- frame loop --------------------------------------------------- */
  let depthTex = null, dirty = true, t0 = performance.now();
  const resize = () => { const dpr = Math.min(devicePixelRatio || 1, 2); const w = Math.floor(innerWidth * dpr), h = Math.floor(innerHeight * dpr); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; depthTex?.destroy(); depthTex = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT }); dirty = true; } };
  const uni = new Float32Array(UNI / 4);
  function frame() {
    resize();
    const time = (performance.now() - t0) / 1000;
    const orbit = reduce ? 0 : cam.orbit;
    const ox = Math.sin(time * 0.25) * 2.2 * orbit, oz = (Math.cos(time * 0.25) - 1) * 1.2 * orbit;
    const eye = [cam.x + ox, cam.y + Math.sin(time * 0.4) * 0.3 * orbit, cam.z + oz];
    const vp = M.mul(M.perspective((cam.fov * Math.PI) / 180, canvas.width / canvas.height, 0.1, 200), M.lookAt(eye, [cam.tx, cam.ty, cam.tz]));
    uni.set(vp, 0); uni[16] = time; uni[17] = cam.shatter; uni[18] = canvas.width / canvas.height; uni[19] = 0;
    uni.set([cam.fadeA, cam.fadeB, cam.fadeR, 0], 20); uni.set([cam.scaleA, cam.scaleB, cam.scaleR, 1], 24); uni.set([0.4, 0.8, 0.6, 0], 28); uni.set([...theme.accent, 1], 32);
    device.queue.writeBuffer(uniBuf, 0, uni);
    const encd = device.createCommandEncoder();
    const pass = encd.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }], depthStencilAttachment: { view: depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    pass.setPipeline(rpipe); pass.setBindGroup(0, bind); pass.draw(36, TOTAL); pass.end();
    device.queue.submit([encd.finish()]);
    dirty = false;
  }
  const loop = () => { if (dirty || (!reduce && cam.orbit > 0.01) || (!reduce && cam.fadeR > 0.01)) frame(); requestAnimationFrame(loop); };
  frame();
  requestAnimationFrame(loop);
  addEventListener('resize', () => { dirty = true; });
  new MutationObserver(() => { readTheme(); rechunk(stats.inserted); forge(); }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-scheme'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { readTheme(); rechunk(stats.inserted); forge(); });

  window.VaultScene = { frame: () => frame(), stats, cam, rechunk, cdcBoundaries: () => cdcBase.slice(), masks: { HARD, EASY, TARGET, MIN, MAX } };
})();
