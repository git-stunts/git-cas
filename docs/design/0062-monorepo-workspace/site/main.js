/* global gsap, ScrollTrigger, ScrollSmoother, Diagrams */
/* =====================================================================
   git-cas explainer — theme state, smooth scroll, scroll-driven lesson
   ===================================================================== */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  const dur = (s) => (reduce ? 0 : s);

  /* ---- theme: family × mode ---------------------------------------- */
  // Chip colors mirror theme.css (dark surface, light surface, dark accent).
  const FAMILIES = [
    ['slate', '#252c2c', '#fcf4eb', '#6b8f9c'], ['ember', '#2a1830', '#fdf3e2', '#ea954d'],
    ['moss', '#262b25', '#e6e8c9', '#acc28c'], ['plum', '#2d2430', '#f7eef6', '#ce97cf'],
    ['ice', '#1a2021', '#f4f9f9', '#8fc0c6'], ['honey', '#2b2321', '#f5f1d2', '#f5db5c'],
    ['clay', '#2a211f', '#fbe7d8', '#ee8a5f'], ['neon', '#070a2e', '#eef4ff', '#85ecfe'],
  ];
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
  const applyMode = (mode) => { if (mode === 'light' || mode === 'dark') root.dataset.theme = mode; else delete root.dataset.theme; store.set('gitcas.mode', mode); };
  const applyScheme = (name) => { if (name === 'slate') delete root.dataset.scheme; else root.dataset.scheme = name; store.set('gitcas.scheme', name); document.querySelectorAll('.family').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scheme === name))); };
  const famWrap = document.getElementById('families');
  FAMILIES.forEach(([name, dark, light, accent]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'family'; b.dataset.scheme = name; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="chip" style="--chip-dark:${dark};--chip-light:${light};--chip-accent:${accent}" aria-hidden="true"></span>${name}`;
    b.addEventListener('click', () => applyScheme(name));
    famWrap.appendChild(b);
  });
  const savedMode = store.get('gitcas.mode') || (root.dataset.theme === 'light' || root.dataset.theme === 'dark' ? root.dataset.theme : 'system');
  document.querySelectorAll('input[name="mode"]').forEach((r) => { r.checked = r.value === savedMode; r.addEventListener('change', () => applyMode(r.value)); });
  applyMode(savedMode);
  applyScheme(store.get('gitcas.scheme') || 'slate');
  const panel = document.getElementById('themePanel'), toggle = document.getElementById('themeToggle');
  const setPanel = (open) => { panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', () => setPanel(panel.hidden));
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target)) setPanel(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { setPanel(false); toggle.focus(); } });

  /* ---- GSAP setup --------------------------------------------------- */
  gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
  gsap.defaults({ ease: 'power2.out', duration: dur(0.6) });
  let smoother = null;
  if (!reduce) smoother = ScrollSmoother.create({ wrapper: '#smooth-wrapper', content: '#smooth-content', smooth: 1.1, effects: false, smoothTouch: 0.1 });
  const topbarH = () => document.querySelector('.topbar').offsetHeight;

  /* ---- hero ---------------------------------------------------------- */
  const heroChunks = document.getElementById('heroChunks');
  const chunkRects = [];
  for (let i = 0; i < 24; i++) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const col = i % 6, row = Math.floor(i / 6);
    r.setAttribute('x', 58 + col * 28); r.setAttribute('y', 160 + row * 36); r.setAttribute('width', 22); r.setAttribute('height', 28); r.setAttribute('rx', 4);
    r.style.fill = `oklch(var(--viz-l) var(--viz-c) ${(i * 47) % 360})`; r.setAttribute('stroke', 'var(--surface)');
    heroChunks.appendChild(r); chunkRects.push(r);
  }
  const heroTl = gsap.timeline({ defaults: { ease: 'power3.inOut' } });
  heroTl.from('.ha-file', { opacity: 0, x: -20, duration: dur(0.8) })
    .from(chunkRects, { opacity: 0, scale: 0.5, transformOrigin: '50% 50%', stagger: dur(0.02), duration: dur(0.4) }, '-=0.3')
    .from('.ha-vault', { opacity: 0, x: 20, duration: dur(0.8) }, '<')
    .to(chunkRects, { x: 342, y: (i) => -10 + Math.floor(i / 6) * 4, duration: dur(1.1), stagger: { each: dur(0.05), from: 'random' } }, '+=0.3')
    .to(chunkRects.filter((_, i) => i % 7 === 0), { opacity: 0.25, duration: dur(0.6) }, '-=0.2')
    .to(chunkRects.filter((_, i) => i % 7 === 0), { opacity: 1, duration: dur(0.6) }, '+=0.6');
  if (!reduce) gsap.to('#scrollDot', { y: 7, repeat: -1, yoyo: true, duration: 0.9, ease: 'sine.inOut' });

  /* ---- rail + progress ---------------------------------------------- */
  const rail = document.getElementById('rail');
  const chapters = [...document.querySelectorAll('.chapter[data-label]')];
  chapters.forEach((ch) => {
    const a = document.createElement('a'); a.href = `#${ch.id}`; a.dataset.label = ch.dataset.label; a.setAttribute('aria-label', ch.dataset.label);
    a.addEventListener('click', (e) => { e.preventDefault(); if (smoother) smoother.scrollTo(ch, true, `top ${topbarH() + 12}px`); else ch.scrollIntoView({ behavior: 'smooth' }); });
    rail.appendChild(a);
    ScrollTrigger.create({ trigger: ch, start: 'top 50%', end: 'bottom 50%', onToggle: (self) => a.classList.toggle('is-active', self.isActive) });
  });
  gsap.to('#progressBar', { width: '100%', ease: 'none', scrollTrigger: { trigger: '#smooth-content', start: 'top top', end: 'bottom bottom', scrub: 0.3 } });

  /* ---- diagrams + scrollytelling ------------------------------------ */
  document.querySelectorAll('.chapter[data-diagram]').forEach((ch) => {
    const diagram = Diagrams[ch.dataset.diagram];
    if (!diagram) return;
    diagram.init(ch);
    const steps = [...ch.querySelectorAll('.step')];
    let current = -1;
    const activate = (i) => { if (i === current) return; current = i; steps.forEach((s, j) => s.classList.toggle('is-active', j === i)); diagram.setStep(i); };
    steps.forEach((s, i) => ScrollTrigger.create({ trigger: s, start: 'top 62%', end: 'bottom 38%', onEnter: () => activate(i), onEnterBack: () => activate(i) }));
    activate(0);
    const stage = ch.querySelector('.stage'), scrolly = ch.querySelector('.scrolly');
    if (stage) ScrollTrigger.create({ trigger: scrolly, start: () => `top ${topbarH() + 16}px`, end: () => `bottom ${stage.offsetHeight + topbarH() + 16}px`, pin: stage, pinSpacing: false, invalidateOnRefresh: true });
  });

  /* ---- orient strip, slices, roadmap, verify, ideas ------------------ */
  gsap.from('#orientStrip .os-item', { opacity: 0, y: 14, stagger: dur(0.12), scrollTrigger: { trigger: '#orientStrip', start: 'top 80%' } });

  const stepper = document.getElementById('stepper');
  gsap.to(stepper.querySelector('.line-fill'), { height: () => `${stepper.offsetHeight - 32}px`, ease: 'none', scrollTrigger: { trigger: stepper, start: 'top 60%', end: 'bottom 60%', scrub: 0.4, invalidateOnRefresh: true } });
  stepper.querySelectorAll('.slice').forEach((s) => ScrollTrigger.create({ trigger: s, start: 'top 60%', onEnter: () => s.classList.add('is-lit'), onLeaveBack: () => s.classList.remove('is-lit') }));

  Diagrams.roadmap.init(document.getElementById('d-roadmap'));
  gsap.from('#d-roadmap .rm-stop', { opacity: 0, y: 10, stagger: dur(0.15), scrollTrigger: { trigger: '#d-roadmap', start: 'top 75%' } });

  const cells = [...document.querySelectorAll('#verifyMatrix .cell')];
  ScrollTrigger.create({ trigger: '#verifyMatrix', start: 'top 70%', onEnter: () => cells.forEach((c, i) => gsap.delayedCall(dur(0.08 * i), () => { c.classList.remove('is-pending'); c.classList.add('is-green'); c.lastElementChild.textContent = c.firstElementChild.textContent === '—' ? 'n/a' : 'pass'; })) });
  document.querySelectorAll('#redTests li').forEach((li, i) => ScrollTrigger.create({ trigger: li, start: 'top 75%', onEnter: () => gsap.delayedCall(dur(0.1 * i), () => li.classList.add('done')) }));
  gsap.from('.idea', { opacity: 0, y: 18, stagger: dur(0.06), scrollTrigger: { trigger: '.ideas', start: 'top 80%' } });
  gsap.from('.compare .code-block', { opacity: 0, y: 12, stagger: dur(0.15), scrollTrigger: { trigger: '.compare', start: 'top 80%' } });

  /* ---- refresh when fonts and layout settle -------------------------- */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
  window.addEventListener('load', () => ScrollTrigger.refresh());
})();
