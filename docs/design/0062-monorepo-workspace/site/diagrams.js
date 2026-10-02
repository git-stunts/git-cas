/* global d3, gsap */
/* =====================================================================
   git-cas explainer — interactive diagrams (d3 + GSAP)
   Every diagram exposes { init(chapterEl), setStep(i) } on window.Diagrams.
   Colors come from theme tokens; hash-derived hues use oklch with the
   theme's --viz-l / --viz-c so they stay legible in every scheme.
   ===================================================================== */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = (s) => (reduce ? 0 : s);
  const hue = (h) => `oklch(var(--viz-l) var(--viz-c) ${h})`;
  const fnv = (arr) => { let h = 2166136261; for (const v of arr) { h ^= v & 255; h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
  const mulberry = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hex = (n, len) => (n >>> 0).toString(16).padStart(8, '0').slice(0, len);
  const board = (chapter) => chapter.querySelector('.board');
  const svgIn = (el, w, h) => d3.select(el).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('preserveAspectRatio', 'xMidYMid meet');
  const toolbar = (el) => { let t = el.querySelector('.board-toolbar'); if (!t) { t = document.createElement('div'); t.className = 'board-toolbar'; el.appendChild(t); } return t; };
  const readout = (el) => { let r = el.querySelector('.board-readout'); if (!r) { r = document.createElement('div'); r.className = 'board-readout'; el.appendChild(r); } return r; };
  const nodeBox = (g, w, h, cls = '') => g.append('rect').attr('x', -w / 2).attr('y', -h / 2).attr('width', w).attr('height', h).attr('rx', 8).attr('class', `node-box ${cls}`);
  const fade = (sel, on, d = 0.4) => gsap.to(sel.nodes(), { opacity: on ? 1 : 0.18, duration: dur(d), overwrite: 'auto' });
  const show = (sel, on, d = 0.4) => gsap.to(sel.nodes(), { opacity: on ? 1 : 0, duration: dur(d), overwrite: 'auto' });
  const defsArrow = (svg, id = 'arrow') => svg.append('defs').append('marker').attr('id', id).attr('viewBox', '0 0 10 10').attr('refX', 9).attr('refY', 5).attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto-start-reverse').append('path').attr('d', 'M0 0 L10 5 L0 10z').attr('fill', 'var(--line-strong)');

  // Six machines used by the problem and replication chapters.
  const MACHINES = [
    { id: 'laptop', label: 'Ada’s laptop', sub: 'working copy', x: 150, y: 120 },
    { id: 'origin', label: 'origin', sub: 'GitHub', x: 500, y: 60 },
    { id: 'eu', label: 'mirror · EU', sub: 'read-only fetch', x: 850, y: 120 },
    { id: 'ci', label: 'CI runner', sub: 'ephemeral clone', x: 850, y: 320 },
    { id: 'archive', label: 'offline archive', sub: 'air-gapped', x: 500, y: 380 },
    { id: 'us', label: 'mirror · US', sub: 'read-only fetch', x: 150, y: 320 },
  ];
  const drawMachines = (svg) => {
    const g = svg.append('g').attr('class', 'machines');
    const node = g.selectAll('g.m').data(MACHINES, (d) => d.id).join('g').attr('class', (d) => `m m-${d.id}`).attr('transform', (d) => `translate(${d.x},${d.y})`);
    nodeBox(node, 150, 54);
    node.append('text').attr('class', 'strong').attr('text-anchor', 'middle').attr('y', -4).text((d) => d.label);
    node.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 13).text((d) => d.sub);
    return node;
  };
  const link = (a, b) => `M${a.x},${a.y} L${b.x},${b.y}`;
  const byId = Object.fromEntries(MACHINES.map((m) => [m.id, m]));

  const D = {};

  /* ---------------------------------------------------------- problem */
  D.problem = (() => {
    let svg, ring, spokes, server, dangles, cap;
    return {
      init(ch) {
        const el = board(ch); cap = ch.querySelector('figcaption');
        svg = svgIn(el, 1000, 440);
        const pairs = [['laptop', 'origin'], ['origin', 'eu'], ['eu', 'ci'], ['ci', 'archive'], ['archive', 'us'], ['us', 'laptop'], ['laptop', 'archive'], ['origin', 'ci']];
        ring = svg.append('g').selectAll('path').data(pairs).join('path').attr('class', 'edge flow-dash').attr('d', ([a, b]) => link(byId[a], byId[b])).attr('opacity', 0.7);
        server = svg.append('g').attr('class', 'server').attr('transform', 'translate(500,220)').attr('opacity', 0);
        nodeBox(server, 190, 70, 'accent');
        server.append('text').attr('class', 'strong').attr('text-anchor', 'middle').attr('y', -8).text('artifact host');
        server.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 10).text('hero.psd lives only here');
        server.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 26).attr('fill', 'var(--ink-faint)').text('cdn.example / s3 bucket / LFS server');
        server.append('path').attr('class', 'x').attr('d', 'M-30,-30 L30,30 M30,-30 L-30,30').attr('stroke', 'var(--danger)').attr('stroke-width', 4).attr('fill', 'none').attr('opacity', 0);
        spokes = svg.append('g').selectAll('path').data(MACHINES).join('path').attr('class', 'edge dashed').attr('d', (d) => link(d, { x: 500, y: 220 })).attr('opacity', 0);
        drawMachines(svg);
        dangles = svg.append('g').selectAll('text').data(MACHINES).join('text').attr('class', 'small').attr('text-anchor', 'middle').attr('x', (d) => d.x).attr('y', (d) => d.y + 42).attr('fill', 'var(--danger)').text('pointer dangles').attr('opacity', 0);
      },
      setStep(i) {
        show(server, i >= 1);
        show(spokes, i >= 1);
        gsap.to(spokes.nodes(), { stroke: i >= 2 ? 'var(--danger)' : 'var(--line-strong)', duration: dur(0.4) });
        gsap.to(server.select('rect').node(), { opacity: i >= 2 ? 0.25 : 1, duration: dur(0.4) });
        show(server.select('.x'), i >= 2);
        show(dangles, i >= 2);
        gsap.to(ring.nodes(), { opacity: i >= 1 ? 0.3 : 0.7, duration: dur(0.4) });
        cap.innerHTML = ['<b>Figure 2.</b> Six replicas of the repository. Dashed arrows are ordinary fetch and push traffic.', '<b>Figure 2.</b> The artifact host is outside the repository; every machine depends on it for <code>hero.psd</code>.', '<b>Figure 2.</b> The host is gone. Every pointer dangles; the code is intact and the artifact is unreachable.'][i];
      },
    };
  })();

  /* ------------------------------------------------------------- hash */
  D.hash = (() => {
    let input, grid, hexOut, note, prev = null, sample = 'hero.psd, export 14: tweaked the sky gradient';
    const enc = new TextEncoder();
    async function run() {
      const bytes = enc.encode(input.value);
      let digest;
      try { digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); } catch { hexOut.textContent = 'SHA-256 is unavailable in this browser.'; return; }
      const tiles = grid.children;
      let changed = 0;
      const parts = [];
      digest.forEach((b, i) => {
        const diff = prev === null || prev[i] !== b; if (diff && prev !== null) changed++;
        tiles[i].style.background = hue(Math.round((b / 255) * 360));
        if (!reduce) gsap.fromTo(tiles[i], { scale: 0.6 }, { scale: 1, duration: 0.3, delay: i * 0.004, overwrite: true });
        const h = b.toString(16).padStart(2, '0');
        parts.push(diff && prev !== null ? `<b>${h}</b>` : h);
      });
      hexOut.innerHTML = parts.join('');
      note.textContent = prev === null ? `${bytes.length} input bytes → 32 output bytes, always.` : `${bytes.length} input bytes. ${changed} of 32 output bytes changed since the last input.`;
      prev = digest;
    }
    return {
      init(ch) {
        input = ch.querySelector('#hashInput'); grid = ch.querySelector('#hashGrid'); hexOut = ch.querySelector('#hashHex'); note = ch.querySelector('#hashNote');
        for (let i = 0; i < 32; i++) { const s = document.createElement('span'); s.style.background = 'var(--line)'; grid.appendChild(s); }
        let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 80); });
        run();
      },
      setStep(i) {
        const want = i === 1 ? `${sample}.` : sample;
        if (i <= 1 && input.value !== want && (input.value === sample || input.value === `${sample}.`)) { input.value = want; run(); }
      },
    };
  })();

  /* ------------------------------------------------------------ chunk */
  D.chunk = (() => {
    const N = 1200, FIXED = 32, MIN = 12, MAX = 72, MASK = 24, W = 1000;
    const rnd = mulberry(1337);
    const base = Array.from({ length: N }, () => Math.floor(rnd() * 256));
    const front = Array.from({ length: 40 }, () => Math.floor(rnd() * 256));
    let svg, gFixed, gCdc, slider, ro, step = 0, origFixed, origCdc;
    const chunksOf = (data, bounds) => bounds.map((s, i) => { const e = bounds[i + 1] ?? data.length; const h = fnv(data.slice(s, e)); return { s, e, h, len: e - s }; });
    const fixedBounds = (data) => { const b = []; for (let i = 0; i < data.length; i += FIXED) b.push(i); return b; };
    const cdcBounds = (data) => { const b = [0]; let last = 0; for (let i = 3; i < data.length; i++) { const h = (data[i - 3] * 31 + data[i - 2] * 17 + data[i - 1] * 7 + data[i]) >>> 0; if (i - last >= MIN && (h % MASK === 0 || i - last >= MAX)) { b.push(i); last = i; } } return b; };
    const render = (g, chunks, origSet, total) => {
      const x = d3.scaleLinear().domain([0, total]).range([20, W - 20]);
      const sel = g.selectAll('g.c').data(chunks, (d) => `${d.h}-${d.s}`);
      const enter = sel.enter().append('g').attr('class', 'c').attr('opacity', 0);
      enter.append('rect').attr('height', 56).attr('rx', 3);
      enter.append('rect').attr('class', 'hatch').attr('height', 56).attr('rx', 3).attr('fill', 'url(#hatch)');
      const all = enter.merge(sel);
      all.transition().duration(dur(500)).attr('opacity', 1);
      all.select('rect:not(.hatch)').transition().duration(dur(500)).attr('x', (d) => x(d.s)).attr('width', (d) => Math.max(1, x(d.e) - x(d.s) - 1.5)).style('fill', (d) => hue(d.h % 360)).attr('stroke', (d) => (origSet.has(d.h) ? 'none' : 'var(--ink)')).attr('stroke-width', 1.2);
      all.select('rect.hatch').transition().duration(dur(500)).attr('x', (d) => x(d.s)).attr('width', (d) => Math.max(1, x(d.e) - x(d.s) - 1.5)).attr('opacity', (d) => (origSet.has(d.h) ? 0 : 0.7));
      sel.exit().transition().duration(dur(300)).attr('opacity', 0).remove();
      return chunks.filter((d) => !origSet.has(d.h)).length;
    };
    const update = () => {
      const k = step >= 1 ? +slider.value : 0;
      const data = k ? front.slice(0, k).concat(base) : base;
      const f = chunksOf(data, fixedBounds(data)), c = chunksOf(data, cdcBounds(data));
      const nf = render(gFixed, f, origFixed, data.length), nc = render(gCdc, c, origCdc, data.length);
      ro.innerHTML = `<span>inserted <b>${k}</b> units</span><span>fixed: <b>${nf}/${f.length}</b> chunks changed</span><span>cdc: <b>${nc}/${c.length}</b> chunks changed</span>`;
    };
    return {
      init(ch) {
        const el = board(ch); svg = svgIn(el, W, 270); ro = readout(el);
        svg.append('defs').append('pattern').attr('id', 'hatch').attr('width', 6).attr('height', 6).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)').append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6).attr('stroke', 'var(--ink)').attr('stroke-width', 1.5);
        svg.append('text').attr('x', 20).attr('y', 48).attr('class', 'title').text('fixed · cut every 256 KiB');
        svg.append('text').attr('x', 20).attr('y', 178).attr('class', 'title').text('content-defined · cut where the rolling hash says so');
        gFixed = svg.append('g').attr('transform', 'translate(0,60)');
        gCdc = svg.append('g').attr('transform', 'translate(0,190)');
        origFixed = new Set(chunksOf(base, fixedBounds(base)).map((d) => d.h));
        origCdc = new Set(chunksOf(base, cdcBounds(base)).map((d) => d.h));
        slider = ch.querySelector('#chunkInsert');
        slider.addEventListener('input', update);
        update();
      },
      setStep(i) {
        step = i;
        if (i === 1 && +slider.value === 0) slider.value = 17;
        gsap.to(gCdc.node(), { opacity: i >= 2 ? 1 : 0.15, duration: dur(0.5) });
        gsap.to(svg.selectAll('text.title').nodes()[1], { opacity: i >= 2 ? 1 : 0.3, duration: dur(0.5) });
        update();
      },
    };
  })();

  /* ------------------------------------------------------------ dedup */
  D.dedup = (() => {
    const rnd = mulberry(42);
    const v1 = Array.from({ length: 12 }, () => Math.floor(rnd() * 0xffffffff));
    const v2 = v1.slice(); v2[5] = Math.floor(rnd() * 0xffffffff);
    const pool = [...new Set([...v1, ...v2])];
    let svg, top, bottom, blobs, e1, e2, ro, newBlob;
    const cx = (i, n) => 70 + (i * (860 / (n - 1)));
    return {
      init(ch) {
        const el = board(ch); svg = svgIn(el, 1000, 320); ro = readout(el);
        const cell = (g, data, y, label) => {
          g.append('text').attr('x', 20).attr('y', y - 30).attr('class', 'title').text(label);
          const c = g.selectAll('g').data(data).join('g').attr('transform', (d, i) => `translate(${cx(i, 12)},${y})`);
          c.append('rect').attr('x', -30).attr('y', -16).attr('width', 60).attr('height', 32).attr('rx', 5).style('fill', (d) => hue(d % 360)).attr('stroke', 'var(--line-strong)');
          c.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', 4).attr('fill', 'var(--surface)').text((d, i) => `#${i}`);
          c.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 30).text((d) => hex(d, 6));
          return c;
        };
        e1 = svg.append('g'); e2 = svg.append('g');
        top = cell(svg.append('g'), v1, 60, 'hero.psd · version 1 · chunks 0–11');
        bottom = cell(svg.append('g'), v2, 270, 'hero.psd · version 2 · chunks 0–11');
        const by = 165;
        blobs = svg.append('g').selectAll('g').data(pool).join('g').attr('transform', (d, i) => `translate(${cx(i, pool.length)},${by})`);
        blobs.append('circle').attr('r', 15).style('fill', (d) => hue(d % 360)).attr('stroke', 'var(--line-strong)');
        blobs.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 30).text((d) => hex(d, 6));
        svg.append('text').attr('x', 20).attr('y', by - 30).attr('class', 'title').text('.git/objects · one blob per distinct chunk');
        const pos = (d) => pool.indexOf(d);
        e1.selectAll('path').data(v1).join('path').attr('class', 'edge').attr('d', (d, i) => `M${cx(i, 12)},76 C${cx(i, 12)},120 ${cx(pos(d), pool.length)},110 ${cx(pos(d), pool.length)},${by - 15}`);
        e2.selectAll('path').data(v2).join('path').attr('class', 'edge accent').attr('d', (d, i) => `M${cx(i, 12)},254 C${cx(i, 12)},210 ${cx(pos(d), pool.length)},220 ${cx(pos(d), pool.length)},${by + 15}`);
        newBlob = blobs.filter((d) => d === v2[5]);
      },
      setStep(i) {
        show(bottom, i >= 1); show(e2, i >= 2); show(newBlob, i >= 2);
        gsap.to(blobs.filter((d) => d !== v2[5]).selectAll('circle').nodes(), { attr: { r: i >= 2 ? 18 : 15 }, duration: dur(0.4) });
        gsap.to(newBlob.select('circle').node(), { attr: { 'stroke-width': i >= 2 ? 3 : 1 }, stroke: i >= 2 ? 'var(--accent-2)' : 'var(--line-strong)', duration: dur(0.4) });
        ro.innerHTML = i >= 3 ? '<span>logical <b>6.00 MiB</b></span><span>stored <b>3.25 MiB</b></span><span><b>1</b> new object written</span>' : i >= 2 ? '<span><b>11</b> blobs shared</span><span><b>1</b> new blob</span>' : i >= 1 ? '<span>v2 differs in chunk <b>#5</b></span>' : '<span><b>12</b> chunks → <b>12</b> blobs</span>';
      },
    };
  })();

  /* --------------------------------------------------------- manifest */
  D.manifest = (() => {
    let spans, svg;
    return {
      init(ch) {
        spans = ch.querySelectorAll('[data-hl]');
        svg = d3.select(ch.querySelector('#d-merkle')).style('opacity', 0);
        const root = d3.hierarchy({ n: 'root manifest', c: [{ n: 'sub-manifest 0', c: [{ n: 'chunks 0–499' }] }, { n: 'sub-manifest 1', c: [{ n: 'chunks 500–999' }] }, { n: 'sub-manifest 2', c: [{ n: 'chunks 1000–1,499' }] }] }, (d) => d.c);
        d3.tree().size([480, 90])(root);
        const g = svg.append('g').attr('transform', 'translate(20,25)');
        g.selectAll('path').data(root.links()).join('path').attr('class', 'edge').attr('d', d3.linkVertical().x((d) => d.x).y((d) => d.y));
        const n = g.selectAll('g').data(root.descendants()).join('g').attr('transform', (d) => `translate(${d.x},${d.y})`);
        n.append('rect').attr('x', -56).attr('y', -11).attr('width', 112).attr('height', 22).attr('rx', 5).attr('class', (d) => `node-box${d.depth === 0 ? ' accent' : ''}`);
        n.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', 4).text((d) => d.data.n);
      },
      setStep(i) {
        spans.forEach((s) => { const on = s.dataset.hl === String(i); s.classList.toggle('hl', on); gsap.to(s, { opacity: on || i === 1 ? 1 : 0.55, duration: dur(0.3) }); });
        gsap.to(svg.node(), { opacity: i === 2 ? 1 : 0, duration: dur(0.5) });
      },
    };
  })();

  /* ---------------------------------------------------------- restore */
  D.restore = (() => {
    const rnd = mulberry(7);
    const chunks = Array.from({ length: 12 }, (_, i) => ({ i, h: Math.floor(rnd() * 0xffffffff) }));
    let svg, tl, corrupt = false, step = 0, cap, rows, blobs, slots, out, pill;
    const rowY = (i) => 44 + i * 26;
    const build = () => {
      if (tl) tl.kill();
      gsap.set(blobs.nodes(), { x: 0, y: 0, opacity: 0 });
      gsap.set(out.selectAll('rect').nodes(), { opacity: 0.12 });
      gsap.set(svg.selectAll('.check').nodes(), { opacity: 0, scale: 0.4, transformOrigin: '50% 50%' });
      gsap.set(pill.node(), { opacity: 0 });
      gsap.set(rows.selectAll('rect').nodes(), { stroke: 'var(--line-strong)' });
      tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.inOut' } });
      tl.addLabel('read').to(rows.selectAll('rect').nodes(), { stroke: 'var(--accent)', duration: 0.3, stagger: 0.03 });
      tl.addLabel('fetch', '+=0.1');
      const SLOT = (i) => ({ x: 480 - 150, y: 100 + (i % 4) * 60 - rowY(i) });
      const OUT = (i) => ({ x: 760 - 150, y: 0 });
      let halted = false;
      chunks.forEach((c, i) => {
        if (halted) return;
        const t = 0.9 + i * 0.22;
        const b = blobs.nodes()[i];
        tl.to(b, { opacity: 1, duration: 0.1 }, t);
        tl.to(b, { x: SLOT(i).x, y: SLOT(i).y, duration: 0.35 }, t);
        if (i === 3) tl.addLabel('verify', t + 0.5);
        const bad = corrupt && i === 6;
        const chk = svg.selectAll('.check').nodes()[i];
        tl.to(chk, { opacity: 1, scale: 1, duration: 0.2, onStart: () => { chk.dataset.bad = bad ? '1' : ''; chk.querySelector('.ok').setAttribute('opacity', bad ? 0 : 1); chk.querySelector('.bad').setAttribute('opacity', bad ? 1 : 0); } }, t + 0.45);
        if (bad) { tl.to(pill.node(), { opacity: 1, duration: 0.3 }, t + 0.7); halted = true; return; }
        tl.to(b, { x: OUT(i).x, y: OUT(i).y, duration: 0.35 }, t + 0.7);
        tl.to(out.selectAll('rect').nodes()[i], { opacity: 1, duration: 0.2 }, t + 1.0);
        tl.to(chk, { opacity: 0, duration: 0.2 }, t + 0.75);
      });
      tl.addLabel('done', '+=0.2');
    };
    const go = (label) => { if (reduce) tl.seek(label); else tl.tweenTo(label, { duration: Math.min(1.6, Math.abs(tl.labels[label] - tl.time()) * 0.6 + 0.3) }); };
    return {
      init(ch) {
        const el = board(ch); cap = ch.querySelector('#cap-restore');
        svg = svgIn(el, 1000, 380);
        svg.append('text').attr('x', 40).attr('y', 24).attr('class', 'title').text('manifest · 12 entries');
        svg.append('text').attr('x', 410).attr('y', 24).attr('class', 'title').text('fetch window · 4 slots');
        svg.append('text').attr('x', 700).attr('y', 24).attr('class', 'title').text('hero.psd · assembled in order');
        rows = svg.append('g').selectAll('g').data(chunks).join('g').attr('transform', (d) => `translate(40,${rowY(d.i)})`);
        rows.append('rect').attr('width', 220).attr('height', 20).attr('rx', 4).attr('class', 'node-box');
        rows.append('text').attr('class', 'small').attr('x', 8).attr('y', 14).text((d) => `index ${String(d.i).padStart(2)}  digest ${hex(d.h, 8)}…`);
        for (let j = 0; j < 4; j++) svg.append('rect').attr('x', 452).attr('y', 100 + j * 60 - 22).attr('width', 56).attr('height', 44).attr('rx', 8).attr('fill', 'none').attr('stroke', 'var(--line)').attr('stroke-dasharray', '3 3');
        out = svg.append('g');
        out.selectAll('rect').data(chunks).join('rect').attr('x', 700).attr('y', (d) => rowY(d.i)).attr('width', 260).attr('height', 20).attr('rx', 3).style('fill', (d) => hue(d.h % 360)).attr('opacity', 0.12);
        blobs = svg.append('g').selectAll('g').data(chunks).join('g').attr('transform', (d) => `translate(${290},${rowY(d.i) + 10})`).attr('opacity', 0);
        blobs.append('circle').attr('r', 9).style('fill', (d) => hue(d.h % 360)).attr('stroke', 'var(--surface)').attr('stroke-width', 2);
        const checks = svg.append('g').selectAll('g').data(chunks).join('g').attr('class', 'check').attr('transform', (d) => `translate(${540},${100 + (d.i % 4) * 60})`).attr('opacity', 0);
        checks.append('path').attr('class', 'ok').attr('d', 'M-6,0 L-2,5 L7,-6').attr('fill', 'none').attr('stroke', 'var(--good)').attr('stroke-width', 3);
        checks.append('path').attr('class', 'bad').attr('d', 'M-6,-6 L6,6 M6,-6 L-6,6').attr('fill', 'none').attr('stroke', 'var(--danger)').attr('stroke-width', 3).attr('opacity', 0);
        pill = svg.append('g').attr('transform', 'translate(700,340)').attr('opacity', 0);
        pill.append('rect').attr('width', 260).attr('height', 30).attr('rx', 15).attr('fill', 'var(--danger-soft)').attr('stroke', 'var(--danger)');
        pill.append('text').attr('x', 130).attr('y', 19).attr('text-anchor', 'middle').attr('class', 'strong').attr('fill', 'var(--danger)').text('INTEGRITY_ERROR · chunk 6');
        build();
        ch.querySelector('#restoreCorrupt').addEventListener('click', () => { corrupt = true; build(); go(['read', 'fetch', 'verify', 'done'][Math.max(step, 2)]); cap.innerHTML = '<b>Figure 7.</b> Blob 7 has one flipped byte. Its digest no longer matches the manifest, and the restore halts there.'; });
        ch.querySelector('#restoreReset').addEventListener('click', () => { corrupt = false; build(); go(['read', 'fetch', 'verify', 'done'][step]); cap.innerHTML = '<b>Figure 7.</b> Storage repaired. All twelve chunks verify and the file assembles.'; });
      },
      setStep(i) { step = i; go(['read', 'fetch', 'verify', 'done'][i]); },
    };
  })();

  /* --------------------------------------------------------- envelope */
  D.envelope = (() => {
    const rnd = mulberry(99);
    const rhex = () => hex(Math.floor(rnd() * 0xffffffff), 8);
    let svg, recipients, dek, blobs, edges, wraps, inset, cap;
    const people = [{ id: 'ada', label: 'Ada', how: 'passphrase → scrypt → KEK', wrapped: rhex(), kv: 1 }, { id: 'ci', label: 'CI runner', how: 'key file → KEK', wrapped: rhex(), kv: 1 }];
    const rx = 150, ry = (i) => 90 + i * 95;
    const drawRecipients = () => {
      const sel = recipients.selectAll('g.r').data(people, (d) => d.id);
      const g = sel.enter().append('g').attr('class', 'r').attr('transform', (d, i) => `translate(${rx},${ry(i)})`).attr('opacity', 0);
      nodeBox(g, 230, 72);
      g.append('text').attr('class', 'strong').attr('x', -103).attr('y', -16).text((d) => d.label);
      g.append('text').attr('class', 'small').attr('x', -103).attr('y', 2).text((d) => d.how);
      g.append('text').attr('class', 'small w').attr('x', -103).attr('y', 22).text((d) => `wrappedDek ${d.wrapped}…  keyVersion ${d.kv}`);
      g.transition().duration(dur(400)).attr('opacity', 1);
      wraps.selectAll('path').data(people, (d) => d.id).join('path').attr('class', 'edge dashed').attr('d', (d, i) => `M${rx + 115},${ry(i)} C${rx + 200},${ry(i)} ${500 - 120},190 ${500 - 60},190`);
    };
    return {
      init(ch) {
        const el = board(ch); cap = ch.querySelector('#cap-envelope'); svg = svgIn(el, 1000, 380);
        wraps = svg.append('g'); edges = svg.append('g'); recipients = svg.append('g');
        dek = svg.append('g').attr('transform', 'translate(500,190)');
        nodeBox(dek, 120, 56, 'accent');
        dek.append('text').attr('class', 'strong').attr('text-anchor', 'middle').attr('y', -6).text('DEK');
        dek.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 12).text('random 256-bit key');
        svg.append('text').attr('x', 760).attr('y', 36).attr('class', 'title').text('encrypted chunks · AES-256-GCM');
        svg.append('text').attr('x', 36).attr('y', 36).attr('class', 'title').text('recipients');
        blobs = svg.append('g').selectAll('g').data(d3.range(6)).join('g').attr('transform', (d) => `translate(${820 + (d % 2) * 70},${80 + Math.floor(d / 2) * 90})`);
        blobs.append('circle').attr('r', 22).style('fill', (d) => hue(60 * d)).attr('stroke', 'var(--line-strong)');
        blobs.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 40).text((d) => `nonce ${hex(d * 7919, 4)} · tag`);
        edges.selectAll('path').data(d3.range(6)).join('path').attr('class', 'edge accent').attr('d', (d) => `M560,190 C680,190 700,${80 + Math.floor(d / 2) * 90} ${798 + (d % 2) * 70},${80 + Math.floor(d / 2) * 90}`);
        drawRecipients();
        inset = svg.append('g').attr('transform', 'translate(36,290)').attr('opacity', 0);
        inset.append('rect').attr('width', 420).attr('height', 72).attr('rx', 10).attr('class', 'node-box');
        inset.append('text').attr('class', 'strong').attr('x', 14).attr('y', 22).text('convergent: key = HMAC(master, sha256(plaintext chunk))');
        inset.append('text').attr('class', 'small').attr('x', 14).attr('y', 42).text('same plaintext → same key and nonce → same ciphertext → Git dedups it');
        inset.append('text').attr('class', 'small').attr('x', 14).attr('y', 60).attr('fill', 'var(--warn)').text('trade-off: holders of a plaintext chunk can confirm you stored it');
        ch.querySelector('#envAdd').addEventListener('click', () => { if (people.length < 3) { people.push({ id: 'bo', label: 'Bo', how: 'passphrase → scrypt → KEK', wrapped: rhex(), kv: 1 }); drawRecipients(); cap.innerHTML = '<b>Figure 8.</b> Bo joins. One more wrapped copy of the same DEK; the blobs did not change.'; } });
        ch.querySelector('#envRotate').addEventListener('click', () => {
          const ada = people[0]; ada.wrapped = rhex(); ada.kv += 1;
          const node = recipients.selectAll('g.r').filter((d) => d.id === 'ada');
          node.select('text.w').text(`wrappedDek ${ada.wrapped}…  keyVersion ${ada.kv}`);
          gsap.fromTo(node.select('rect').node(), { stroke: 'var(--accent)', strokeWidth: 4 }, { stroke: 'var(--line-strong)', strokeWidth: 1, duration: dur(1.2) });
          gsap.fromTo(blobs.selectAll('circle').nodes(), { opacity: 0.4 }, { opacity: 1, duration: dur(1.2) });
          cap.innerHTML = `<b>Figure 8.</b> Ada rotated. Her wrapped key is new (keyVersion ${ada.kv}); the six ciphertext blobs are byte-identical to before.`;
        });
      },
      setStep(i) {
        show(recipients, i >= 1); show(wraps, i >= 1); show(inset, i >= 3);
        gsap.to([dek.node(), edges.node(), blobs.nodes()].flat(), { opacity: i >= 3 ? 0.35 : 1, duration: dur(0.4) });
      },
    };
  })();

  /* --------------------------------------------------------------- gc */
  D.gc = (() => {
    let svg, cap, ref, hero, logo, blobs, edgesH, edgesL, root2, removed = false, step = 0, labelUn, btn;
    const B = [{ id: 'b1', y: 60 }, { id: 'b2', y: 110 }, { id: 'b3', y: 160, shared: true }, { id: 'b4', y: 210 }, { id: 'b5', y: 260 }, { id: 'b6', y: 310, logo: true }];
    const apply = () => {
      const anchored = step >= 1;
      const heroLive = anchored && !(removed && step >= 2);
      const logoLive = anchored;
      show(ref, anchored); show(labelUn, !anchored);
      hero.classed('collectible', !heroLive); edgesH.classed('collectible', !heroLive);
      logo.classed('collectible', !logoLive); edgesL.classed('collectible', !logoLive);
      blobs.each(function (d) { const live = (d.logo || d.shared) ? logoLive : (d.shared ? (heroLive || logoLive) : heroLive); d3.select(this).classed('collectible', !live); });
      show(ref.select('.hero-entry'), heroLive);
      show(root2, step >= 3);
      cap.innerHTML = step === 0 ? '<b>Figure 9.</b> Objects with no ref leading to them. Dashed means <code>git gc</code> will delete them.'
        : step === 1 ? '<b>Figure 9.</b> <code>refs/cas/vault</code> → commit → tree → manifests → blobs. Everything is reachable.'
          : step === 2 ? (removed ? '<b>Figure 9.</b> hero.psd removed from the vault tree. Its manifest and unique blobs are collectible; the blob shared with logo.svg stays.' : '<b>Figure 9.</b> Press the button in the step to remove hero.psd from the vault.')
            : '<b>Figure 9.</b> A root set is a second ref to a parentless commit. Replace it and the old generation is gone immediately.';
    };
    return {
      init(ch) {
        const el = board(ch); cap = ch.querySelector('#cap-gc'); svg = svgIn(el, 1000, 400); defsArrow(svg, 'gcArrow');
        const col = (x, y, w, lines, cls = '') => { const g = svg.append('g').attr('transform', `translate(${x},${y})`); nodeBox(g, w, 18 + lines.length * 16, cls); lines.forEach((t, i) => g.append('text').attr('class', i === 0 ? 'small strong' : 'small').attr('text-anchor', 'middle').attr('y', -2 + i * 16 - (lines.length - 1) * 8 + 4).text(t)); return g; };
        labelUn = svg.append('text').attr('x', 60).attr('y', 170).attr('class', 'strong').attr('fill', 'var(--danger)').text('no ref → unreachable');
        ref = svg.append('g');
        col.call(null, 0, 0, 0, []);
        const r = ref.append('g'); r.append('g').attr('transform', 'translate(90,160)').call((g) => { nodeBox(g, 150, 34, 'accent'); g.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', 4).text('refs/cas/vault'); });
        r.append('g').attr('transform', 'translate(250,160)').call((g) => { nodeBox(g, 110, 34); g.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', -2).text('commit'); g.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 12).text('vault history'); });
        r.append('g').attr('transform', 'translate(400,160)').call((g) => { nodeBox(g, 120, 50); g.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', -10).text('tree'); g.append('text').attr('class', 'small hero-entry').attr('text-anchor', 'middle').attr('y', 6).text('brand/hero →'); g.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 20).text('brand/logo →'); });
        r.append('path').attr('class', 'edge').attr('d', 'M165,160 L194,160').attr('marker-end', 'url(#gcArrow)');
        r.append('path').attr('class', 'edge').attr('d', 'M305,160 L339,160').attr('marker-end', 'url(#gcArrow)');
        edgesH = svg.append('g'); edgesL = svg.append('g');
        hero = col(580, 110, 150, ['manifest', 'hero.psd · 48 chunks']);
        logo = col(580, 260, 150, ['manifest', 'logo.svg · 1 chunk']);
        blobs = svg.append('g').selectAll('g').data(B).join('g').attr('transform', (d) => `translate(820,${d.y})`);
        blobs.append('circle').attr('r', 14).style('fill', (d, i) => hue(50 * i + 20)).attr('stroke', 'var(--line-strong)');
        blobs.append('text').attr('class', 'small').attr('x', 22).attr('y', 4).text((d) => d.shared ? 'blob · shared by both' : 'blob');
        edgesH.selectAll('path').data(B.filter((d) => !d.logo)).join('path').attr('class', 'edge').attr('d', (d) => `M655,110 C740,110 740,${d.y} 804,${d.y}`);
        edgesL.selectAll('path').data(B.filter((d) => d.logo || d.shared)).join('path').attr('class', 'edge').attr('d', (d) => `M655,260 C740,260 740,${d.y} 804,${d.y}`);
        ref.append('path').attr('class', 'edge').attr('d', 'M460,150 L503,115').attr('marker-end', 'url(#gcArrow)').attr('class', 'edge hero-entry');
        ref.append('path').attr('class', 'edge').attr('d', 'M460,172 L503,255').attr('marker-end', 'url(#gcArrow)');
        root2 = svg.append('g').attr('opacity', 0);
        root2.append('g').attr('transform', 'translate(110,355)').call((g) => { nodeBox(g, 190, 34, 'accent'); g.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', 4).text('refs/cas/rootsets/app'); });
        root2.append('g').attr('transform', 'translate(290,355)').call((g) => { nodeBox(g, 120, 34); g.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', -2).text('commit'); g.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 12).text('no parent'); });
        root2.append('g').attr('transform', 'translate(440,355)').call((g) => { nodeBox(g, 120, 34); g.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', 4).text('tree of entries'); });
        root2.append('path').attr('class', 'edge').attr('d', 'M205,355 L229,355').attr('marker-end', 'url(#gcArrow)');
        root2.append('path').attr('class', 'edge').attr('d', 'M350,355 L379,355').attr('marker-end', 'url(#gcArrow)');
        root2.append('text').attr('class', 'small').attr('x', 520).attr('y', 359).text('← replaced with compare-and-swap; nothing keeps old generations alive');
        btn = ch.querySelector('#gcToggle');
        btn.addEventListener('click', () => { removed = !removed; btn.setAttribute('aria-pressed', String(removed)); btn.textContent = removed ? 'Put hero.psd back' : 'Remove hero.psd from the vault'; apply(); });
        apply();
      },
      setStep(i) { step = i; apply(); },
    };
  })();

  /* ----------------------------------------------------------- layers */
  D.layers = (() => {
    const lanes = [
      { ref: 'refs/cas/vault', what: 'named assets, history', pkg: 'git-cas-vault', rows: ['commit', 'commit', 'commit'] },
      { ref: 'refs/cas/rootsets/*', what: 'retention kernel', pkg: 'git-cas-rootsets', rows: ['parentless commit'] },
      { ref: 'refs/cas/caches/*', what: 'TTL · limits · LRU', pkg: 'git-cas-cache', rows: ['index generation'] },
      { ref: 'refs/cas/cache-acquisitions/*', what: 'pinned while in use', pkg: 'git-cas-cache', rows: ['acquisition'] },
      { ref: 'refs/cas/expiring/*', what: 'add-if-absent · expiry only', pkg: 'git-cas-expire', rows: ['marker set'] },
      { ref: 'refs/cas/workspaces/*', what: 'atomic admission', pkg: 'git-cas-workspaces', rows: ['generation'] },
    ];
    const lit = [[0], [1], [2, 3], [4], [5]];
    let svg, laneG, band;
    return {
      init(ch) {
        svg = svgIn(board(ch), 1000, 340);
        laneG = svg.append('g').selectAll('g').data(lanes).join('g').attr('transform', (d, i) => `translate(${20 + i * 160},20)`);
        laneG.append('rect').attr('width', 150).attr('height', 230).attr('rx', 10).attr('class', 'node-box');
        laneG.append('text').attr('class', 'small strong').attr('x', 10).attr('y', 22).text((d) => d.ref);
        laneG.append('text').attr('class', 'small').attr('x', 10).attr('y', 40).text((d) => d.what);
        laneG.each(function (d) { const g = d3.select(this); d.rows.forEach((r, j) => { g.append('rect').attr('x', 12).attr('y', 60 + j * 36).attr('width', 126).attr('height', 26).attr('rx', 5).attr('fill', 'var(--accent-soft)').attr('stroke', 'var(--line)'); g.append('text').attr('class', 'small').attr('x', 20).attr('y', 77 + j * 36).text(r); }); });
        laneG.append('text').attr('class', 'small').attr('x', 10).attr('y', 216).attr('fill', 'var(--accent-text)').text((d) => `→ ${d.pkg}`);
        band = svg.append('g').attr('transform', 'translate(20,270)');
        band.append('rect').attr('width', 950).attr('height', 50).attr('rx', 10).attr('class', 'node-box');
        band.append('text').attr('class', 'small strong').attr('x', 14).attr('y', 22).text('application handles · assets · immutable pages · ordered bundles');
        band.append('text').attr('class', 'small').attr('x', 14).attr('y', 40).text('opaque handles instead of raw object ids; retained through root sets, published through allow-listed refs → git-cas-bundles');
      },
      setStep(i) {
        laneG.each(function (d, j) { gsap.to(this, { opacity: lit[i].includes(j) ? 1 : 0.3, duration: dur(0.4) }); });
        gsap.to(band.node(), { opacity: i === 4 ? 1 : 0.3, duration: dur(0.4) });
      },
    };
  })();

  /* ----------------------------------------------------------- travel */
  D.travel = (() => {
    let svg, push, fetches, xmark, badges, restoreEdge, cap, origin;
    return {
      init(ch) {
        const el = board(ch); cap = ch.querySelector('#cap-travel'); svg = svgIn(el, 1000, 440); defsArrow(svg, 'trArrow');
        push = svg.append('path').attr('class', 'edge accent flow-dash').attr('d', link(byId.laptop, byId.origin)).attr('marker-end', 'url(#trArrow)').attr('stroke-width', 2.5).attr('opacity', 0);
        fetches = svg.append('g').selectAll('path').data(['eu', 'ci', 'archive', 'us']).join('path').attr('class', 'edge accent flow-dash').attr('d', (d) => link(byId.origin, byId[d])).attr('marker-end', 'url(#trArrow)').attr('opacity', 0);
        restoreEdge = svg.append('path').attr('class', 'edge flow-dash').attr('d', link(byId.eu, byId.ci)).attr('stroke', 'var(--good)').attr('stroke-width', 2.5).attr('opacity', 0);
        const nodes = drawMachines(svg);
        origin = nodes.filter((d) => d.id === 'origin');
        xmark = origin.append('path').attr('d', 'M-20,-20 L20,20 M20,-20 L-20,20').attr('stroke', 'var(--danger)').attr('stroke-width', 4).attr('fill', 'none').attr('opacity', 0);
        badges = nodes.append('g').attr('class', 'badge').attr('transform', 'translate(0,40)').attr('opacity', 0);
        badges.append('rect').attr('x', -52).attr('y', -9).attr('width', 104).attr('height', 18).attr('rx', 9).attr('fill', 'var(--good-soft)').attr('stroke', 'var(--good)');
        badges.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 4).attr('fill', 'var(--good)').text('hero.psd ✓ 48 blobs');
      },
      setStep(i) {
        show(push, i >= 0 && i < 2);
        show(fetches, i >= 1 && i < 2);
        show(badges.filter((d) => d.id === 'laptop'), true);
        show(badges.filter((d) => d.id === 'origin'), i >= 0 && i < 2);
        show(badges.filter((d) => ['eu', 'ci', 'archive', 'us'].includes(d.id)), i >= 1);
        show(xmark, i >= 2); gsap.to(origin.select('rect').node(), { opacity: i >= 2 ? 0.3 : 1, duration: dur(0.4) });
        show(restoreEdge, i >= 2);
        cap.innerHTML = ['<b>Figure 11.</b> Ada pushes. The vault ref, the manifest and 48 chunk blobs travel in the same pack as her commits.', '<b>Figure 11.</b> Every machine that fetches now holds the artifact, verified by Git on arrival.', '<b>Figure 11.</b> The origin is down. CI restores from the EU mirror; the archive restores offline.', '<b>Figure 11.</b> Compare with Figure 2: same machines, same outage, nothing dangles.'][i];
      },
    };
  })();

  /* -------------------------------------------------------------- hex */
  D.hex = (() => {
    const ports = [
      { id: 'crypto', label: 'CryptoPort', adapters: [{ id: 'node', l: 'NodeCryptoAdapter', s: 'node:crypto' }, { id: 'bun', l: 'BunCryptoAdapter', s: 'Bun.CryptoHasher' }, { id: 'deno', l: 'WebCryptoAdapter', s: 'crypto.subtle' }] },
      { id: 'persist', label: 'GitPersistencePort', adapters: [{ l: 'GitPersistenceAdapter', s: '@git-stunts/plumbing · git CLI' }] },
      { id: 'ref', label: 'GitRefPort', adapters: [{ l: 'GitRefAdapter', s: 'update-ref sessions' }] },
      { id: 'codec', label: 'CodecPort', adapters: [{ l: 'JsonCodec' }, { l: 'CborCodec', s: 'cbor-x' }] },
      { id: 'chunk', label: 'ChunkingPort', adapters: [{ l: 'FixedChunker' }, { l: 'CdcChunker', s: 'Buzhash' }] },
      { id: 'compress', label: 'CompressionPort', adapters: [{ l: 'NodeCompressionAdapter', s: 'node:zlib' }] },
    ];
    let svg, core, portG, adG, edges, runtime = 'node';
    const applyRuntime = () => adG.each(function (d) { gsap.to(this, { opacity: d.id && d.id !== runtime ? 0.25 : 1, duration: dur(0.4) }); });
    return {
      init(ch) {
        svg = svgIn(board(ch), 1000, 400);
        const C = { x: 500, y: 200 };
        edges = svg.append('g');
        core = svg.append('g').attr('transform', `translate(${C.x},${C.y})`);
        core.append('circle').attr('r', 92).attr('fill', 'var(--accent-soft)').attr('stroke', 'var(--accent)').attr('stroke-width', 1.5);
        ['domain', 'CasService · strategies', 'ChunkRepository · manifests', 'KeyResolver · integrity', 'Uint8Array in, Uint8Array out'].forEach((t, i) => core.append('text').attr('class', i === 0 ? 'strong' : 'small').attr('text-anchor', 'middle').attr('y', -34 + i * 17).text(t));
        const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / ports.length;
        const P = ports.map((p, i) => ({ ...p, x: C.x + 165 * Math.cos(ang(i)), y: C.y + 165 * Math.sin(ang(i)), a: ang(i) }));
        portG = svg.append('g').selectAll('g').data(P).join('g').attr('transform', (d) => `translate(${d.x},${d.y})`);
        nodeBox(portG, 132, 26);
        portG.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', 4).text((d) => d.label);
        const A = P.flatMap((p) => p.adapters.map((a, j) => { const spread = (j - (p.adapters.length - 1) / 2) * 0.32; const r = 300; return { ...a, port: p, x: C.x + r * Math.cos(p.a + spread), y: C.y + r * Math.sin(p.a + spread) * 0.62 }; }));
        edges.selectAll('path').data(A).join('path').attr('class', 'edge').attr('d', (d) => `M${d.port.x},${d.port.y} L${d.x},${d.y}`);
        adG = svg.append('g').selectAll('g').data(A).join('g').attr('transform', (d) => `translate(${d.x},${d.y})`);
        nodeBox(adG, 150, 34);
        adG.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', (d) => (d.s ? -2 : 4)).text((d) => d.l);
        adG.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 12).text((d) => d.s || '');
        ch.querySelectorAll('[data-runtime]').forEach((b) => b.addEventListener('click', () => { runtime = b.dataset.runtime; ch.querySelectorAll('[data-runtime]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); applyRuntime(); }));
        applyRuntime();
      },
      setStep(i) { show(portG, i >= 1); show(adG, i >= 2); show(edges, i >= 2); if (i >= 2) applyRuntime(); },
    };
  })();

  /* ------------------------------------------------------------ shape */
  D.shape = (() => {
    let svg, leaves, deps, depEdges, ro;
    const data = { name: '@git-stunts/git-cas', children: [
      { name: 'src', children: [{ name: 'core', v: 10934 }, { name: 'bundles', v: 4264 }, { name: 'vault', v: 2505 }, { name: 'cache', v: 2342 }, { name: 'workspaces', v: 1863 }, { name: 'rootsets', v: 1518 }, { name: 'expire', v: 1162 }, { name: 'doctor', v: 989 }] },
      { name: 'bin', children: [{ name: 'tui', v: 6238 }, { name: 'cli', v: 3517 }, { name: 'agent', v: 2574 }] },
    ] };
    const DEPS = [{ n: '@git-stunts/plumbing', ok: true }, { n: '@git-stunts/alfred', ok: true }, { n: 'cbor-x · zod', ok: true }, { n: 'commander', ok: true, bin: true }, { n: '@flyingrobots/bijou', bad: true }, { n: '@flyingrobots/bijou-node', bad: true }, { n: '@flyingrobots/bijou-tui', bad: true }, { n: '@flyingrobots/bijou-tui-app', bad: true, unused: true }];
    return {
      init(ch) {
        const el = board(ch); svg = svgIn(el, 1000, 400); ro = readout(el);
        const root = d3.hierarchy(data).sum((d) => d.v).sort((a, b) => b.value - a.value);
        d3.pack().size([380, 380]).padding(6)(root);
        const g = svg.append('g').attr('transform', 'translate(30,10)');
        const nodes = g.selectAll('g').data(root.descendants()).join('g').attr('transform', (d) => `translate(${d.x},${d.y})`);
        nodes.append('circle').attr('r', (d) => d.r).attr('fill', (d) => (d.depth === 0 ? 'none' : d.depth === 1 ? 'var(--surface-raised)' : 'var(--accent-soft)')).attr('stroke', (d) => (d.depth === 0 ? 'var(--accent)' : 'var(--line-strong)')).attr('stroke-dasharray', (d) => (d.depth === 1 ? '4 4' : null));
        nodes.filter((d) => !d.children && d.r > 22).append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', -2).text((d) => d.data.name);
        nodes.filter((d) => !d.children && d.r > 22).append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 12).text((d) => d.value.toLocaleString());
        nodes.filter((d) => d.depth === 1).append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', (d) => -d.r + 14).attr('fill', 'var(--ink-faint)').text((d) => `${d.data.name}/`);
        leaves = nodes.filter((d) => !d.children);
        svg.append('text').attr('x', 220).attr('y', 24).attr('class', 'title').attr('text-anchor', 'middle').text('@git-stunts/git-cas@6.5.10 · lines of source');
        svg.append('text').attr('x', 520).attr('y', 24).attr('class', 'title').text('runtime dependencies');
        depEdges = svg.append('g');
        deps = svg.append('g').selectAll('g').data(DEPS).join('g').attr('transform', (d, i) => `translate(520,${50 + i * 40})`);
        deps.append('rect').attr('width', 440).attr('height', 30).attr('rx', 6).attr('class', 'node-box');
        deps.append('text').attr('class', 'small strong').attr('x', 12).attr('y', 19).text((d) => d.n);
        deps.append('text').attr('class', 'small tagtext').attr('x', 428).attr('y', 19).attr('text-anchor', 'end').text((d) => (d.unused ? 'declared, never imported' : d.bad ? 'terminal UI framework' : d.bin ? 'CLI only' : 'storage'));
        const tui = root.descendants().find((d) => d.data.name === 'tui');
        depEdges.selectAll('path').data(DEPS.filter((d) => d.bad)).join('path').attr('class', 'edge dashed').attr('d', (d, i) => `M${30 + tui.x + tui.r},${10 + tui.y} C460,${10 + tui.y} 460,${65 + (i + 4) * 40} 520,${65 + (i + 4) * 40}`).attr('stroke', 'var(--warn)');
      },
      setStep(i) {
        leaves.select('circle').each(function (d) { gsap.to(this, { fill: i >= 1 && d.parent.data.name === 'bin' ? 'var(--accent-2-soft)' : 'var(--accent-soft)', stroke: i >= 1 && d.parent.data.name === 'bin' ? 'var(--accent-2)' : 'var(--line-strong)', duration: dur(0.5) }); });
        deps.each(function (d) { gsap.to(this, { opacity: i === 0 ? 0.25 : i === 1 ? 0.5 : d.bad ? 1 : 0.4, duration: dur(0.4) }); });
        deps.select('rect').each(function (d) { gsap.to(this, { stroke: i >= 2 && d.bad ? 'var(--warn)' : 'var(--line-strong)', duration: dur(0.4) }); });
        show(depEdges, i >= 2);
        ro.innerHTML = i >= 2 ? '<span><b>4</b> TUI packages in the library tree</span><span><b>1</b> never imported</span>' : i >= 1 ? '<span>bin/ <b>12,329</b> lines</span><span><b>32%</b> of 38,808</span>' : '<span><b>38,808</b> lines</span><span><b>1</b> package</span>';
      },
    };
  })();

  /* -------------------------------------------------------------- dag */
  D.dag = (() => {
    const N = [
      { id: 'core', x: 500, y: 490, lines: 10934, what: 'CasService, strategies, chunkers, codecs, crypto + Git adapters, ports, errors' },
      { id: 'rootsets', x: 400, y: 425, lines: 1518, what: 'RootSet registry, persistence, codecs, RetentionWitness' },
      { id: 'vault', x: 720, y: 425, lines: 2505, what: 'VaultService, privacy index, passphrase rotation' },
      { id: 'bundles', x: 400, y: 360, lines: 4264, what: 'assets, pages, bundles, handles, retention, publication' },
      { id: 'cache', x: 240, y: 295, lines: 2342, what: 'cache sets, policy, acquisitions' },
      { id: 'expire', x: 400, y: 295, lines: 1162, what: 'expiring replay-marker sets' },
      { id: 'workspaces', x: 560, y: 295, lines: 1863, what: 'staging workspaces, compound admission' },
      { id: 'doctor', x: 500, y: 230, lines: 989, what: 'RepositoryDoctor, inspection adapter' },
      { id: 'git-cas', x: 500, y: 165, lines: 400, what: 'umbrella: composition root + re-exports; entrypoints unchanged' },
      { id: 'agent', x: 500, y: 100, lines: 4000, what: 'headless command executor, JSONL protocol, credentials' },
      { id: 'cli', x: 360, y: 35, lines: 3500, what: 'commander program, human renderers, git-cas binary' },
      { id: 'tui', x: 500, y: 35, lines: 6200, what: 'cockpit dashboard, blocks, shaders' },
      { id: 'mcp', x: 640, y: 35, lines: 0, what: 'new: MCP stdio server over the agent executor' },
      { id: 'testing', x: 160, y: 490, lines: 500, what: 'memory adapters, property helpers', priv: true },
      { id: 'bench', x: 840, y: 165, lines: 1000, what: 'benchmarks, diagnostics, baselines', priv: true },
    ];
    const E = [['vault', 'core'], ['rootsets', 'core'], ['bundles', 'rootsets'], ['cache', 'bundles'], ['expire', 'bundles'], ['workspaces', 'bundles'], ['doctor', 'vault'], ['doctor', 'cache'], ['doctor', 'expire'], ['doctor', 'workspaces'], ['git-cas', 'doctor'], ['agent', 'git-cas'], ['cli', 'agent'], ['cli', 'tui'], ['tui', 'agent'], ['mcp', 'agent'], ['testing', 'core'], ['bench', 'git-cas']];
    const layerOf = { core: 0, rootsets: 1, vault: 1, bundles: 1, cache: 1, expire: 1, workspaces: 1, doctor: 1, 'git-cas': 2, agent: 3, cli: 3, tui: 3, mcp: 3, testing: 3, bench: 3 };
    const byId = Object.fromEntries(N.map((n) => [n.id, n]));
    const closure = (id) => { const out = new Set([id]); const walk = (x) => E.filter(([a]) => a === x).forEach(([, b]) => { if (!out.has(b)) { out.add(b); walk(b); } }); walk(id); return out; };
    let svg, nodes, edges, tip, boardEl, badges, step = 0, selected = null;
    const paint = () => {
      nodes.each(function (d) { const inStep = layerOf[d.id] <= step; const inSel = selected ? selected.has(d.id) : true; gsap.to(this, { opacity: inStep ? (inSel ? 1 : 0.2) : 0.12, duration: dur(0.4) }); });
      edges.each(function ([a, b]) { const inStep = layerOf[a] <= step && layerOf[b] <= step; const inSel = selected ? selected.has(a) && selected.has(b) : true; gsap.to(this, { opacity: inStep ? (inSel ? 0.9 : 0.1) : 0.05, stroke: selected && inSel ? 'var(--accent)' : 'var(--line-strong)', duration: dur(0.4) }); });
    };
    return {
      init(ch) {
        boardEl = board(ch); tip = ch.querySelector('#dagTip'); svg = svgIn(boardEl, 1000, 530); defsArrow(svg, 'dagArrow');
        edges = svg.append('g').selectAll('path').data(E).join('path').attr('class', 'edge').attr('marker-end', 'url(#dagArrow)').attr('d', ([a, b]) => { const A = byId[a], B = byId[b]; const dy = B.y - A.y; return `M${A.x},${A.y + 16} C${A.x},${A.y + dy / 2} ${B.x},${B.y - dy / 2} ${B.x},${B.y - 18}`; });
        nodes = svg.append('g').selectAll('g').data(N).join('g').attr('transform', (d) => `translate(${d.x},${d.y})`).style('cursor', 'pointer');
        nodes.append('rect').attr('x', -62).attr('y', -16).attr('width', 124).attr('height', 32).attr('rx', 8).attr('class', (d) => `node-box${d.id === 'git-cas' ? ' accent' : ''}`).attr('stroke-dasharray', (d) => (d.priv ? '4 3' : null));
        nodes.append('text').attr('class', 'small strong').attr('text-anchor', 'middle').attr('y', -1).text((d) => (d.id === 'git-cas' ? '@git-stunts/git-cas' : `git-cas-${d.id}`));
        badges = nodes.append('text').attr('class', 'small badge').attr('text-anchor', 'middle').attr('y', 11).attr('fill', 'var(--accent-text)').text((d) => (d.priv ? 'private' : '6.5.10'));
        nodes.on('pointerenter', (ev, d) => { tip.innerHTML = `<b>${d.id === 'git-cas' ? '@git-stunts/git-cas' : `@git-stunts/git-cas-${d.id}`}</b>${d.what}<br><span class="faint">${d.lines ? `≈ ${d.lines.toLocaleString()} lines` : 'new package'} · depends on ${E.filter(([a]) => a === d.id).map(([, b]) => b).join(', ') || 'nothing in the workspace'}</span>`; tip.classList.add('is-visible'); })
          .on('pointermove', (ev) => { const r = boardEl.getBoundingClientRect(); tip.style.left = `${Math.min(ev.clientX - r.left + 14, r.width - tip.offsetWidth - 8)}px`; tip.style.top = `${Math.min(ev.clientY - r.top + 14, r.height - tip.offsetHeight - 8)}px`; })
          .on('pointerleave', () => tip.classList.remove('is-visible'))
          .on('click', (ev, d) => { selected = selected && selected.has(d.id) && selected.size === closure(d.id).size ? null : closure(d.id); paint(); });
        ch.querySelectorAll('[data-closure]').forEach((b) => b.addEventListener('click', () => { selected = b.dataset.closure ? closure(b.dataset.closure) : null; paint(); }));
        paint();
      },
      setStep(i) {
        step = i; paint();
        if (i === 3) { badges.filter((d) => !d.priv).each(function (d, j) { gsap.delayedCall(dur(0.08 * j), () => { this.textContent = '7.0.0'; gsap.fromTo(this, { scale: 1.4, transformOrigin: '50% 50%' }, { scale: 1, duration: dur(0.4) }); }); }); }
        else badges.filter((d) => !d.priv).text('6.5.10');
      },
    };
  })();

  /* ---------------------------------------------------------- roadmap */
  D.roadmap = {
    init(svgEl) {
      const svg = d3.select(svgEl); defsArrow(svg, 'rmArrow');
      const stops = [
        { v: 'v6.5.11', t: 'Recovery', items: ['#131 Plumbing ≥ 3.3.2', 'closed-pipe mktree retry', 'ships from today’s layout'], soon: true },
        { v: 'v7.0.0', t: 'Workspace', items: ['slices 0–10', '#107 cockpit split', '#79 worktree bootstrap'], major: true },
        { v: 'v7.1.0', t: 'Operator', items: ['#39 Operator TUI', '#108 theme family', '#40 agent parity · MCP GA'] },
        { v: 'v7.2.0', t: 'Derive', items: ['#86 bundles.derive()', '#98 one-shot fallback', 'GitHub Action · sneakernet'] },
        { v: 'v7.3.0', t: 'Edge', items: ['#41 browser read path', 'git-cas-web', 'lazy chunk fetch'] },
        { v: 'v8.0.0', t: 'Conditional', items: ['#42 protocol audit', 'only with evidence'], dashed: true },
      ];
      const x = d3.scaleLinear().domain([0, stops.length - 1]).range([80, 880]);
      svg.append('line').attr('x1', 60).attr('x2', 920).attr('y1', 90).attr('y2', 90).attr('class', 'edge').attr('marker-end', 'url(#rmArrow)');
      const g = svg.append('g').selectAll('g').data(stops).join('g').attr('class', 'rm-stop').attr('transform', (d, i) => `translate(${x(i)},90)`);
      g.append('circle').attr('r', (d) => (d.major ? 12 : 8)).attr('fill', (d) => (d.major ? 'var(--accent)' : 'var(--surface-raised)')).attr('stroke', (d) => (d.dashed ? 'var(--ink-faint)' : 'var(--accent)')).attr('stroke-width', 2).attr('stroke-dasharray', (d) => (d.dashed ? '3 3' : null));
      g.append('text').attr('class', 'strong').attr('text-anchor', 'middle').attr('y', -42).style('font-size', '14px').text((d) => d.v);
      g.append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', -26).attr('fill', 'var(--accent-text)').text((d) => d.t);
      g.each(function (d) { d.items.forEach((it, j) => d3.select(this).append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 34 + j * 16).text(it)); });
      g.filter((d) => d.soon).append('text').attr('class', 'small').attr('text-anchor', 'middle').attr('y', 100).attr('fill', 'var(--warn)').text('blocked on upstream publish');
    },
  };

  window.Diagrams = D;
})();
