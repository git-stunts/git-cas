/* global gsap, ScrollTrigger, ScrollSmoother, SplitText, DrawSVGPlugin, MotionPathPlugin, ScrambleTextPlugin, d3, Scenes */
/* =====================================================================
   git-cas explainer — orchestration
   Theme state · smooth scroll · full-viewport scene manager · split-text
   headings · HUD. Every scene is a top-level animation; ScrollTriggers
   live only on top-level tweens and timelines.
   ===================================================================== */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  const dur = (s) => (reduce ? 0 : s);

  /* ---- theme: family × mode ---------------------------------------- */
  const FAMILIES = [
    ['slate', '#252c2c', '#fcf4eb', '#6b8f9c'], ['ember', '#2a1830', '#fdf3e2', '#ea954d'],
    ['moss', '#262b25', '#e6e8c9', '#acc28c'], ['plum', '#2d2430', '#f7eef6', '#ce97cf'],
    ['ice', '#1a2021', '#f4f9f9', '#8fc0c6'], ['honey', '#2b2321', '#f5f1d2', '#f5db5c'],
    ['clay', '#2a211f', '#fbe7d8', '#ee8a5f'], ['neon', '#070a2e', '#eef4ff', '#85ecfe'],
  ];
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* unavailable */ } } };
  const applyMode = (mode) => { if (mode === 'light' || mode === 'dark') root.dataset.theme = mode; else delete root.dataset.theme; store.set('gitcas.mode', mode); };
  const applyScheme = (name) => { if (name === 'slate') delete root.dataset.scheme; else root.dataset.scheme = name; store.set('gitcas.scheme', name); document.querySelectorAll('.family').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scheme === name))); };
  const famWrap = document.getElementById('families');
  FAMILIES.forEach(([name, dark, light, accent]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'family'; b.dataset.scheme = name; b.setAttribute('aria-pressed', 'false'); b.innerHTML = `<span class="chip" style="--chip-dark:${dark};--chip-light:${light};--chip-accent:${accent}" aria-hidden="true"></span>${name}`; b.addEventListener('click', () => applyScheme(name)); famWrap.appendChild(b); });
  const savedMode = store.get('gitcas.mode') || (root.dataset.theme === 'light' || root.dataset.theme === 'dark' ? root.dataset.theme : 'system');
  document.querySelectorAll('input[name="mode"]').forEach((r) => { r.checked = r.value === savedMode; r.addEventListener('change', () => applyMode(r.value)); });
  applyMode(savedMode); applyScheme(store.get('gitcas.scheme') || 'slate');
  const panel = document.getElementById('themePanel'), toggle = document.getElementById('themeToggle');
  const setPanel = (open) => { panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', () => setPanel(panel.hidden));
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target)) setPanel(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { setPanel(false); toggle.focus(); } });

  /* ---- GSAP ----------------------------------------------------------- */
  const plugins = [ScrollTrigger, ScrollSmoother, SplitText, DrawSVGPlugin, MotionPathPlugin];
  if (window.ScrambleTextPlugin) plugins.push(ScrambleTextPlugin);
  gsap.registerPlugin(...plugins);
  gsap.defaults({ ease: 'power2.out', duration: dur(0.6) });
  let smoother = null;
  if (!reduce) smoother = ScrollSmoother.create({ wrapper: '#smooth-wrapper', content: '#smooth-content', smooth: 1.2, effects: false, smoothTouch: 0.1 });
  const topbarH = () => document.querySelector('.topbar').offsetHeight;

  /* ---- hero (SVG fallback art; hidden when the WebGPU vault is on) --- */
  const heroChunks = document.getElementById('heroChunks'); const chunkRects = [];
  for (let i = 0; i < 24; i++) { const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); const col = i % 6, row = Math.floor(i / 6); r.setAttribute('x', 58 + col * 28); r.setAttribute('y', 160 + row * 36); r.setAttribute('width', 22); r.setAttribute('height', 28); r.setAttribute('rx', 4); r.style.fill = `oklch(var(--viz-l) var(--viz-c) ${(i * 47) % 360})`; r.setAttribute('stroke', 'var(--surface)'); heroChunks.appendChild(r); chunkRects.push(r); }
  gsap.timeline({ defaults: { ease: 'power3.inOut' } })
    .from('.ha-file', { autoAlpha: 0, x: -20, duration: dur(0.8) })
    .from(chunkRects, { autoAlpha: 0, scale: 0.5, transformOrigin: '50% 50%', stagger: dur(0.02), duration: dur(0.4) }, '-=0.3')
    .from('.ha-vault', { autoAlpha: 0, x: 20, duration: dur(0.8) }, '<')
    .to(chunkRects, { x: 342, y: (i) => -10 + Math.floor(i / 6) * 4, duration: dur(1.1), stagger: { each: dur(0.05), from: 'random' } }, '+=0.3');
  if (!reduce) gsap.to('#scrollDot', { y: 7, repeat: -1, yoyo: true, duration: 0.9, ease: 'sine.inOut' });

  /* ---- type: split headings ------------------------------------------ */
  const splitAll = () => {
    const h1 = document.querySelector('.hero h1');
    SplitText.create(h1, { type: 'words', onSplit(self) { return gsap.from(self.words, { yPercent: 60, autoAlpha: 0, rotateX: -40, transformOrigin: '50% 100%', stagger: dur(0.08), duration: dur(1.1), ease: 'expo.out', delay: dur(0.15) }); } });
    document.querySelectorAll('.chapter-head h2').forEach((h2) => {
      SplitText.create(h2, { type: 'words,chars', mask: 'chars', onSplit(self) { return gsap.from(self.chars, { yPercent: 110, stagger: { each: dur(0.012), from: 'start' }, duration: dur(0.7), ease: 'power3.out', scrollTrigger: { trigger: h2, start: 'top 85%', toggleActions: 'play none none reverse' } }); } });
    });
    document.querySelectorAll('.chapter-head .lede').forEach((p) => {
      SplitText.create(p, { type: 'lines', mask: 'lines', autoSplit: true, onSplit(self) { return gsap.from(self.lines, { yPercent: 100, autoAlpha: 0, stagger: dur(0.07), duration: dur(0.8), ease: 'power3.out', scrollTrigger: { trigger: p, start: 'top 88%', toggleActions: 'play none none reverse' } }); } });
    });
    if (window.ScrambleTextPlugin) document.querySelectorAll('.chapter-head .eyebrow').forEach((e) => { const text = e.textContent; gsap.from(e, { duration: dur(1.1), scrambleText: { text, chars: '0123456789abcdef', speed: 0.6 }, scrollTrigger: { trigger: e, start: 'top 90%', toggleActions: 'play none none none' } }); });
  };

  /* ---- rail + progress ----------------------------------------------- */
  const rail = document.getElementById('rail');
  const chapters = [...document.querySelectorAll('.chapter[data-label]')];
  chapters.forEach((ch) => {
    const a = document.createElement('a'); a.href = `#${ch.id}`; a.dataset.label = ch.dataset.label; a.setAttribute('aria-label', ch.dataset.label);
    a.addEventListener('click', (e) => { e.preventDefault(); if (smoother) smoother.scrollTo(ch, true, `top ${topbarH() + 12}px`); else ch.scrollIntoView({ behavior: 'smooth' }); });
    rail.appendChild(a);
    ScrollTrigger.create({ trigger: ch, start: 'top 50%', end: 'bottom 50%', onToggle: (self) => a.classList.toggle('is-active', self.isActive) });
  });
  gsap.to('#progressBar', { width: '100%', ease: 'none', scrollTrigger: { trigger: '#smooth-content', start: 'top top', end: 'bottom bottom', scrub: 0.3 } });

  /* ---- scene manager --------------------------------------------------- */
  const back = d3.select('#stage'), front = d3.select('#stageFront');
  const hudCaption = document.getElementById('hudCaption'), hudReadout = document.getElementById('hudReadout');
  const panes = [...document.querySelectorAll('.hud-pane')];
  let activeScene = null;
  const setHud = (name) => {
    document.getElementById('hud').dataset.scene = name || '';
    panes.forEach((p) => { const on = p.dataset.for === name; gsap.to(p, { autoAlpha: on ? 1 : 0, y: on ? 0 : 24, duration: dur(0.5), overwrite: 'auto' }); p.style.pointerEvents = on ? 'auto' : 'none'; });
    gsap.to([hudCaption, hudReadout], { autoAlpha: name ? 1 : 0, duration: dur(0.4), overwrite: 'auto' });
    if (!name) hudReadout.innerHTML = '';
  };
  // soft parallax for the back layer, so depth reads while scrolling
  if (!reduce) gsap.to('#stage', { yPercent: -3, ease: 'none', scrollTrigger: { trigger: '#smooth-content', start: 'top top', end: 'bottom bottom', scrub: 1.2 } });

  document.querySelectorAll('.chapter[data-scene]').forEach((ch) => {
    const name = ch.dataset.scene, scene = Scenes[name];
    if (!scene) return;
    const gBack = back.append('g').attr('class', `scene scene-${name}`).attr('opacity', 0).style('visibility', 'hidden');
    const gFront = front.append('g').attr('class', `scene scene-${name}`).attr('opacity', 0).style('visibility', 'hidden');
    scene.init({ back: gBack, front: gFront });
    const steps = [...ch.querySelectorAll('.step')];
    let current = -1;
    const activate = (i) => { if (i === current) return; current = i; steps.forEach((s, j) => s.classList.toggle('is-active', j === i)); scene.setStep(i); const h = steps[i].querySelector('h3'); if (h && h._split) gsap.fromTo(h._split.chars, { yPercent: 100 }, { yPercent: 0, stagger: dur(0.015), duration: dur(0.5), ease: 'power3.out', overwrite: true }); };
    steps.forEach((s, i) => { const h = s.querySelector('h3'); if (h) h._split = SplitText.create(h, { type: 'words,chars', mask: 'chars' }); ScrollTrigger.create({ trigger: s, start: 'top 62%', end: 'bottom 38%', onEnter: () => activate(i), onEnterBack: () => activate(i) }); });
    ScrollTrigger.create({
      trigger: ch, start: 'top 60%', end: 'bottom 40%',
      onToggle: (self) => {
        const on = self.isActive;
        gsap.to([gBack.node(), gFront.node()], { autoAlpha: on ? 1 : 0, duration: dur(0.6), overwrite: 'auto' });
        gsap.fromTo([gBack.node(), gFront.node()], { scale: on ? 0.96 : 1 }, { scale: on ? 1 : 1.04, transformOrigin: '70% 50%', duration: dur(0.8), ease: 'power2.out', overwrite: 'auto' });
        if (on) { activeScene = name; setHud(name); if (current < 0) activate(0); else scene.setStep(current); }
        else if (activeScene === name) { activeScene = null; setHud(null); }
      },
    });
  });

  /* ---- chapters without a scene ---------------------------------------- */
  gsap.from('#orientStrip .os-item', { autoAlpha: 0, y: 14, stagger: dur(0.12), scrollTrigger: { trigger: '#orientStrip', start: 'top 80%' } });
  gsap.from('#orientStrip line', { drawSVG: '0% 0%', stagger: dur(0.1), duration: dur(0.6), scrollTrigger: { trigger: '#orientStrip', start: 'top 80%' } });

  const stepper = document.getElementById('stepper');
  gsap.to(stepper.querySelector('.line-fill'), { height: () => `${stepper.offsetHeight - 32}px`, ease: 'none', scrollTrigger: { trigger: stepper, start: 'top 60%', end: 'bottom 60%', scrub: 0.4, invalidateOnRefresh: true } });
  stepper.querySelectorAll('.slice').forEach((s) => ScrollTrigger.create({ trigger: s, start: 'top 60%', onEnter: () => s.classList.add('is-lit'), onLeaveBack: () => s.classList.remove('is-lit') }));

  Scenes.roadmap.init(document.getElementById('d-roadmap'));
  gsap.from(Scenes.roadmap.rail.node(), { drawSVG: '0% 0%', duration: dur(1.4), ease: 'power2.inOut', scrollTrigger: { trigger: '#d-roadmap', start: 'top 75%' } });
  gsap.from(Scenes.roadmap.stops.nodes(), { autoAlpha: 0, y: 10, scale: 0.7, transformOrigin: '50% 50%', stagger: dur(0.18), scrollTrigger: { trigger: '#d-roadmap', start: 'top 75%' } });

  const cells = [...document.querySelectorAll('#verifyMatrix .cell')];
  ScrollTrigger.create({ trigger: '#verifyMatrix', start: 'top 70%', onEnter: () => cells.forEach((c, i) => gsap.delayedCall(dur(0.08 * i), () => { c.classList.remove('is-pending'); c.classList.add('is-green'); c.lastElementChild.textContent = c.firstElementChild.textContent === '—' ? 'n/a' : 'pass'; })) });
  document.querySelectorAll('#redTests li').forEach((li, i) => ScrollTrigger.create({ trigger: li, start: 'top 75%', onEnter: () => gsap.delayedCall(dur(0.1 * i), () => li.classList.add('done')) }));
  gsap.from('.idea', { autoAlpha: 0, y: 18, stagger: dur(0.06), scrollTrigger: { trigger: '.ideas', start: 'top 80%' } });
  gsap.from('.compare .code-block', { autoAlpha: 0, y: 12, stagger: dur(0.15), scrollTrigger: { trigger: '.compare', start: 'top 80%' } });

  /* ---- settle ------------------------------------------------------------ */
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(() => { splitAll(); ScrollTrigger.refresh(); });
  window.addEventListener('load', () => ScrollTrigger.refresh());
})();
