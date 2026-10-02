/* global d3, gsap, DrawSVGPlugin, MotionPathPlugin */
/* =====================================================================
   git-cas explainer — full-viewport scenes (d3 + GSAP)

   Every scene draws into two shared SVG layers that cover the viewport:
   `back` sits behind the text, `front` sits in front of it. Both use the
   same 1600×900 viewBox (preserveAspectRatio slice), so one coordinate
   system spans the screen. Text lives in the left ~560 units; scenes
   centre on the right and are free to cross the whole page.

   Scene API: { init({ back, front, hud }), setStep(i), scrub?(p) }
   ===================================================================== */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = (s) => (reduce ? 0 : s);
  const hue = (h) => `oklch(var(--viz-l) var(--viz-c) ${h})`;
  const fnv = (arr) => { let h = 2166136261; for (const v of arr) { h ^= v & 255; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
  const mulberry = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hex = (n, len) => (n >>> 0).toString(16).padStart(8, '0').slice(0, len);
  const show = (sel, on, d = 0.5) => gsap.to(sel.nodes ? sel.nodes() : sel, { autoAlpha: on ? 1 : 0, duration: dur(d), overwrite: 'auto' });
  const dim = (sel, on, d = 0.5) => gsap.to(sel.nodes ? sel.nodes() : sel, { opacity: on ? 1 : 0.18, duration: dur(d), overwrite: 'auto' });
  const drawIn = (sel, d = 0.9, stagger = 0.06) => gsap.fromTo(sel.nodes ? sel.nodes() : sel, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: dur(d), stagger: dur(stagger), ease: 'power2.inOut', overwrite: 'auto' });
  const ride = (el, path, vars = {}) => gsap.to(el, { motionPath: { path, autoRotate: vars.autoRotate ?? false, start: vars.start ?? 0, end: vars.end ?? 1 }, duration: reduce ? 0.001 : (vars.duration ?? 2), ease: vars.ease ?? 'none', repeat: vars.repeat ?? 0, delay: vars.delay ?? 0, yoyo: vars.yoyo ?? false, onComplete: vars.onComplete });
  const curve = (a, b, bend = 0.25) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; const dx = b[0] - a[0], dy = b[1] - a[1]; const nx = -dy * bend, ny = dx * bend; return `M${a[0]},${a[1]} Q${mx + nx},${my + ny} ${b[0]},${b[1]}`; };
  const box = (g, w, h, cls = '') => g.append('rect').attr('x', -w / 2).attr('y', -h / 2).attr('width', w).attr('height', h).attr('rx', 10).attr('class', `node-box ${cls}`);
  const node = (layer, x, y, w, h, title, sub, cls = '') => { const g = layer.append('g').attr('class', `node ${cls}`).attr('transform', `translate(${x},${y})`); box(g, w, h); g.append('text').attr('class', 'strong').attr('text-anchor', 'middle').attr('y', sub ? -4 : 5).text(title); if (sub) g.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 14).text(sub); return g; };
  const guide = (layer, d, cls = 'guide') => layer.append('path').attr('d', d).attr('class', cls).attr('fill', 'none');
  const hud = { caption: (html) => { const c = document.getElementById('hudCaption'); if (c) c.innerHTML = html; }, readout: (html) => { const r = document.getElementById('hudReadout'); if (r) r.innerHTML = html; } };
  const machines = { laptop: { x: 700, y: 180, l: 'Ada’s laptop', s: 'working copy' }, origin: { x: 1150, y: 120, l: 'origin', s: 'GitHub' }, eu: { x: 1470, y: 330, l: 'mirror · EU', s: 'read-only fetch' }, ci: { x: 1400, y: 720, l: 'CI runner', s: 'ephemeral clone' }, archive: { x: 960, y: 810, l: 'offline archive', s: 'air-gapped' }, us: { x: 640, y: 560, l: 'mirror · US', s: 'read-only fetch' } };
  const drawMachines = (layer) => { const out = {}; Object.entries(machines).forEach(([id, m]) => { out[id] = node(layer, m.x, m.y, 170, 58, m.l, m.s, `m m-${id}`); }); return out; };

  const S = {};

  /* ---------------------------------------------------------- problem */
  S.problem = (() => {
    let g, f, spokes, server, packets = [], dangles, spokePackets = [];
    const pairs = [['laptop', 'origin'], ['origin', 'eu'], ['eu', 'ci'], ['ci', 'archive'], ['archive', 'us'], ['us', 'laptop'], ['laptop', 'archive'], ['origin', 'ci'], ['us', 'eu']];
    return {
      init({ back, front }) {
        g = back.append('g'); f = front.append('g');
        const ring = g.append('g').selectAll('path').data(pairs).join('path').attr('class', 'edge soft').attr('d', ([a, b]) => curve([machines[a].x, machines[a].y], [machines[b].x, machines[b].y], 0.18));
        spokes = g.append('g').selectAll('path').data(Object.keys(machines)).join('path').attr('class', 'edge dashed').attr('d', (id) => curve([machines[id].x, machines[id].y], [1080, 450], -0.08)).attr('opacity', 0);
        server = g.append('g').attr('transform', 'translate(1080,450)').attr('opacity', 0);
        box(server, 260, 92, 'accent');
        server.append('text').attr('class', 'strong').attr('text-anchor', 'middle').attr('y', -14).text('artifact host');
        server.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 8).text('hero.psd lives only here');
        server.append('text').attr('class', 'small faint').attr('text-anchor', 'middle').attr('y', 28).text('cdn.example · s3 bucket · LFS server');
        server.append('path').attr('class', 'x').attr('d', 'M-40,-40 L40,40 M40,-40 L-40,40').attr('stroke', 'var(--danger)').attr('stroke-width', 6).attr('fill', 'none').attr('opacity', 0);
        drawMachines(g);
        dangles = g.append('g').selectAll('text').data(Object.values(machines)).join('text').attr('class', 'small').attr('text-anchor', 'middle').attr('x', (m) => m.x).attr('y', (m) => m.y + 48).attr('fill', 'var(--danger)').text('pointer dangles').attr('opacity', 0);
        // packets: code replicating around the ring, forever, some in front of the text
        ring.each(function (_, i) { const el = this; const layer = i % 3 === 0 ? f : g; const p = layer.append('circle').attr('r', 7).attr('class', 'packet').node(); packets.push(p); ride(p, el, { duration: 6 + i * 0.7, repeat: -1, start: (i * 0.13) % 1, end: 1 + ((i * 0.13) % 1) }); });
        drawIn(ring, 1.4, 0.08);
      },
      setStep(i) {
        show(server, i >= 1); show(spokes, i >= 1);
        gsap.to(spokes.nodes(), { stroke: i >= 2 ? 'var(--danger)' : 'var(--line-strong)', duration: dur(0.5) });
        gsap.to(server.select('rect').node(), { opacity: i >= 2 ? 0.25 : 1, duration: dur(0.5) });
        show(server.select('.x'), i >= 2); show(dangles, i >= 2);
        if (i >= 1 && spokePackets.length === 0) spokes.each(function (_, k) { const p = g.append('circle').attr('r', 5).attr('class', 'packet danger').node(); spokePackets.push(p); ride(p, this, { duration: 3 + k * 0.4, repeat: -1, yoyo: true }); });
        spokePackets.forEach((p) => gsap.to(p, { autoAlpha: i === 1 ? 1 : 0, duration: dur(0.4) }));
        hud.caption(['<b>Figure 2.</b> Six replicas of the repository. The moving dots are ordinary fetch and push traffic.', '<b>Figure 2.</b> The artifact host is outside the repository; every machine depends on it for <code>hero.psd</code>.', '<b>Figure 2.</b> The host is gone. The code still replicates; every pointer to the artifact dangles.'][i]);
      },
    };
  })();

  /* ------------------------------------------------------------- hash */
  S.hash = (() => {
    let input, grid, hexOut, note, glyphs, prev = null;
    const sample = 'hero.psd, export 14: tweaked the sky gradient';
    const enc = new TextEncoder();
    const ORBIT = 'M1050,160 C1420,160 1560,330 1560,460 C1560,600 1400,760 1050,760 C700,760 540,600 540,460 C540,330 680,160 1050,160 Z';
    async function run() {
      const bytes = enc.encode(input.value);
      let digest; try { digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); } catch { hexOut.textContent = 'SHA-256 is unavailable in this browser.'; return; }
      let changed = 0; const parts = [];
      digest.forEach((b, i) => { const diff = prev === null || prev[i] !== b; if (diff && prev !== null) changed++; grid.children[i].style.background = hue(Math.round((b / 255) * 360)); const h = b.toString(16).padStart(2, '0'); parts.push(diff && prev !== null ? `<b>${h}</b>` : h); });
      hexOut.innerHTML = parts.join('');
      note.textContent = prev === null ? `${bytes.length} input bytes → 32 output bytes, always.` : `${bytes.length} input bytes. ${changed} of 32 output bytes changed since the last input.`;
      prev = digest;
      glyphs.forEach((el, k) => { const b = digest[k >> 1]; const nib = k % 2 ? b & 15 : b >> 4; el.querySelector('text').textContent = nib.toString(16); el.querySelector('circle').style.fill = hue(Math.round((b / 255) * 360)); gsap.fromTo(el, { scale: 1.9 }, { scale: 1, duration: dur(0.7), ease: 'expo.out', delay: dur(k * 0.006), transformOrigin: '50% 50%' }); });
    }
    return {
      init({ back, front }) {
        input = document.getElementById('hashInput'); grid = document.getElementById('hashGrid'); hexOut = document.getElementById('hashHex'); note = document.getElementById('hashNote');
        for (let i = 0; i < 32; i++) { const s = document.createElement('span'); s.style.background = 'var(--line)'; grid.appendChild(s); }
        const g = back.append('g'), f = front.append('g');
        guide(g, ORBIT, 'guide faint-ring');
        glyphs = d3.range(64).map((k) => { const layer = k % 8 === 0 ? f : g; const gg = layer.append('g').attr('class', 'glyph'); gg.append('circle').attr('r', 16).attr('class', 'glyph-bg'); gg.append('text').attr('class', 'strong glyph-text').attr('text-anchor', 'middle').attr('y', 5).text('0'); return gg.node(); });
        glyphs.forEach((el, k) => ride(el, ORBIT, { duration: 90, repeat: -1, start: k / 64, end: 1 + k / 64 }));
        let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 80); });
        run();
      },
      setStep(i) {
        const want = i === 1 ? `${sample}.` : sample;
        if (i <= 1 && input.value !== want && (input.value === sample || input.value === `${sample}.`)) { input.value = want; run(); }
        hud.caption(['<b>Figure 3.</b> A live SHA-256. The 64 orbiting glyphs are the hex digits of the digest; the pane shows the same 32 bytes as tiles.', '<b>Figure 3.</b> One appended character. Every glyph re-rolls. Bold hex marks bytes that changed.', '<b>Figure 3.</b> Git names blobs this way too; git-cas keeps its own SHA-256 per chunk in the manifest.'][i]);
      },
    };
  })();

  /* ------------------------------------------------------------ chunk */
  S.chunk = (() => {
    const N = 1200, FIXED = 32, MIN = 12, MAX = 72, MASK = 24;
    const rnd = mulberry(1337);
    const base = Array.from({ length: N }, () => Math.floor(rnd() * 256));
    const front = Array.from({ length: 40 }, () => Math.floor(rnd() * 256));
    let gF, gC, pathF, pathC, slider, step = 0, origFixed, origCdc, labelF, labelC;
    const FIXED_D = 'M600,230 C800,120 1000,330 1200,230 S1500,160 1580,260';
    const CDC_D = 'M600,600 C820,500 980,720 1200,610 S1480,540 1580,650';
    const chunksOf = (data, bounds) => bounds.map((s, i) => { const e = bounds[i + 1] ?? data.length; return { s, e, h: fnv(data.slice(s, e)) }; });
    const fixedBounds = (data) => { const b = []; for (let i = 0; i < data.length; i += FIXED) b.push(i); return b; };
    const cdcBounds = (data) => { const b = [0]; let last = 0; for (let i = 3; i < data.length; i++) { const h = (data[i - 3] * 31 + data[i - 2] * 17 + data[i - 1] * 7 + data[i]) >>> 0; if (i - last >= MIN && (h % MASK === 0 || i - last >= MAX)) { b.push(i); last = i; } } return b; };
    const sub = (pathEl, L, a, b, n = 10) => { let d = ''; for (let i = 0; i <= n; i++) { const p = pathEl.getPointAtLength(a + ((b - a) * i) / n); d += `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`; } return d; };
    const render = (g, pathEl, chunks, origSet, total) => {
      const L = pathEl.getTotalLength();
      const sel = g.selectAll('g.c').data(chunks, (d) => `${d.h}-${d.s}`);
      const enter = sel.enter().append('g').attr('class', 'c');
      enter.append('path').attr('class', 'seg').attr('fill', 'none').attr('stroke-width', 30);
      enter.append('path').attr('class', 'seg hatch').attr('fill', 'none').attr('stroke', 'url(#hatch)').attr('stroke-width', 30);
      const all = enter.merge(sel);
      all.each(function (d) { const a = (d.s / total) * L, b = (d.e / total) * L - 2; const dd = sub(pathEl, L, a, Math.max(a + 1, b)); const isNew = !origSet.has(d.h); d3.select(this).selectAll('path').attr('d', dd); d3.select(this).select('path:not(.hatch)').style('stroke', hue(d.h % 360)); d3.select(this).select('.hatch').attr('opacity', isNew ? 0.65 : 0); d3.select(this).classed('is-new', isNew); });
      enter.each(function () { gsap.fromTo(this.querySelector('.seg:not(.hatch)'), { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: dur(0.6), ease: 'power2.out' }); });
      all.each(function (d) { const isNew = !origSet.has(d.h); gsap.to(this, { y: isNew ? -22 : 0, duration: dur(0.5), ease: 'back.out(2)', overwrite: 'auto' }); });
      sel.exit().each(function () { gsap.to(this, { autoAlpha: 0, y: 30, duration: dur(0.3), onComplete: () => this.remove() }); });
      return chunks.filter((d) => !origSet.has(d.h)).length;
    };
    const update = () => {
      const k = step >= 1 ? +slider.value : 0;
      const data = k ? front.slice(0, k).concat(base) : base;
      const f = chunksOf(data, fixedBounds(data)), c = chunksOf(data, cdcBounds(data));
      const nf = render(gF, pathF.node(), f, origFixed, data.length), nc = render(gC, pathC.node(), c, origCdc, data.length);
      hud.readout(`<span>inserted <b>${k}</b> units</span><span>fixed: <b>${nf}/${f.length}</b> chunks changed</span><span>cdc: <b>${nc}/${c.length}</b> chunks changed</span>`);
    };
    return {
      init({ back }) {
        const g = back.append('g');
        g.append('defs').append('pattern').attr('id', 'hatch').attr('width', 8).attr('height', 8).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)').append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 8).attr('stroke', 'var(--ink)').attr('stroke-width', 2);
        pathF = guide(g, FIXED_D); pathC = guide(g, CDC_D);
        labelF = g.append('text').attr('x', 600).attr('y', 170).attr('class', 'title').text('fixed · cut every 256 KiB');
        labelC = g.append('text').attr('x', 600).attr('y', 540).attr('class', 'title').text('content-defined · cut where the rolling hash says so');
        gF = g.append('g'); gC = g.append('g');
        origFixed = new Set(chunksOf(base, fixedBounds(base)).map((d) => d.h));
        origCdc = new Set(chunksOf(base, cdcBounds(base)).map((d) => d.h));
        slider = document.getElementById('chunkInsert');
        slider.addEventListener('input', update);
        drawIn([pathF.node(), pathC.node()], 1.2, 0.2);
        update();
      },
      setStep(i) {
        step = i;
        if (i === 1 && +slider.value === 0) slider.value = 17;
        dim(gC, i >= 2); dim(labelC, i >= 2); dim(pathC, i >= 2);
        update();
        hud.caption(['<b>Figure 4.</b> The file as a strip along a path; every segment is a chunk coloured by its content hash.', '<b>Figure 4.</b> Bytes inserted at the front. Hatched, lifted segments are chunks whose hash changed.', '<b>Figure 4.</b> Content-defined boundaries move with the bytes. Simulation: 1,200 units, simplified rolling hash.'][i]);
      },
    };
  })();

  /* ------------------------------------------------------------ dedup */
  S.dedup = (() => {
    const rnd = mulberry(42);
    const v1 = Array.from({ length: 12 }, () => Math.floor(rnd() * 0xffffffff));
    const v2 = v1.slice(); v2[5] = Math.floor(rnd() * 0xffffffff);
    const pool = [...new Set([...v1, ...v2])];
    let top, bottom, blobs, e1, e2, newBlob, tokens = [], f;
    const X = (i, n, x0, x1) => x0 + (i * (x1 - x0)) / (n - 1);
    const topP = (i) => [X(i, 12, 640, 1540), 190 + Math.sin((i / 11) * Math.PI) * -40];
    const botP = (i) => [X(i, 12, 640, 1540), 700 + Math.sin((i / 11) * Math.PI) * 40];
    const poolP = (j) => [X(j, pool.length, 620, 1560), 455];
    return {
      init({ back, front }) {
        const g = back.append('g'); f = front.append('g');
        const cells = (layer, data, P, label, ly) => {
          layer.append('text').attr('x', 620).attr('y', ly).attr('class', 'title').text(label);
          const c = layer.append('g').selectAll('g').data(data).join('g').attr('transform', (d, i) => `translate(${P(i)[0]},${P(i)[1]})`);
          c.append('rect').attr('x', -34).attr('y', -20).attr('width', 68).attr('height', 40).attr('rx', 8).style('fill', (d) => hue(d % 360)).attr('class', 'cell');
          c.append('text').attr('class', 'small strong on-color').attr('text-anchor', 'middle').attr('y', 5).text((d, i) => `#${i}`);
          c.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 36).text((d) => hex(d, 6));
          return c;
        };
        e1 = g.append('g'); e2 = g.append('g');
        top = cells(g, v1, topP, 'hero.psd · version 1 · chunks 0–11', 120);
        bottom = cells(g, v2, botP, 'hero.psd · version 2 · chunks 0–11', 790);
        g.append('text').attr('x', 620).attr('y', 405).attr('class', 'title').text('.git/objects · one blob per distinct chunk');
        blobs = g.append('g').selectAll('g').data(pool).join('g').attr('transform', (d, j) => `translate(${poolP(j)[0]},${poolP(j)[1]})`);
        blobs.append('circle').attr('r', 20).style('fill', (d) => hue(d % 360)).attr('class', 'blob');
        blobs.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 40).text((d) => hex(d, 6));
        const pos = (d) => pool.indexOf(d);
        e1.selectAll('path').data(v1).join('path').attr('class', 'edge').attr('d', (d, i) => curve([topP(i)[0], topP(i)[1] + 20], [poolP(pos(d))[0], poolP(pos(d))[1] - 20], 0.1));
        e2.selectAll('path').data(v2).join('path').attr('class', 'edge accent').attr('d', (d, i) => curve([botP(i)[0], botP(i)[1] - 20], [poolP(pos(d))[0], poolP(pos(d))[1] + 20], -0.1)).attr('opacity', 0);
        newBlob = blobs.filter((d) => d === v2[5]);
        drawIn(e1, 1, 0.05);
      },
      setStep(i) {
        show(bottom, i >= 1); show(newBlob, i >= 2);
        if (i >= 2) { drawIn(e2.selectAll('path'), 0.9, 0.05); gsap.to(e2.selectAll('path').nodes(), { opacity: 1, duration: dur(0.3) }); } else gsap.to(e2.selectAll('path').nodes(), { opacity: 0, duration: dur(0.3) });
        if (i >= 2 && tokens.length === 0) { e2.selectAll('path').each(function (d, k) { const t = f.append('circle').attr('r', 9).style('fill', hue(d % 360)).attr('class', 'token').node(); tokens.push(t); ride(t, this, { duration: 1.6, delay: k * 0.08, ease: 'power2.inOut', onComplete: () => { gsap.to(t, { autoAlpha: 0, scale: 2.4, transformOrigin: '50% 50%', duration: dur(0.5) }); } }); }); gsap.fromTo(blobs.selectAll('circle').nodes(), { attr: { r: 20 } }, { attr: { r: 26 }, duration: dur(0.4), yoyo: true, repeat: 1, stagger: dur(0.06), delay: dur(1.4) }); }
        if (i < 2) { tokens.forEach((t) => t.remove()); tokens = []; }
        hud.readout(i >= 3 ? '<span>logical <b>6.00 MiB</b></span><span>stored <b>3.25 MiB</b></span><span><b>1</b> new object written</span>' : i >= 2 ? '<span><b>11</b> blobs shared</span><span><b>1</b> new blob</span>' : i >= 1 ? '<span>v2 differs in chunk <b>#5</b></span>' : '<span><b>12</b> chunks → <b>12</b> blobs</span>');
        hud.caption(['<b>Figure 5.</b> Version 1 across the top, its twelve blobs across the middle.', '<b>Figure 5.</b> Version 2 arrives along the bottom; one chunk carries a different hash.', '<b>Figure 5.</b> Eleven chunks land on blobs that already exist. Git writes one new object.', '<b>Figure 5.</b> Six MiB of logical content, 3.25 MiB stored.'][i]);
      },
    };
  })();

  /* --------------------------------------------------------- manifest */
  S.manifest = (() => {
    let spans, tree, edges, nodes, pane;
    return {
      init({ back }) {
        pane = document.getElementById('paneManifest');
        spans = pane.querySelectorAll('[data-hl]');
        const g = back.append('g');
        const root = d3.hierarchy({ n: 'root manifest', c: [{ n: 'sub-manifest 0', c: [{ n: 'chunks 0–499' }] }, { n: 'sub-manifest 1', c: [{ n: 'chunks 500–999' }] }, { n: 'sub-manifest 2', c: [{ n: 'chunks 1000–1,499' }] }] }, (d) => d.c);
        d3.tree().size([760, 260])(root);
        tree = g.append('g').attr('transform', 'translate(700,560)').attr('opacity', 0);
        edges = tree.selectAll('path').data(root.links()).join('path').attr('class', 'edge accent').attr('d', d3.linkVertical().x((d) => d.x).y((d) => d.y));
        nodes = tree.selectAll('g').data(root.descendants()).join('g').attr('transform', (d) => `translate(${d.x},${d.y})`);
        nodes.append('rect').attr('x', -80).attr('y', -18).attr('width', 160).attr('height', 36).attr('rx', 8).attr('class', (d) => `node-box${d.depth === 0 ? ' accent' : ''}`);
        nodes.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', 5).text((d) => d.data.n);
      },
      setStep(i) {
        spans.forEach((s) => { const on = s.dataset.hl === String(i); s.classList.toggle('hl', on); gsap.to(s, { opacity: on || i === 1 ? 1 : 0.5, duration: dur(0.3) }); });
        gsap.to(pane, { y: i === 2 ? '-18vh' : 0, duration: dur(0.8), ease: 'power3.inOut' });
        show(tree, i === 2, 0.6);
        if (i === 2) { drawIn(edges, 0.8, 0.1); gsap.fromTo(nodes.nodes(), { scale: 0.6, transformOrigin: '50% 50%' }, { scale: 1, duration: dur(0.6), stagger: dur(0.08), ease: 'back.out(1.6)' }); }
        hud.caption(['<b>Figure 6.</b> The manifest for <code>hero.psd</code>, abridged. Each entry: position, size, digest, blob.', '<b>Figure 6.</b> The recipe carries its own fingerprint and the format version that wrote it.', '<b>Figure 6.</b> Past 1,000 chunks the list becomes a tree of sub-manifests.'][i]);
      },
    };
  })();

  /* ---------------------------------------------------------- restore */
  S.restore = (() => {
    const rnd = mulberry(7);
    const chunks = Array.from({ length: 12 }, (_, i) => ({ i, h: Math.floor(rnd() * 0xffffffff) }));
    let tl, corrupt = false, step = 0, rows, blobs, out, pill, checks, lanes, f;
    const rowY = (i) => 160 + i * 50;
    const LANE = (j) => `M740,${rowY(0) + 25 + j * 0} C900,${220 + j * 130} 1150,${220 + j * 130} 1380,${440}`;
    const lanePath = (j) => `M760,${rowY(j * 3) + 10} C960,${200 + j * 140} 1180,${200 + j * 140} 1380,${440 + (j - 1.5) * 24}`;
    const build = () => {
      if (tl) tl.kill();
      gsap.set(blobs.nodes(), { x: 0, y: 0, autoAlpha: 0 });
      gsap.set(out.selectAll('rect').nodes(), { opacity: 0.1 });
      gsap.set(checks.nodes(), { autoAlpha: 0, scale: 0.4, transformOrigin: '50% 50%' });
      gsap.set(pill.node(), { autoAlpha: 0 });
      gsap.set(rows.selectAll('rect').nodes(), { stroke: 'var(--line-strong)' });
      tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.inOut' } });
      tl.addLabel('read').to(rows.selectAll('rect').nodes(), { stroke: 'var(--accent)', duration: 0.3, stagger: 0.03 });
      tl.addLabel('fetch', '+=0.1');
      let halted = false;
      chunks.forEach((c, i) => {
        if (halted) return;
        const t = 0.9 + i * 0.3, lane = i % 4, b = blobs.nodes()[i], chk = checks.nodes()[lane];
        tl.to(b, { autoAlpha: 1, duration: 0.1 }, t);
        tl.to(b, { motionPath: { path: lanes.nodes()[lane], start: 0, end: 0.78 }, duration: 0.7 }, t);
        if (i === 3) tl.addLabel('verify', t + 0.8);
        const bad = corrupt && i === 6;
        tl.to(chk, { autoAlpha: 1, scale: 1, duration: 0.2, onStart: () => { chk.querySelector('.ok').setAttribute('opacity', bad ? 0 : 1); chk.querySelector('.bad').setAttribute('opacity', bad ? 1 : 0); } }, t + 0.72);
        if (bad) { tl.to(pill.node(), { autoAlpha: 1, duration: 0.3 }, t + 0.95); halted = true; return; }
        tl.to(b, { motionPath: { path: lanes.nodes()[lane], start: 0.78, end: 1 }, duration: 0.25 }, t + 0.95);
        tl.to(b, { x: 1500 - 1380, y: rowY(i) + 12 - 440 - (lane - 1.5) * 24, duration: 0.35 }, t + 1.2);
        tl.to(out.selectAll('rect').nodes()[i], { opacity: 1, duration: 0.2 }, t + 1.5);
        tl.to(b, { autoAlpha: 0, duration: 0.2 }, t + 1.55);
        tl.to(chk, { autoAlpha: 0, duration: 0.2 }, t + 1.0);
      });
      tl.addLabel('done', '+=0.2');
    };
    const go = (label) => { if (reduce) tl.seek(label); else tl.tweenTo(label, { duration: Math.min(2.2, Math.abs(tl.labels[label] - tl.time()) * 0.5 + 0.3) }); };
    return {
      init({ back, front }) {
        const g = back.append('g'); f = front.append('g');
        g.append('text').attr('x', 620).attr('y', 120).attr('class', 'title').text('manifest · 12 entries');
        g.append('text').attr('x', 1000).attr('y', 120).attr('class', 'title').text('fetch window · 4 lanes in flight');
        g.append('text').attr('x', 1560).attr('y', 120).attr('text-anchor', 'end').attr('class', 'title').text('hero.psd · assembled in order');
        rows = g.append('g').selectAll('g').data(chunks).join('g').attr('transform', (d) => `translate(620,${rowY(d.i)})`);
        rows.append('rect').attr('width', 230).attr('height', 26).attr('rx', 6).attr('class', 'node-box');
        rows.append('text').attr('class', 'small').attr('x', 10).attr('y', 17).text((d) => `index ${String(d.i).padStart(2)}  digest ${hex(d.h, 8)}…`);
        lanes = g.append('g').selectAll('path').data(d3.range(4)).join('path').attr('class', 'guide lane').attr('fill', 'none').attr('d', (j) => `M860,${rowY(j * 3) + 13} C1000,${rowY(j * 3) + 13} 1100,${250 + j * 125} 1250,${250 + j * 125} S1380,${440 + (j - 1.5) * 24} 1380,${440 + (j - 1.5) * 24}`);
        out = g.append('g');
        out.selectAll('rect').data(chunks).join('rect').attr('x', 1440).attr('y', (d) => rowY(d.i)).attr('width', 120).attr('height', 26).attr('rx', 4).style('fill', (d) => hue(d.h % 360)).attr('opacity', 0.1);
        blobs = f.append('g').selectAll('g').data(chunks).join('g').attr('transform', (d) => `translate(860,${rowY(d.i) + 13})`).attr('opacity', 0);
        blobs.append('circle').attr('r', 12).style('fill', (d) => hue(d.h % 360)).attr('class', 'token');
        checks = f.append('g').selectAll('g').data(d3.range(4)).join('g').attr('transform', (j) => `translate(1300,${250 + j * 125 - 30})`).attr('opacity', 0);
        checks.append('path').attr('class', 'ok').attr('d', 'M-9,0 L-3,7 L10,-9').attr('fill', 'none').attr('stroke', 'var(--good)').attr('stroke-width', 4);
        checks.append('path').attr('class', 'bad').attr('d', 'M-9,-9 L9,9 M9,-9 L-9,9').attr('fill', 'none').attr('stroke', 'var(--danger)').attr('stroke-width', 4).attr('opacity', 0);
        pill = f.append('g').attr('transform', 'translate(1060,820)').attr('opacity', 0);
        pill.append('rect').attr('x', -170).attr('y', -22).attr('width', 340).attr('height', 44).attr('rx', 22).attr('fill', 'var(--danger-soft)').attr('stroke', 'var(--danger)');
        pill.append('text').attr('y', 6).attr('text-anchor', 'middle').attr('class', 'strong').attr('fill', 'var(--danger)').text('INTEGRITY_ERROR · chunk 6 · nothing written');
        drawIn(lanes, 1.2, 0.1);
        build();
        document.getElementById('restoreCorrupt').addEventListener('click', () => { corrupt = true; build(); go(['read', 'fetch', 'verify', 'done'][Math.max(step, 2)]); hud.caption('<b>Figure 7.</b> Blob 7 has one flipped byte. Its digest fails at the verifier and the line stops there.'); });
        document.getElementById('restoreReset').addEventListener('click', () => { corrupt = false; build(); go(['read', 'fetch', 'verify', 'done'][step]); hud.caption('<b>Figure 7.</b> Storage repaired. All twelve chunks verify and the file assembles.'); });
      },
      setStep(i) { step = i; go(['read', 'fetch', 'verify', 'done'][i]); if (!corrupt) hud.caption(['<b>Figure 7.</b> Twelve entries, nothing fetched yet.', '<b>Figure 7.</b> Four lanes pull blobs in parallel; arrival order does not matter.', '<b>Figure 7.</b> Every blob is hashed at the lane end and compared with its digest.', '<b>Figure 7.</b> Verified chunks slot into the file on the right, in manifest order.'][i]); },
    };
  })();

  /* --------------------------------------------------------- envelope */
  S.envelope = (() => {
    const rnd = mulberry(99);
    const rhex = () => hex(Math.floor(rnd() * 0xffffffff), 8);
    let g, f, recipients, dek, blobs, edges, wraps, inset;
    const people = [{ id: 'ada', label: 'Ada', how: 'passphrase → scrypt → KEK', wrapped: rhex(), kv: 1 }, { id: 'ci', label: 'CI runner', how: 'key file → KEK', wrapped: rhex(), kv: 1 }];
    const RX = 760, RY = (i) => 260 + i * 130, DEK = [1120, 450];
    const blobP = (d) => [1480 + Math.cos((d / 5) * Math.PI - Math.PI / 2) * 60, 180 + d * 110];
    const drawRecipients = () => {
      const sel = recipients.selectAll('g.r').data(people, (d) => d.id);
      const e = sel.enter().append('g').attr('class', 'r').attr('transform', (d, i) => `translate(${RX},${RY(i)})`).attr('opacity', 0);
      box(e, 290, 92);
      e.append('text').attr('class', 'strong').attr('x', -130).attr('y', -22).text((d) => d.label);
      e.append('text').attr('class', 'small').attr('x', -130).attr('y', 2).text((d) => d.how);
      e.append('text').attr('class', 'small w').attr('x', -130).attr('y', 26).text((d) => `wrappedDek ${d.wrapped}…  keyVersion ${d.kv}`);
      gsap.to(e.nodes(), { autoAlpha: 1, duration: dur(0.5) });
      const w = wraps.selectAll('path').data(people, (d) => d.id).join('path').attr('class', 'edge dashed').attr('d', (d, i) => curve([RX + 145, RY(i)], [DEK[0] - 70, DEK[1]], 0.15));
      drawIn(w, 0.8, 0.1);
    };
    return {
      init({ back, front }) {
        g = back.append('g'); f = front.append('g');
        wraps = g.append('g'); edges = g.append('g'); recipients = g.append('g');
        dek = f.append('g').attr('transform', `translate(${DEK[0]},${DEK[1]})`);
        dek.append('circle').attr('r', 58).attr('class', 'glow-ring');
        box(dek, 130, 64, 'accent');
        dek.append('text').attr('class', 'strong').attr('text-anchor', 'middle').attr('y', -6).text('DEK');
        dek.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 14).text('random 256-bit key');
        g.append('text').attr('x', 1560).attr('y', 110).attr('text-anchor', 'end').attr('class', 'title').text('encrypted chunks · AES-256-GCM');
        g.append('text').attr('x', 620).attr('y', 170).attr('class', 'title').text('recipients');
        blobs = g.append('g').selectAll('g').data(d3.range(6)).join('g').attr('transform', (d) => `translate(${blobP(d)[0]},${blobP(d)[1]})`);
        blobs.append('circle').attr('r', 28).style('fill', (d) => hue(60 * d)).attr('class', 'blob');
        blobs.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 48).text((d) => `nonce ${hex(d * 7919, 4)} · tag`);
        edges.selectAll('path').data(d3.range(6)).join('path').attr('class', 'edge accent').attr('d', (d) => curve([DEK[0] + 70, DEK[1]], [blobP(d)[0] - 30, blobP(d)[1]], 0.12));
        drawIn(edges.selectAll('path'), 1, 0.08);
        inset = f.append('g').attr('transform', 'translate(620,700)').attr('opacity', 0);
        inset.append('rect').attr('width', 560).attr('height', 96).attr('rx', 14).attr('class', 'node-box');
        inset.append('text').attr('class', 'strong').attr('x', 18).attr('y', 30).text('convergent: key = HMAC(master, sha256(plaintext chunk))');
        inset.append('text').attr('class', 'small').attr('x', 18).attr('y', 54).text('same plaintext → same key and nonce → same ciphertext → Git dedups it');
        inset.append('text').attr('class', 'small').attr('x', 18).attr('y', 78).attr('fill', 'var(--warn)').text('trade-off: anyone holding a plaintext chunk can confirm you stored it');
        document.getElementById('envAdd').addEventListener('click', () => { if (people.length < 3) { people.push({ id: 'bo', label: 'Bo', how: 'passphrase → scrypt → KEK', wrapped: rhex(), kv: 1 }); drawRecipients(); hud.caption('<b>Figure 8.</b> Bo joins. One more wrapped copy of the same DEK; the blobs did not change.'); } });
        document.getElementById('envRotate').addEventListener('click', () => {
          const ada = people[0]; ada.wrapped = rhex(); ada.kv += 1;
          const n = recipients.selectAll('g.r').filter((d) => d.id === 'ada');
          const token = f.append('circle').attr('r', 9).attr('class', 'token accent-fill').node();
          ride(token, wraps.selectAll('path').nodes()[0], { duration: 1.1, ease: 'power2.inOut', onComplete: () => { n.select('text.w').text(`wrappedDek ${ada.wrapped}…  keyVersion ${ada.kv}`); gsap.fromTo(n.select('rect').node(), { stroke: 'var(--accent)', strokeWidth: 5 }, { stroke: 'var(--line-strong)', strokeWidth: 1, duration: dur(1.2) }); gsap.to(token, { autoAlpha: 0, scale: 3, transformOrigin: '50% 50%', duration: dur(0.4), onComplete: () => token.remove() }); } });
          gsap.fromTo(blobs.selectAll('circle').nodes(), { opacity: 0.35 }, { opacity: 1, duration: dur(1.4), delay: dur(1) });
          hud.caption(`<b>Figure 8.</b> Ada rotated. Her wrapped key is new (keyVersion ${ada.kv}); the six ciphertext blobs are byte-identical.`);
        });
      },
      setStep(i) {
        if (i >= 1 && recipients.selectAll('g.r').empty()) drawRecipients();
        show(recipients, i >= 1); show(wraps, i >= 1); show(inset, i >= 3);
        dim([dek.node(), edges.node(), blobs.nodes()].flat(), i < 3);
        if (!reduce) gsap.to(dek.select('.glow-ring').node(), { attr: { r: 70 }, opacity: 0.2, duration: 1.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        hud.caption(['<b>Figure 8.</b> One data key encrypts every chunk; the slug is bound into every tag.', '<b>Figure 8.</b> Each recipient holds the DEK wrapped under their own key.', '<b>Figure 8.</b> Rotate Ada. Watch the token ride to the DEK: only her wrapped copy changes.', '<b>Figure 8.</b> Convergent mode derives per-chunk keys from content so dedup survives.'][i]);
      },
    };
  })();

  /* --------------------------------------------------------------- gc */
  S.gc = (() => {
    let ref, hero, logo, blobs, edgesH, edgesL, root2, storm, removed = false, step = 0, labelUn, btn, f;
    const B = [{ id: 'b1', y: 150 }, { id: 'b2', y: 270 }, { id: 'b3', y: 390, shared: true }, { id: 'b4', y: 510 }, { id: 'b5', y: 630 }, { id: 'b6', y: 750, logo: true }];
    const sweep = () => { gsap.fromTo(storm.node(), { x: -500, opacity: 0.9 }, { x: 1300, duration: dur(1.8), ease: 'power1.inOut', onComplete: () => gsap.set(storm.node(), { opacity: 0 }) }); };
    const apply = (withStorm) => {
      const anchored = step >= 1;
      const heroLive = anchored && !(removed && step >= 2), logoLive = anchored;
      show(ref, anchored); show(labelUn, !anchored);
      const d = withStorm ? 0.9 : 0;
      gsap.delayedCall(dur(d), () => {
        hero.classed('collectible', !heroLive); edgesH.classed('collectible', !heroLive); logo.classed('collectible', !logoLive); edgesL.classed('collectible', !logoLive);
        blobs.each(function (b) { const live = b.logo || b.shared ? logoLive : heroLive; d3.select(this).classed('collectible', !live); });
      });
      show(ref.selectAll('.hero-entry'), heroLive);
      show(root2, step >= 3);
      if (withStorm) sweep();
      hud.caption(step === 0 ? '<b>Figure 9.</b> Objects with no ref leading to them. The storm is <code>git gc</code>; dashed objects do not survive it.'
        : step === 1 ? '<b>Figure 9.</b> <code>refs/cas/vault</code> → commit → tree → manifests → blobs. Everything is reachable.'
          : step === 2 ? (removed ? '<b>Figure 9.</b> hero.psd removed from the vault tree. Its manifest and unique blobs are collectible; the shared blob stays.' : '<b>Figure 9.</b> Press the button in the step to remove hero.psd from the vault.')
            : '<b>Figure 9.</b> A root set is a second ref to a parentless commit. Replace it and the old generation is gone immediately.');
    };
    return {
      init({ back, front }) {
        const g = back.append('g'); f = front.append('g');
        storm = f.append('g').attr('opacity', 0); storm.append('rect').attr('x', 0).attr('y', 0).attr('width', 420).attr('height', 900).attr('fill', 'url(#stormGrad)');
        storm.append('text').attr('x', 210).attr('y', 60).attr('text-anchor', 'middle').attr('class', 'strong').attr('fill', 'var(--danger)').text('git gc --prune=now');
        labelUn = g.append('text').attr('x', 640).attr('y', 450).attr('class', 'strong').attr('fill', 'var(--danger)').text('no ref → unreachable');
        ref = g.append('g');
        node(ref, 700, 450, 190, 44, 'refs/cas/vault', null, 'accent');
        node(ref, 900, 450, 140, 44, 'commit', 'vault history');
        const tree = node(ref, 1090, 450, 150, 64, 'tree', null);
        tree.select('text').attr('y', -14); tree.append('text').attr('class', 'small hero-entry').attr('text-anchor', 'middle').attr('y', 6).text('brand/hero →'); tree.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 22).text('brand/logo →');
        ref.append('path').attr('class', 'edge').attr('d', 'M795,450 L830,450'); ref.append('path').attr('class', 'edge').attr('d', 'M970,450 L1015,450');
        ref.append('path').attr('class', 'edge hero-entry').attr('d', curve([1165, 440], [1250, 300], 0.1)); ref.append('path').attr('class', 'edge').attr('d', curve([1165, 462], [1250, 600], -0.1));
        edgesH = g.append('g'); edgesL = g.append('g');
        hero = node(g, 1300, 300, 190, 54, 'manifest', 'hero.psd · 48 chunks');
        logo = node(g, 1300, 600, 190, 54, 'manifest', 'logo.svg · 1 chunk');
        blobs = g.append('g').selectAll('g').data(B).join('g').attr('transform', (d) => `translate(1520,${d.y})`);
        blobs.append('circle').attr('r', 20).style('fill', (d, i) => hue(50 * i + 20)).attr('class', 'blob');
        blobs.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 40).text((d) => (d.shared ? 'shared by both' : 'blob'));
        edgesH.selectAll('path').data(B.filter((d) => !d.logo)).join('path').attr('class', 'edge').attr('d', (d) => curve([1395, 300], [1498, d.y], 0.08));
        edgesL.selectAll('path').data(B.filter((d) => d.logo || d.shared)).join('path').attr('class', 'edge').attr('d', (d) => curve([1395, 600], [1498, d.y], -0.08));
        root2 = g.append('g').attr('opacity', 0);
        node(root2, 740, 840, 240, 44, 'refs/cas/rootsets/app', null, 'accent'); node(root2, 980, 840, 150, 44, 'commit', 'no parent'); node(root2, 1200, 840, 170, 44, 'tree of entries', null);
        root2.append('path').attr('class', 'edge').attr('d', 'M860,840 L905,840'); root2.append('path').attr('class', 'edge').attr('d', 'M1055,840 L1115,840');
        root2.append('text').attr('class', 'small').attr('x', 1300).attr('y', 845).text('← replaced with compare-and-swap; no history keeps old generations alive');
        btn = document.getElementById('gcToggle');
        btn.addEventListener('click', () => { removed = !removed; btn.setAttribute('aria-pressed', String(removed)); btn.textContent = removed ? 'Put hero.psd back' : 'Remove hero.psd from the vault'; apply(removed); });
        apply(false);
      },
      setStep(i) { const prev = step; step = i; apply(i === 0 || (i === 2 && removed && prev < 2)); },
    };
  })();

  /* ----------------------------------------------------------- layers */
  S.layers = (() => {
    const floors = [
      { ref: 'refs/cas/workspaces/*', what: 'staging workspaces · atomic admission into one generation', pkg: 'git-cas-workspaces', extra: 'application handles · assets · immutable pages · ordered bundles → git-cas-bundles' },
      { ref: 'refs/cas/expiring/*', what: 'replay markers · add-if-absent · expiry-only release', pkg: 'git-cas-expire' },
      { ref: 'refs/cas/caches/*  +  refs/cas/cache-acquisitions/*', what: 'TTL · entry and byte limits · LRU eviction · pinned acquisitions', pkg: 'git-cas-cache' },
      { ref: 'refs/cas/rootsets/*', what: 'retention kernel · parentless commits · compare-and-swap', pkg: 'git-cas-rootsets' },
      { ref: 'refs/cas/vault', what: 'named assets with history · privacy mode · passphrase rotation', pkg: 'git-cas-vault' },
    ];
    const stepFloor = [4, 3, 2, 1, 0];
    let g, floorG, car;
    const FY = (i) => 160 + i * 150;
    return {
      init({ back, front }) {
        g = back.append('g');
        floorG = g.append('g').selectAll('g').data(floors).join('g').attr('transform', (d, i) => `translate(690,${FY(i)})`);
        floorG.append('rect').attr('width', 860).attr('height', 120).attr('rx', 16).attr('class', 'node-box');
        floorG.append('text').attr('class', 'strong').attr('x', 24).attr('y', 36).text((d) => d.ref);
        floorG.append('text').attr('class', 'small').attr('x', 24).attr('y', 62).text((d) => d.what);
        floorG.append('text').attr('class', 'small').attr('x', 24).attr('y', 100).attr('fill', 'var(--accent-text)').text((d) => `→ ${d.pkg}`);
        floorG.filter((d) => d.extra).append('text').attr('class', 'small').attr('x', 24).attr('y', 82).attr('fill', 'var(--ink-faint)').text((d) => d.extra);
        guide(g, 'M655,120 L655,900', 'guide');
        car = front.append('g').attr('transform', `translate(655,${FY(4) + 60})`);
        car.append('rect').attr('x', -14).attr('y', -40).attr('width', 28).attr('height', 80).attr('rx', 6).attr('fill', 'var(--accent)');
        car.append('text').attr('class', 'small on-accent').attr('text-anchor', 'middle').attr('y', 4).attr('transform', 'rotate(-90)').text('lift');
      },
      setStep(i) {
        const fl = stepFloor[i];
        // the elevator: the building moves so the active floor sits mid-screen
        gsap.to(g.node(), { y: 450 - (FY(fl) + 60), duration: dur(1), ease: 'power3.inOut' });
        gsap.to(car.node(), { y: 450 - (FY(4) + 60), duration: dur(1), ease: 'power3.inOut' });
        floorG.each(function (d, j) { gsap.to(this, { opacity: j === fl ? 1 : 0.28, scale: j === fl ? 1.03 : 1, transformOrigin: '0% 50%', duration: dur(0.6) }); });
        hud.caption(`<b>Figure 10.</b> Floor ${5 - fl} of 5 · <code>${floors[fl].ref}</code> → ${floors[fl].pkg}`);
      },
    };
  })();

  /* ----------------------------------------------------------- travel */
  S.travel = (() => {
    let push, fetches, xmark, badges, restoreEdge, origin, pk = [];
    return {
      init({ back, front }) {
        const g = back.append('g'), f = front.append('g');
        const m = machines;
        push = g.append('path').attr('class', 'edge accent thick').attr('d', curve([m.laptop.x, m.laptop.y], [m.origin.x, m.origin.y], 0.15)).attr('opacity', 0);
        fetches = g.append('g').selectAll('path').data(['eu', 'ci', 'archive', 'us']).join('path').attr('class', 'edge accent').attr('d', (d) => curve([m.origin.x, m.origin.y], [m[d].x, m[d].y], 0.12)).attr('opacity', 0);
        restoreEdge = g.append('path').attr('class', 'edge thick').attr('stroke', 'var(--good)').attr('d', curve([m.eu.x, m.eu.y], [m.ci.x, m.ci.y], 0.3)).attr('opacity', 0);
        const nodes = drawMachines(g);
        origin = nodes.origin;
        xmark = origin.append('path').attr('d', 'M-26,-26 L26,26 M26,-26 L-26,26').attr('stroke', 'var(--danger)').attr('stroke-width', 6).attr('fill', 'none').attr('opacity', 0);
        badges = {}; Object.entries(nodes).forEach(([id, n]) => { const b = n.append('g').attr('transform', 'translate(0,46)').attr('opacity', 0); b.append('rect').attr('x', -66).attr('y', -11).attr('width', 132).attr('height', 22).attr('rx', 11).attr('fill', 'var(--good-soft)').attr('stroke', 'var(--good)'); b.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 4).attr('fill', 'var(--good)').text('hero.psd ✓ 48 blobs'); badges[id] = b; });
        this.f = f;
      },
      setStep(i) {
        const f = this.f;
        show(push, i < 2); show(fetches, i >= 1 && i < 2);
        if (i === 0) { drawIn(push, 1); this.pushPk?.remove(); const p = f.append('circle').attr('r', 10).attr('class', 'token accent-fill').node(); this.pushPk = p; ride(p, push.node(), { duration: 1.6, repeat: -1, ease: 'power1.inOut' }); } else if (this.pushPk) { gsap.to(this.pushPk, { autoAlpha: 0, duration: dur(0.3) }); }
        if (i === 1 && pk.length === 0) { drawIn(fetches, 1, 0.12); fetches.each(function (_, k) { const p = f.append('circle').attr('r', 8).attr('class', 'token accent-fill').node(); pk.push(p); ride(p, this, { duration: 1.8, delay: k * 0.2, repeat: 2, ease: 'power1.inOut', onComplete: () => gsap.to(p, { autoAlpha: 0, duration: dur(0.3) }) }); }); }
        if (i !== 1) { pk.forEach((p) => p.remove()); pk = []; }
        show(badges.laptop, true); show(badges.origin, i < 2); ['eu', 'ci', 'archive', 'us'].forEach((id) => show(badges[id], i >= 1));
        show(xmark, i >= 2); gsap.to(origin.select('rect').node(), { opacity: i >= 2 ? 0.3 : 1, duration: dur(0.5) });
        show(restoreEdge, i >= 2); if (i === 2) drawIn(restoreEdge, 1);
        hud.caption(['<b>Figure 11.</b> Ada pushes. The vault ref, the manifest and 48 chunk blobs ride in the same pack as her commits.', '<b>Figure 11.</b> Every machine that fetches now holds the artifact, verified by Git on arrival.', '<b>Figure 11.</b> The origin is down. CI restores from the EU mirror; the archive restores offline.', '<b>Figure 11.</b> Compare with Figure 2: same machines, same outage, nothing dangles.'][i]);
      },
    };
  })();

  /* -------------------------------------------------------------- hex */
  S.hex = (() => {
    const ports = [
      { id: 'crypto', label: 'CryptoPort', adapters: [{ id: 'node', l: 'NodeCryptoAdapter', s: 'node:crypto' }, { id: 'bun', l: 'BunCryptoAdapter', s: 'Bun.CryptoHasher' }, { id: 'deno', l: 'WebCryptoAdapter', s: 'crypto.subtle' }] },
      { id: 'persist', label: 'GitPersistencePort', adapters: [{ l: 'GitPersistenceAdapter', s: '@git-stunts/plumbing' }] },
      { id: 'ref', label: 'GitRefPort', adapters: [{ l: 'GitRefAdapter', s: 'update-ref sessions' }] },
      { id: 'codec', label: 'CodecPort', adapters: [{ l: 'JsonCodec' }, { l: 'CborCodec', s: 'cbor-x' }] },
      { id: 'chunk', label: 'ChunkingPort', adapters: [{ l: 'FixedChunker' }, { l: 'CdcChunker', s: 'Buzhash' }] },
      { id: 'compress', label: 'CompressionPort', adapters: [{ l: 'NodeCompressionAdapter', s: 'node:zlib' }] },
    ];
    const C = { x: 1060, y: 480 }, R1 = 240, R2 = 380;
    let hexPath, core, portG, adG, edges, runtime = 'node';
    const applyRuntime = () => adG.each(function (d) { gsap.to(this, { opacity: d.id && d.id !== runtime ? 0.22 : 1, scale: d.id === runtime ? 1.08 : 1, transformOrigin: '50% 50%', duration: dur(0.5) }); });
    return {
      init({ back }) {
        const g = back.append('g');
        const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / ports.length;
        hexPath = guide(g, `M${d3.range(7).map((i) => `${C.x + R1 * Math.cos(ang(i))},${C.y + R1 * Math.sin(ang(i))}`).join(' L')}`, 'guide hexwall');
        core = g.append('g').attr('transform', `translate(${C.x},${C.y})`);
        core.append('circle').attr('r', 150).attr('class', 'core-fill');
        ['domain', 'CasService · strategies', 'ChunkRepository · manifests', 'KeyResolver · integrity', 'Uint8Array in, Uint8Array out', 'grep infrastructure src/domain → nothing'].forEach((t, i) => core.append('text').attr('class', i === 0 ? 'strong big' : 'small').attr('text-anchor', 'middle').attr('y', -52 + i * 24).text(t));
        const P = ports.map((p, i) => ({ ...p, x: C.x + R1 * Math.cos(ang(i)), y: C.y + R1 * Math.sin(ang(i)), a: ang(i) }));
        portG = g.append('g').selectAll('g').data(P).join('g').attr('transform', (d) => `translate(${d.x},${d.y})`);
        box(portG, 170, 34); portG.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', 5).text((d) => d.label);
        const A = P.flatMap((p) => p.adapters.map((a, j) => { const spread = (j - (p.adapters.length - 1) / 2) * 0.36; return { ...a, port: p, x: C.x + R2 * 1.08 * Math.cos(p.a + spread), y: C.y + R2 * Math.sin(p.a + spread) * 0.86 }; }));
        edges = g.append('g').selectAll('path').data(A).join('path').attr('class', 'edge').attr('d', (d) => `M${d.port.x},${d.port.y} L${d.x},${d.y}`);
        adG = g.append('g').selectAll('g').data(A).join('g').attr('transform', (d) => `translate(${d.x},${d.y})`);
        box(adG, 190, 44); adG.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', (d) => (d.s ? -3 : 5)).text((d) => d.l); adG.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 15).text((d) => d.s || '');
        document.querySelectorAll('[data-runtime]').forEach((b) => b.addEventListener('click', () => { runtime = b.dataset.runtime; document.querySelectorAll('[data-runtime]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); applyRuntime(); }));
        drawIn(hexPath, 1.4);
      },
      setStep(i) { show(portG, i >= 1); show(adG, i >= 2); show(edges, i >= 2); if (i >= 1) gsap.fromTo(portG.nodes(), { scale: 0.7, transformOrigin: '50% 50%' }, { scale: 1, duration: dur(0.6), stagger: dur(0.06), ease: 'back.out(1.8)' }); if (i >= 2) { drawIn(edges, 0.8, 0.04); applyRuntime(); } hud.caption(['<b>Figure 12.</b> The domain core. Nothing in here imports a runtime.', '<b>Figure 12.</b> Seven ports on the walls: the only contracts the domain knows.', '<b>Figure 12.</b> Adapters dock outside. Switch runtime in the step; the core does not move.'][i]); },
    };
  })();

  /* ------------------------------------------------------------ shape */
  S.shape = (() => {
    let leaves, deps, depEdges;
    const data = { name: '@git-stunts/git-cas', children: [{ name: 'src', children: [{ name: 'core', v: 10934 }, { name: 'bundles', v: 4264 }, { name: 'vault', v: 2505 }, { name: 'cache', v: 2342 }, { name: 'workspaces', v: 1863 }, { name: 'rootsets', v: 1518 }, { name: 'expire', v: 1162 }, { name: 'doctor', v: 989 }] }, { name: 'bin', children: [{ name: 'tui', v: 6238 }, { name: 'cli', v: 3517 }, { name: 'agent', v: 2574 }] }] };
    const DEPS = [{ n: '@git-stunts/plumbing' }, { n: '@git-stunts/alfred' }, { n: 'cbor-x · zod' }, { n: 'commander', bin: true }, { n: '@flyingrobots/bijou', bad: true }, { n: '@flyingrobots/bijou-node', bad: true }, { n: '@flyingrobots/bijou-tui', bad: true }, { n: '@flyingrobots/bijou-tui-app', bad: true, unused: true }];
    const ORBIT = 'M1000,150 C1300,150 1430,320 1430,480 C1430,640 1300,830 1000,830 C700,830 570,640 570,480 C570,320 700,150 1000,150 Z';
    return {
      init({ back, front }) {
        const g = back.append('g'), f = front.append('g');
        const root = d3.hierarchy(data).sum((d) => d.v).sort((a, b) => b.value - a.value);
        d3.pack().size([560, 560]).padding(8)(root);
        const pack = g.append('g').attr('transform', 'translate(720,200)');
        const nodes = pack.selectAll('g').data(root.descendants()).join('g').attr('transform', (d) => `translate(${d.x},${d.y})`);
        nodes.append('circle').attr('r', (d) => d.r).attr('class', (d) => (d.depth === 0 ? 'crate' : d.depth === 1 ? 'crate-dir' : 'crate-leaf')).attr('stroke-dasharray', (d) => (d.depth === 1 ? '6 6' : null));
        nodes.filter((d) => !d.children && d.r > 26).append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', -2).text((d) => d.data.name);
        nodes.filter((d) => !d.children && d.r > 26).append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 14).text((d) => d.value.toLocaleString());
        nodes.filter((d) => d.depth === 1).append('text').attr('class', 'small faint').attr('text-anchor', 'middle').attr('y', (d) => -d.r + 18).text((d) => `${d.data.name}/`);
        leaves = nodes.filter((d) => !d.children);
        g.append('text').attr('x', 1000).attr('y', 175).attr('class', 'title').attr('text-anchor', 'middle').text('@git-stunts/git-cas@6.5.10 · lines of source');
        guide(g, ORBIT, 'guide faint-ring');
        depEdges = g.append('g');
        deps = DEPS.map((d, i) => { const layer = d.bad ? f : g; const gg = layer.append('g').attr('class', 'dep'); gg.append('rect').attr('x', -110).attr('y', -15).attr('width', 220).attr('height', 30).attr('rx', 15).attr('class', `node-box${d.bad ? ' warn' : ''}`); gg.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', 5).text(d.n); ride(gg.node(), ORBIT, { duration: 70, repeat: -1, start: i / DEPS.length, end: 1 + i / DEPS.length }); return { d, el: gg }; });
        this.tui = root.descendants().find((d) => d.data.name === 'tui');
        gsap.fromTo(nodes.nodes(), { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: dur(0.9), stagger: dur(0.05), ease: 'back.out(1.4)' });
      },
      setStep(i) {
        leaves.select('circle').each(function (d) { gsap.to(this, { fill: i >= 1 && d.parent.data.name === 'bin' ? 'var(--accent-2-soft)' : 'var(--accent-soft)', stroke: i >= 1 && d.parent.data.name === 'bin' ? 'var(--accent-2)' : 'var(--line-strong)', duration: dur(0.5) }); });
        deps.forEach(({ d, el }) => { gsap.to(el.node(), { opacity: i === 0 ? 0.35 : i === 1 ? 0.55 : d.bad ? 1 : 0.3, duration: dur(0.5) }); gsap.to(el.select('rect').node(), { stroke: i >= 2 && d.bad ? 'var(--warn)' : 'var(--line-strong)', strokeWidth: i >= 2 && d.bad ? 3 : 1, duration: dur(0.5) }); el.select('text').text(i >= 2 && d.unused ? `${d.n} · never imported` : d.n); });
        hud.readout(i >= 2 ? '<span><b>4</b> TUI packages in the library tree</span><span><b>1</b> never imported</span>' : i >= 1 ? '<span>bin/ <b>12,329</b> lines</span><span><b>32%</b> of 38,808</span>' : '<span><b>38,808</b> lines</span><span><b>1</b> package</span>');
        hud.caption(['<b>Figure 13.</b> Source clusters sized by lines at <code>c02c87ee</code>. Dependencies orbit the crate.', '<b>Figure 13.</b> A third of the crate is terminal UI and CLI.', '<b>Figure 13.</b> Four Bijou packages orbit inside the library’s dependency closure.'][i]);
      },
    };
  })();

  /* -------------------------------------------------------------- dag */
  S.dag = (() => {
    const N = [
      { id: 'core', x: 1080, y: 790, lines: 10934, what: 'CasService, strategies, chunkers, codecs, crypto + Git adapters, ports, errors' },
      { id: 'rootsets', x: 900, y: 690, lines: 1518, what: 'RootSet registry, persistence, codecs, RetentionWitness' },
      { id: 'vault', x: 1360, y: 690, lines: 2505, what: 'VaultService, privacy index, passphrase rotation' },
      { id: 'bundles', x: 900, y: 590, lines: 4264, what: 'assets, pages, bundles, handles, retention, publication' },
      { id: 'cache', x: 680, y: 490, lines: 2342, what: 'cache sets, policy, acquisitions' },
      { id: 'expire', x: 900, y: 490, lines: 1162, what: 'expiring replay-marker sets' },
      { id: 'workspaces', x: 1120, y: 490, lines: 1863, what: 'staging workspaces, compound admission' },
      { id: 'doctor', x: 1080, y: 390, lines: 989, what: 'RepositoryDoctor, inspection adapter' },
      { id: 'git-cas', x: 1080, y: 290, lines: 400, what: 'umbrella: composition root + re-exports; entrypoints unchanged' },
      { id: 'agent', x: 1080, y: 200, lines: 4000, what: 'headless command executor, JSONL protocol, credentials' },
      { id: 'cli', x: 860, y: 115, lines: 3500, what: 'commander program, human renderers, git-cas binary' },
      { id: 'tui', x: 1080, y: 115, lines: 6200, what: 'cockpit dashboard, blocks, shaders' },
      { id: 'mcp', x: 1300, y: 115, lines: 0, what: 'new: MCP stdio server over the agent executor' },
      { id: 'testing', x: 650, y: 790, lines: 500, what: 'memory adapters, property helpers', priv: true },
      { id: 'bench', x: 1480, y: 290, lines: 1000, what: 'benchmarks, diagnostics, baselines', priv: true },
    ];
    const E = [['vault', 'core'], ['rootsets', 'core'], ['bundles', 'rootsets'], ['cache', 'bundles'], ['expire', 'bundles'], ['workspaces', 'bundles'], ['doctor', 'vault'], ['doctor', 'cache'], ['doctor', 'expire'], ['doctor', 'workspaces'], ['git-cas', 'doctor'], ['agent', 'git-cas'], ['cli', 'agent'], ['cli', 'tui'], ['tui', 'agent'], ['mcp', 'agent'], ['testing', 'core'], ['bench', 'git-cas']];
    const layerOf = { core: 0, rootsets: 1, vault: 1, bundles: 1, cache: 1, expire: 1, workspaces: 1, doctor: 1, 'git-cas': 2, agent: 3, cli: 3, tui: 3, mcp: 3, testing: 3, bench: 3 };
    const byId = Object.fromEntries(N.map((n) => [n.id, n]));
    const closure = (id) => { const out = new Set([id]); const walk = (x) => E.filter(([a]) => a === x).forEach(([, b]) => { if (!out.has(b)) { out.add(b); walk(b); } }); walk(id); return out; };
    let nodes, edges, tip, badges, step = 0, selected = null, light = [];
    const paint = () => {
      nodes.each(function (d) { const inStep = layerOf[d.id] <= step; const inSel = selected ? selected.has(d.id) : true; gsap.to(this, { opacity: inStep ? (inSel ? 1 : 0.18) : 0.08, duration: dur(0.5) }); });
      edges.each(function ([a, b]) { const inStep = layerOf[a] <= step && layerOf[b] <= step; const inSel = selected ? selected.has(a) && selected.has(b) : true; gsap.to(this, { opacity: inStep ? (inSel ? 0.9 : 0.08) : 0.04, stroke: selected && inSel ? 'var(--accent)' : 'var(--line-strong)', strokeWidth: selected && inSel ? 3 : 1.4, duration: dur(0.5) }); });
      light.forEach((l) => l.remove()); light = [];
      if (selected) edges.each(function ([a, b]) { if (selected.has(a) && selected.has(b)) { const t = d3.select(this.parentNode).append('circle').attr('r', 6).attr('class', 'token accent-fill').node(); light.push(t); ride(t, this, { duration: 1.4, repeat: -1, ease: 'power1.inOut' }); } });
    };
    return {
      init({ back, front }) {
        const g = back.append('g'); tip = document.getElementById('dagTip');
        edges = g.append('g').selectAll('path').data(E).join('path').attr('class', 'edge').attr('d', ([a, b]) => { const A = byId[a], B = byId[b]; const dy = B.y - A.y; return `M${A.x},${A.y + 20} C${A.x},${A.y + dy / 2} ${B.x},${B.y - dy / 2} ${B.x},${B.y - 22}`; });
        nodes = g.append('g').selectAll('g').data(N).join('g').attr('class', 'dag-node').attr('transform', (d) => `translate(${d.x},${d.y})`);
        nodes.append('rect').attr('x', -92).attr('y', -22).attr('width', 184).attr('height', 44).attr('rx', 12).attr('class', (d) => `node-box${d.id === 'git-cas' ? ' accent' : ''}`).attr('stroke-dasharray', (d) => (d.priv ? '5 4' : null));
        nodes.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', -3).text((d) => (d.id === 'git-cas' ? '@git-stunts/git-cas' : `git-cas-${d.id}`));
        badges = nodes.append('text').attr('class', 'small badge').attr('text-anchor', 'middle').attr('y', 14).attr('fill', 'var(--accent-text)').text((d) => (d.priv ? 'private' : '6.5.10'));
        const stage = document.getElementById('stage');
        nodes.on('pointerenter', (ev, d) => { tip.innerHTML = `<b>${d.id === 'git-cas' ? '@git-stunts/git-cas' : `@git-stunts/git-cas-${d.id}`}</b>${d.what}<br><span class="faint">${d.lines ? `≈ ${d.lines.toLocaleString()} lines` : 'new package'} · depends on ${E.filter(([a]) => a === d.id).map(([, b]) => b).join(', ') || 'nothing in the workspace'}</span>`; tip.classList.add('is-visible'); })
          .on('pointermove', (ev) => { tip.style.left = `${Math.min(ev.clientX + 16, innerWidth - tip.offsetWidth - 12)}px`; tip.style.top = `${Math.min(ev.clientY + 16, innerHeight - tip.offsetHeight - 12)}px`; })
          .on('pointerleave', () => tip.classList.remove('is-visible'))
          .on('click', (ev, d) => { selected = selected && selected.size === closure(d.id).size && selected.has(d.id) ? null : closure(d.id); paint(); });
        document.querySelectorAll('[data-closure]').forEach((b) => b.addEventListener('click', () => { selected = b.dataset.closure ? closure(b.dataset.closure) : null; paint(); }));
        void stage; drawIn(edges, 1.2, 0.03); paint();
      },
      setStep(i) {
        step = i; paint();
        if (i === 3) badges.filter((d) => !d.priv).each(function (d, j) { gsap.delayedCall(dur(0.07 * j), () => { this.textContent = '7.0.0'; gsap.fromTo(this, { scale: 1.6, transformOrigin: '50% 50%' }, { scale: 1, duration: dur(0.5), ease: 'back.out(2)' }); }); });
        else badges.filter((d) => !d.priv).text('6.5.10');
        hud.caption(['<b>Figure 14.</b> Layer 0: the core, with nothing from the workspace beneath it.', '<b>Figure 14.</b> The lifecycle packages, a DAG with no cycles. Click a node to light its dependency closure.', '<b>Figure 14.</b> The umbrella keeps its three entrypoints; git-warp’s 105 imports do not move.', '<b>Figure 14.</b> Apps on top. Every version badge ticks together: one version, one tag, one changelog.'][i]);
      },
    };
  })();

  /* ---------------------------------------------------------- roadmap */
  S.roadmap = {
    init(svgEl) {
      const svg = d3.select(svgEl);
      const stops = [
        { v: 'v6.5.11', t: 'Recovery', items: ['#131 Plumbing ≥ 3.3.2', 'closed-pipe mktree retry', 'ships from today’s layout'], soon: true },
        { v: 'v7.0.0', t: 'Workspace', items: ['slices 0–10', '#107 cockpit split', '#79 worktree bootstrap'], major: true },
        { v: 'v7.1.0', t: 'Operator', items: ['#39 Operator TUI', '#108 theme family', '#40 agent parity · MCP GA'] },
        { v: 'v7.2.0', t: 'Derive', items: ['#86 bundles.derive()', '#98 one-shot fallback', 'GitHub Action · sneakernet'] },
        { v: 'v7.3.0', t: 'Edge', items: ['#41 browser read path', 'git-cas-web', 'lazy chunk fetch'] },
        { v: 'v8.0.0', t: 'Conditional', items: ['#42 protocol audit', 'only with evidence'], dashed: true },
      ];
      const x = d3.scaleLinear().domain([0, stops.length - 1]).range([80, 880]);
      const rail = svg.append('path').attr('d', 'M40,90 C300,30 600,150 920,90').attr('class', 'edge rail').attr('fill', 'none');
      const g = svg.append('g').selectAll('g').data(stops).join('g').attr('class', 'rm-stop').attr('transform', (d, i) => { const p = rail.node().getPointAtLength((rail.node().getTotalLength() * (x(i) - 40)) / 880); return `translate(${p.x},${p.y})`; });
      g.append('circle').attr('r', (d) => (d.major ? 14 : 9)).attr('fill', (d) => (d.major ? 'var(--accent)' : 'var(--surface-raised)')).attr('stroke', (d) => (d.dashed ? 'var(--ink-faint)' : 'var(--accent)')).attr('stroke-width', 2).attr('stroke-dasharray', (d) => (d.dashed ? '3 3' : null));
      g.append('text').attr('class', 'strong').attr('text-anchor', 'middle').attr('y', -44).style('font-size', '15px').text((d) => d.v);
      g.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', -27).attr('fill', 'var(--accent-text)').text((d) => d.t);
      g.each(function (d) { d.items.forEach((it, j) => d3.select(this).append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 36 + j * 16).text(it)); });
      g.filter((d) => d.soon).append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 100).attr('fill', 'var(--warn)').text('blocked on upstream publish');
      S.roadmap.rail = rail; S.roadmap.stops = g;
    },
  };

  window.Scenes = S;
})();
