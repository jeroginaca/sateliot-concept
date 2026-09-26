import '@fontsource-variable/space-grotesk';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import * as THREE from 'three';
import { CONFIG, constellationPresets } from './config.js';
import { i18n } from './i18n.js';
import { HUD } from './hud.js';
import { Ambient } from './audio.js';
import { siteWindows, deliveryEstimate } from './orbit.js';

const F = CONFIG.facts;
const MODEL = CONFIG.model;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = reducedMQ.matches;
let quality = 1; // render-resolution multiplier, managed by govern()
const low =
  matchMedia('(max-width: 820px)').matches ||
  (navigator.hardwareConcurrency || 8) <= 4 ||
  (navigator.deviceMemory || 8) <= 4;

// ---------------------------------------------------------------------------
// State. `passTime` is the master value for the pass chapter.
const state = {
  passTime: 0,
  sats: F.satellitesLaunched,
  active: null,
  time: 0,
};

// Chapters, in order. `scene` picks the 3D scene; `mode` tells it what to show.
const chapters = [
  { id: 'hero', scene: 'valley', mode: 'hero' },
  { id: 'gap', scene: 'globe', mode: 'gap' },
  { id: 'chip', scene: 'collar', mode: 'chip' },
  { id: 'pass', scene: 'valley', mode: 'pass' },
  { id: 'relay', scene: 'globe', mode: 'relay' },
  { id: 'constellation', scene: 'globe', mode: 'constellation' },
  { id: 'scale', scene: 'globe', mode: 'scale' },
  { id: 'faq', scene: null },
  { id: 'contact', scene: 'valley', mode: 'final' },
];
chapters.forEach((c, i) => {
  c.el = document.getElementById(c.id);
  c.index = i + 1;
  c.p = 0;
  c.beats = $$('.beat, .step', c.el).map((el) => ({ el, from: +el.dataset.from, to: +el.dataset.to, on: false }));
});

// ---------------------------------------------------------------------------
// Formatting helpers
const nf = (n, opts) => new Intl.NumberFormat(i18n.locale(), opts).format(n);
function fmtDur(min) {
  if (min < 1) return '< 1 min';
  const total = Math.round(min);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60), m = total % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}
const fmtClock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const fmtLatLon = ({ lat, lon }) =>
  `${Math.abs(lat).toFixed(1)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(1)}°${lon < 0 ? 'W' : 'E'}`;

// ---------------------------------------------------------------------------
// HUD: one component, rows declared per chapter.
const hud = new HUD($('#hud'));
const DEVICE = 'COLLAR-01';
const hudSpecs = {
  hero: [
    { id: 'device', label: 'hud.device', value: DEVICE },
    { id: 'cell', label: 'hud.cell', value: { key: 'hud.none' }, tone: 'warn' },
    { id: 'led', label: 'hud.led', value: { key: 'hud.heartbeat' } },
    { id: 'pos', label: 'hud.pos', value: fmtLatLon(MODEL.site) },
  ],
  gap: [
    { id: 'view', label: 'hud.view', value: { key: 'hud.global' } },
    { id: 'ocean', label: 'hud.ocean', value: `≈${F.oceanSharePct}%` },
    { id: 'collar', label: 'hud.collar', value: { key: 'hud.none' }, tone: 'warn' },
  ],
  chip: [
    { id: 'modem', label: 'hud.modem', value: `${F.technology}`, tone: 'ok' },
    { id: 'spec', label: 'hud.spec', value: F.standard.replace('Release ', 'Rel-') },
    { id: 'sim', label: 'hud.sim', value: { key: 'hud.standard' }, tone: 'ok' },
    { id: 'extra', label: 'hud.extra', value: { key: 'hud.none' }, tone: 'ok' },
  ],
  pass: [
    { id: 'elev', label: 'hud.elev' },
    { id: 'link', label: 'hud.link' },
    { id: 'buffered', label: 'hud.buffered' },
    { id: 'onboard', label: 'hud.onboard' },
    { id: 'clock', label: 'hud.clock' },
  ],
  relay: [
    { id: 'msg', label: 'hud.msg', value: `${DEVICE} · #0001` },
    { id: 'state', label: 'hud.state' },
    { id: 'mode', label: 'hud.mode', value: { key: 'hud.snf' } },
  ],
  constellation: [
    { id: 'sats', label: 'hud.sats' },
    { id: 'passes', label: 'hud.passes' },
    { id: 'longest', label: 'hud.longest' },
    { id: 'model', label: 'hud.model', value: { key: 'hud.illustrative' }, tone: 'warn' },
  ],
  scale: [
    { id: 'founded', label: 'hud.founded', value: String(F.founded) },
    { id: 'hq', label: 'hud.hq', value: F.headquarters },
    { id: 'launched', label: 'hud.launched', value: String(F.satellitesLaunched) },
  ],
  faq: [
    { id: 'est', label: 'hud.estimator', value: { key: 'hud.illustrative' }, tone: 'warn' },
    { id: 'sats', label: 'hud.sats' },
  ],
  contact: [
    { id: 'device', label: 'hud.device', value: DEVICE },
    { id: 'link', label: 'hud.link' },
    { id: 'pos', label: 'hud.pos', value: fmtLatLon(MODEL.site) },
  ],
};

// ---------------------------------------------------------------------------
// Rail navigation
const railList = $('.rail ol');
for (const c of chapters) {
  const li = document.createElement('li');
  li.innerHTML = `<a href="#${c.id}"><i></i><span data-i18n="nav.${c.id}"></span></a>`;
  railList.append(li);
  c.railLink = li.firstChild;
}

// ---------------------------------------------------------------------------
// Controls: language + sound
const ambient = new Ambient();
const langBtn = $('#lang');
const soundBtn = $('#sound');
function syncControls() {
  langBtn.textContent = i18n.lang === 'en' ? 'ES' : 'EN';
  const on = ambient.enabled;
  soundBtn.setAttribute('aria-pressed', String(on));
  const span = $('span', soundBtn);
  span.dataset.i18n = on ? 'ui.sound.on' : 'ui.sound.off';
  span.textContent = i18n.t(span.dataset.i18n);
}
langBtn.addEventListener('click', () => i18n.set(i18n.lang === 'en' ? 'es' : 'en'));
soundBtn.addEventListener('click', async () => { await ambient.toggle(); syncControls(); });

// ---------------------------------------------------------------------------
// Constellation slider (chapter 6)
const satsInput = $('#sats');
satsInput.min = CONFIG.model.slider.min;
satsInput.max = CONFIG.model.slider.max;
satsInput.value = state.sats;
const presets = constellationPresets();

function drawWindows(svg, windows, extra = '') {
  const bars = windows
    .map(([s, e]) => `<rect x="${s.toFixed(1)}" y="8" width="${Math.max(3, e - s).toFixed(1)}" height="${svg.id === 'calc-timeline' ? 22 : 28}" rx="1.5" fill="#6ff2c2" fill-opacity="0.65"/>`)
    .join('');
  const ticks = [360, 720, 1080].map((x) => `<line x1="${x}" x2="${x}" y1="0" y2="60" stroke="rgba(200,220,255,.14)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('');
  svg.innerHTML = ticks + bars + extra;
}

function updateConstellation() {
  const n = +satsInput.value;
  state.sats = n;
  const w = siteWindows(n);
  $('#sats-out').textContent = n >= F.roadmapSatellites ? `${n}+` : n;
  satsInput.style.setProperty('--fill', `${((n - satsInput.min) / (satsInput.max - satsInput.min)) * 100}%`);
  $('#const-passes').textContent = w.passes;
  $('#const-gap').textContent = fmtDur(w.longestGap);
  const svg = $('#const-timeline');
  drawWindows(svg, w.windows);
  svg.setAttribute('aria-label', `${w.passes} ${i18n.t('const.passes')}, ${i18n.t('const.gap')}: ${fmtDur(w.longestGap)}`);
  $$('#constellation .preset').forEach((b) => {
    const p = presets.find((x) => x.id === b.dataset.preset);
    b.setAttribute('aria-pressed', String(p.sats === n));
  });
}
satsInput.addEventListener('input', updateConstellation);
$$('#constellation .preset').forEach((b) =>
  b.addEventListener('click', () => {
    satsInput.value = presets.find((x) => x.id === b.dataset.preset).sats;
    updateConstellation();
  })
);

// ---------------------------------------------------------------------------
// Scale counters (chapter 7)
const counterDefs = [
  { value: F.satellitesLaunched, label: 'scale.launched' },
  { value: F.satellitesPlanned, label: 'scale.planned', prefix: '+' },
  { value: F.roadmapSatellites, label: 'scale.roadmap', plus: true },
  { value: F.messagesPerDay, label: 'scale.msgs', plus: true, wide: true },
  { value: F.clients, label: 'scale.clients', plus: true },
  { value: F.countries, label: 'scale.countries' },
  { text: String(F.founded), label: 'scale.founded' },
  { text: String(F.firstSatellitesYear), label: 'scale.first', span2: true },
  { text: F.fullConstellationTarget, label: 'scale.full' },
];
const countersEl = $('#counters');
countersEl.innerHTML = counterDefs
  .map((c, i) => `<li class="${c.wide ? 'wide' : c.span2 ? 'span2' : ''}"><strong data-counter="${i}">0</strong><span data-i18n="${c.label}"></span></li>`)
  .join('');
const counterEls = $$('[data-counter]', countersEl);
let countersStarted = false;
let counterT0 = 0;
function renderCounters(t) {
  counterDefs.forEach((c, i) => {
    let text;
    if (c.text) text = c.text;
    else {
      const e = 1 - Math.pow(1 - clamp(t), 3);
      text = (c.prefix || '') + nf(Math.round(c.value * e)) + (c.plus ? '+' : '');
    }
    counterEls[i].textContent = text;
  });
}
renderCounters(0);

// ---------------------------------------------------------------------------
// FAQ accordion + estimator (chapter 8)
const faqCount = 6;
$('#accordion').innerHTML = Array.from({ length: faqCount }, (_, i) => `
  <details${i === 0 ? ' open' : ''}>
    <summary><span><span class="qn">Q${String(i + 1).padStart(2, '0')}</span><span data-i18n="faq.q${i + 1}"></span></span><span class="pm" aria-hidden="true"></span></summary>
    <p class="answer" data-i18n="faq.a${i + 1}"></p>
  </details>`).join('');

const calc = { msgs: MODEL.calculator.defaultMessages, sats: F.satellitesLaunched };
const calcMsgs = $('#calc-msgs');
calcMsgs.min = MODEL.calculator.minMessages;
calcMsgs.max = MODEL.calculator.maxMessages;
calcMsgs.value = calc.msgs;
const calcSize = $('#calc-size');
calcSize.innerHTML = presets
  .map((p) => `<button type="button" class="preset" role="radio" data-sats="${p.sats}" data-i18n="const.${p.id}"></button>`)
  .join('');
let calcQueued = false;
function updateCalc() {
  calcQueued = false;
  calc.msgs = +calcMsgs.value;
  $('#calc-msgs-out').textContent = calc.msgs;
  calcMsgs.style.setProperty('--fill', `${((calc.msgs - calcMsgs.min) / (calcMsgs.max - calcMsgs.min)) * 100}%`);
  $$('button', calcSize).forEach((b) => {
    const on = +b.dataset.sats === calc.sats;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const w = siteWindows(calc.sats);
  const d = deliveryEstimate(calc.sats, calc.msgs);
  $('#calc-passes').textContent = w.passes;
  $('#calc-windows').textContent = d.deliveryWindows;
  $('#calc-median').textContent = fmtDur(d.median);
  $('#calc-p90').textContent = fmtDur(d.p90);
  const marks = d.msgs
    .map((m) => {
      let s = `<rect x="${(m.t - 1.5).toFixed(1)}" y="34" width="3" height="16" fill="#ffb23f"/>`;
      if (m.down < 1440) s += `<rect x="${(m.down - 1.5).toFixed(1)}" y="2" width="3" height="10" fill="#e8edf3"/>`;
      return s;
    })
    .join('');
  const svg = $('#calc-timeline');
  drawWindows(svg, w.windows, marks);
  svg.setAttribute('aria-label', `${w.passes} ${i18n.t('calc.out.passes')}; ${i18n.t('calc.out.median')}: ${fmtDur(d.median)}`);
}
const queueCalc = () => { if (!calcQueued) { calcQueued = true; requestAnimationFrame(updateCalc); } };
calcMsgs.addEventListener('input', queueCalc);
calcSize.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  calc.sats = +b.dataset.sats;
  queueCalc();
});
calcSize.addEventListener('keydown', (e) => {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const i = presets.findIndex((p) => p.sats === calc.sats);
  const next = presets[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : presets.length - 1)) % presets.length];
  calc.sats = next.sats;
  updateCalc();
  $(`button[data-sats="${next.sats}"]`, calcSize).focus();
});

// ---------------------------------------------------------------------------
// Contact form (concept: never sends anything)
$('#contact-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const status = $('#form-status');
  const ok = f.name.value.trim() && /^\S+@\S+\.\S+$/.test(f.email.value.trim());
  status.className = `mono small ${ok ? 'ok' : 'err'}`;
  status.dataset.i18n = ok ? 'form.ok' : 'form.err';
  status.textContent = i18n.t(status.dataset.i18n);
  if (ok) f.reset();
});

// ---------------------------------------------------------------------------
// Language changes re-render dynamic strings.
i18n.onChange(() => {
  syncControls();
  updateConstellation();
  updateCalc();
  if (!countersStarted || reduced) renderCounters(countersStarted ? 1 : 0);
});

// ---------------------------------------------------------------------------
// Loader
const loader = $('#loader');
const loaderBars = $$('.loader-bars i', loader);
const loaderPct = $('#loader-pct');
function setLoad(frac) {
  loaderBars.forEach((b, i) => b.classList.toggle('on', frac >= (i + 1) / 4 - 0.001));
  loaderPct.textContent = Math.round(frac * 100);
}
if (!reduced) $('.loader-bars', loader).classList.add('searching');

// ---------------------------------------------------------------------------
// 3D
const canvas = $('#gl');
const veil = $('#veil');
const labelsEl = $('#labels');
const heroPanel = $('#hero .panel');
let renderer = null;
const scenes = {};
let shown = null;
let switching = false;
let collarLabels = [];
let siteLabel = null;
let passLabels = [];
let relayLabels = [];

function initRenderer() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: 'high-performance' });
  } catch (err) {
    console.warn('WebGL unavailable, falling back to text.', err);
    document.documentElement.classList.add('no-webgl');
    document.body.classList.add('no-webgl');
    return false;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#05070b');
  return true;
}

function resize() {
  if (!renderer) return;
  const w = innerWidth, h = innerHeight;
  const cap = Math.min(devicePixelRatio || 1, w < 820 ? CONFIG.render.maxPixelRatioMobile : CONFIG.render.maxPixelRatioDesktop);
  const px = Math.max(0.75, cap * quality);
  renderer.setPixelRatio(px);
  renderer.setSize(w, h, false);
  for (const s of Object.values(scenes)) {
    s.resize(w, h);
    s.setPixel(px);
  }
  if (blend) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    blend.targets.forEach((rt) => rt.setSize(size.x, size.y));
    blend.material.uniforms.uAspect.value = w / h;
  }
}

async function boot() {
  i18n.apply();
  syncControls();
  updateConstellation();
  updateCalc();
  const t0 = performance.now();
  setLoad(0.08);

  const fonts = Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
  const hasGL = initRenderer();
  if (hasGL) {
    const valleyMod = import('./scenes/valley.js');
    const cowGltf = valleyMod
      .then((m) => m.loadCow(`${import.meta.env.BASE_URL}models/cow.glb`))
      .catch((err) => { console.warn('Cow model failed to load; using fallback.', err); return null; });
    const [{ createValley }, { createCollar }] = await Promise.all([valleyMod, import('./scenes/collar.js')]);
    scenes.valley = createValley({ low, reduced, cowGltf: await cowGltf });
    scenes.collar = createCollar({ reduced, renderer, low });
    setLoad(0.35);
    const [{ createGlobe }, topo] = await Promise.all([
      import('./scenes/globe.js'),
      import('world-atlas/land-110m.json').then((m) => m.default),
    ]);
    setLoad(0.6);
    await new Promise((r) => setTimeout(r, 0));
    scenes.globe = createGlobe({ low, reduced, topo });
    setLoad(0.8);
    resize();
    warmUp();
    const pm = scenes.valley.passMeta;
    const scrub = $('.scrub-track');
    scrub.style.setProperty('--in', pm.linkIn);
    scrub.style.setProperty('--out', pm.linkOut);
    // Captions follow the link window computed from the satellite path.
    const [b1, b2, b3] = chapters[3].beats;
    b1.to = b2.from = pm.linkIn;
    b2.to = b3.from = pm.linkOut;
    const narrow = matchMedia('(max-width: 820px)').matches; // the HUD already shows the spec
    collarLabels = ['chip.lbl.cover', 'chip.lbl.antenna', narrow ? 'chip.lbl.modem.short' : 'chip.lbl.modem', 'chip.lbl.sim', 'chip.lbl.battery', 'chip.lbl.shell'].map((key) => {
      const el = document.createElement('div');
      el.className = 'label3d';
      el.innerHTML = `<span data-i18n="${key}">${i18n.t(key)}</span>`;
      labelsEl.append(el);
      return el;
    });
    siteLabel = document.createElement('div');
    siteLabel.className = 'label3d site';
    siteLabel.innerHTML = `<span data-i18n="gap.site">${i18n.t('gap.site')}</span>`;
    labelsEl.append(siteLabel);
    relayLabels = ['collar', 'sat', 'gs'].map((k) => {
      const el = document.createElement('div');
      el.className = `label3d relay-${k}`;
      el.innerHTML = '<span></span>';
      labelsEl.append(el);
      return el;
    });
    passLabels = ['collar', 'sat'].map((k) => {
      const el = document.createElement('div');
      el.className = `label3d pass-${k}`;
      el.innerHTML = '<span></span>';
      labelsEl.append(el);
      return el;
    });
  }
  await fonts;
  setLoad(1);
  const minShow = reduced ? 0 : 900;
  await new Promise((r) => setTimeout(r, Math.max(0, minShow - (performance.now() - t0))));
  loader.classList.add('done');
  $('.loader-bars', loader).classList.remove('searching');
  loader.setAttribute('aria-busy', 'false');
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Frame loop
let last = performance.now();
let lastBlipCount = 0;

function measure() {
  const vh = innerHeight;
  let active = null;
  for (const c of chapters) {
    const r = c.el.getBoundingClientRect();
    c.p = clamp(-r.top / Math.max(1, r.height - vh));
    if (!active && r.top <= vh * 0.5 && r.bottom > vh * 0.5) active = c;
  }
  return active || (scrollY < 10 ? chapters[0] : chapters[chapters.length - 1]);
}

function setActive(c) {
  if (state.active === c) return;
  state.active = c;
  chapters.forEach((x) => x.railLink.classList.toggle('active', x === c));
  hud.show(c.id, hudSpecs[c.id], `${String(c.index).padStart(2, '0')}/${String(chapters.length).padStart(2, '0')}`);
  // Over long-form sections the HUD shrinks to its header on small screens.
  hud.root.classList.toggle('collapsed', c.id === 'faq' || c.id === 'contact');
  if (c.id === 'scale' && !countersStarted) {
    countersStarted = true;
    counterT0 = performance.now();
    if (reduced) renderCounters(1);
  }
  if (c.id === 'constellation' || c.id === 'faq') updateHudStatic(c);
}

function updateHudStatic(c) {
  if (c.id === 'constellation') {
    const w = siteWindows(state.sats);
    hud.set('sats', state.sats, 'ok');
    hud.set('passes', w.passes);
    hud.set('longest', fmtDur(w.longestGap), w.longestGap > 120 ? 'warn' : 'ok');
    hud.bars(w.longestGap > 180 ? 1 : w.longestGap > 60 ? 2 : w.longestGap > 15 ? 3 : 4);
  } else if (c.id === 'faq') {
    hud.set('sats', calc.sats);
    hud.bars(2);
  }
}

// ---------------------------------------------------------------------------
// Autoplay: between the hero fade (A) and the start of "The gap" (B) the page
// drives the scroll itself, so the ascent, handoff and pull-back play as one
// move. Entering the stretch while scrolling down plays to B; scrolling up
// plays back to A. User scroll input is held while it runs.
const AUTO = { heroP: 0.45, gapP: 0.2, duration: 1600 };
const auto = { active: false, t0: 0, y0: 0, y1: 0, dur: 0, lastY: 0 };

function autoBounds() {
  const vh = innerHeight;
  const hero = chapters[0].el, gap = chapters[1].el;
  return {
    a: hero.offsetTop + AUTO.heroP * (hero.offsetHeight - vh),
    b: gap.offsetTop + AUTO.gapP * (gap.offsetHeight - vh),
  };
}

function runAutoplay(now) {
  if (auto.active) {
    const t = clamp((now - auto.t0) / auto.dur);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    window.scrollTo(0, auto.y0 + (auto.y1 - auto.y0) * e);
    if (t >= 1) auto.active = false;
    auto.lastY = auto.y0 + (auto.y1 - auto.y0) * e;
    return;
  }
  const y = scrollY;
  const prev = auto.lastY;
  auto.lastY = y;
  const { a, b } = autoBounds();
  if (y <= a + 1 || y >= b - 1) return;
  const target = y > prev ? b : y < prev ? a : y - a < b - y ? a : b;
  if (reduced) {
    window.scrollTo(0, target);
    auto.lastY = target;
    return;
  }
  auto.active = true;
  auto.t0 = now;
  auto.y0 = y;
  auto.y1 = target;
  auto.dur = AUTO.duration * Math.max(0.3, Math.abs(target - y) / (b - a));
}

const holdScroll = (e) => { if (auto.active) e.preventDefault(); };
addEventListener('wheel', holdScroll, { passive: false });
addEventListener('touchmove', holdScroll, { passive: false });
addEventListener('keydown', (e) => {
  if (auto.active && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(e.key)) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Hero → globe transition. One progress value T (0..1) across the autoplay
// range drives everything, so the move never stalls between chapters:
// the valley camera climbs, the scenes crossfade, the globe pulls back.
const TRANS = { valleyEnd: 0.78, globeStart: 0.66 };
let blend = null;

function ensureBlend() {
  if (blend) return blend;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const opts = { samples: low ? 0 : 4, colorSpace: THREE.SRGBColorSpace };
  const targets = [new THREE.WebGLRenderTarget(size.x, size.y, opts), new THREE.WebGLRenderTarget(size.x, size.y, opts)];
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tA: { value: targets[0].texture },
      tB: { value: targets[1].texture },
      uT: { value: 0 },
      uAspect: { value: innerWidth / innerHeight },
      uGlow: { value: 0 },
      uGlowColor: { value: new THREE.Color('#ffb23f') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tA; uniform sampler2D tB; uniform float uT; uniform float uAspect;
      uniform float uGlow; uniform vec3 uGlowColor;
      varying vec2 vUv;
      void main() {
        // Plain crossfade, a touch earlier at the centre where the LED sits.
        float r = length((vUv - 0.5) * vec2(uAspect, 1.0));
        float m = clamp(uT * 1.25 - r * 0.25, 0.0, 1.0);
        vec3 col = mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, m);
        // Optional flare: the edges dim and the cut passes through the LED's light.
        col *= 1.0 - uGlow * 0.7 * smoothstep(0.05, 0.55, r);
        col += uGlowColor * uGlow * (exp(-r * r * 7.0) * 1.1 + 0.05);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  blend = { targets, material, scene, camera: new THREE.Camera() };
  return blend;
}

function renderTransition(T, dt) {
  const { valley, globe } = scenes;
  const ease = (x) => x * x * (3 - 2 * x);
  const rise = clamp(T / TRANS.valleyEnd);
  const approach = clamp((T - TRANS.globeStart) / (1 - TRANS.globeStart));
  const fade = ease(clamp((T - TRANS.globeStart) / (TRANS.valleyEnd - TRANS.globeStart)));
  const common = { passTime: 0, time: state.time, dt, sats: state.sats, exact: true };
  let tel = null;
  if (fade < 1) tel = valley.update({ ...common, mode: 'hero', p: AUTO.heroP, rise });
  if (fade > 0) globe.update({ ...common, mode: 'gap', p: AUTO.gapP, approach });
  if (fade <= 0) renderer.render(valley.scene, valley.camera);
  else if (fade >= 1) renderer.render(globe.scene, globe.camera);
  else {
    const b = ensureBlend();
    renderer.setRenderTarget(b.targets[0]);
    renderer.render(valley.scene, valley.camera);
    renderer.setRenderTarget(b.targets[1]);
    renderer.render(globe.scene, globe.camera);
    renderer.setRenderTarget(null);
    b.material.uniforms.uT.value = fade;
    b.material.uniforms.uGlow.value = 0;
    renderer.render(b.scene, b.camera);
  }
  // Leave the right scene "shown" so chapters on either side continue seamlessly.
  shown = fade < 0.5 ? 'valley' : 'globe';
  document.body.dataset.scene = shown;
  return tel;
}

// Globe → collar: scrubbed with scroll across the gap/chip boundary. The globe
// dives onto the amber site dot, which crossfades into the collar's LED as the
// collar camera pulls back from it.
const DIVE = { gapP: 0.86, chipP: 0.12, globeEnd: 0.62, fadeFrom: 0.42, fadeTo: 0.62 };

function diveBounds() {
  const vh = innerHeight;
  const gap = chapters[1].el, chip = chapters[2].el;
  return {
    a: gap.offsetTop + DIVE.gapP * (gap.offsetHeight - vh),
    b: chip.offsetTop + DIVE.chipP * (chip.offsetHeight - vh),
  };
}

function renderDive(T, dt) {
  const { globe, collar } = scenes;
  const ease = (x) => x * x * (3 - 2 * x);
  const dive = clamp(T / DIVE.globeEnd);
  const intro = clamp((T - DIVE.fadeFrom) / (1 - DIVE.fadeFrom));
  const fade = ease(clamp((T - DIVE.fadeFrom) / (DIVE.fadeTo - DIVE.fadeFrom)));
  const common = { time: state.time, dt, sats: state.sats, exact: true };
  if (fade < 1) globe.update({ ...common, mode: 'gap', p: DIVE.gapP, dive });
  // The device LED stays masked while the globe's flare crossfades out, then
  // fades up once the device itself reads, so the two lights never collide.
  const ledVis = smooth01(clamp((T - (DIVE.fadeFrom + DIVE.fadeTo) / 2) / 0.12));
  if (fade > 0) collar.update({ ...common, p: DIVE.chipP, intro, ledVis });
  renderPair(globe, collar, fade, 0.95);
  setTransitionFade(T);
  shown = fade < 0.5 ? 'globe' : 'collar';
  document.body.dataset.scene = shown;
}

// Collar → valley: the exploded collar closes up and the camera pushes into its
// LED, which crossfades into the LED on the cow's collar as the valley camera
// pulls back to the pass framing. Scrubbed with scroll, like the dive.
const LAND = { chipP: 0.86, passP: 0.07, closeEnd: 0.4, pushFrom: 0.25, fadeFrom: 0.5, fadeTo: 0.66 };

function landBounds() {
  const vh = innerHeight;
  const chip = chapters[2].el, pass = chapters[3].el;
  return {
    a: chip.offsetTop + LAND.chipP * (chip.offsetHeight - vh),
    b: pass.offsetTop + LAND.passP * (pass.offsetHeight - vh),
  };
}

function renderLand(T, dt) {
  const { collar, valley } = scenes;
  const ease = (x) => x * x * (3 - 2 * x);
  const close = clamp(T / LAND.closeEnd);
  const push = clamp((T - LAND.pushFrom) / (LAND.fadeTo - LAND.pushFrom));
  const arrive = clamp((T - LAND.fadeFrom) / (1 - LAND.fadeFrom));
  const fade = ease(clamp((T - LAND.fadeFrom) / (LAND.fadeTo - LAND.fadeFrom)));
  state.passTime = LAND.passP;
  const common = { time: state.time, dt, sats: state.sats, exact: true };
  if (fade < 1) collar.update({ ...common, p: LAND.chipP, close, intro: 1 - push });
  let tel = null;
  if (fade > 0) tel = valley.update({ ...common, mode: 'pass', p: LAND.passP, passTime: LAND.passP, arrive });
  renderPair(collar, valley, fade, 0.95);
  setTransitionFade(T);
  shown = fade < 0.5 ? 'collar' : 'valley';
  document.body.dataset.scene = shown;
  return tel;
}

/** Chapter copy steps aside while a scene handoff plays. */
let txPanels = null, txLast = -1;
function setTransitionFade(T) {
  const v = T < 0 ? 0 : Math.round(smooth01(clamp(1 - Math.abs(T * 2 - 1) * 1.4)) * 100) / 100;
  if (v === txLast) return;
  txLast = v;
  // Opacity on the panels only: a body-level variable restyles the whole page.
  txPanels ??= [...document.querySelectorAll('.chapter:not(#hero) .panel')];
  for (const el of txPanels) el.style.opacity = v ? String(1 - v) : '';
}
const smooth01 = (x) => x * x * (3 - 2 * x);

/**
 * Draw every scene (and the blend pass) once offscreen during the loader, so
 * shader compiles and texture uploads never land mid-transition as a hitch.
 */
function warmUp() {
  const rt = new THREE.WebGLRenderTarget(64, 64, { samples: low ? 0 : 4, colorSpace: THREE.SRGBColorSpace });
  const t = { time: 0, dt: 0.016, sats: state.sats, exact: true, passTime: 0.5 };
  scenes.valley.update({ ...t, mode: 'pass', p: 0.5 });
  scenes.globe.update({ ...t, mode: 'gap', p: 0.86, dive: 0.5 });
  scenes.collar.update({ ...t, p: 0.9 });
  renderer.setRenderTarget(rt);
  for (const sc of Object.values(scenes)) renderer.render(sc.scene, sc.camera);
  const bl = ensureBlend();
  bl.material.uniforms.uT.value = 0.5;
  renderer.render(bl.scene, bl.camera);
  renderer.setRenderTarget(null);
  // The screen uses different shader variants than render targets: warm both.
  for (const sc of Object.values(scenes)) renderer.render(sc.scene, sc.camera);
  renderer.clear();
  rt.dispose();
  for (const sc of Object.values(scenes)) sc.snap();
}

function renderPair(a, b, fade, glow = 0) {
  if (fade <= 0) return renderer.render(a.scene, a.camera);
  if (fade >= 1) return renderer.render(b.scene, b.camera);
  const bl = ensureBlend();
  bl.material.uniforms.uGlow.value = glow * Math.sin(Math.PI * fade);
  renderer.setRenderTarget(bl.targets[0]);
  renderer.render(a.scene, a.camera);
  renderer.setRenderTarget(bl.targets[1]);
  renderer.render(b.scene, b.camera);
  renderer.setRenderTarget(null);
  bl.material.uniforms.uT.value = fade;
  renderer.render(bl.scene, bl.camera);
}

function switchScene(want, seamless = false) {
  document.body.dataset.scene = want || 'none';
  if (want === shown || switching) return;
  if (reduced || shown === null || seamless || window.__debug?.instant) {
    shown = want;
    scenes[want]?.snap();
    veil.classList.toggle('on', !want);
    return;
  }
  switching = true;
  veil.classList.add('on');
  setTimeout(() => {
    shown = want;
    scenes[want]?.snap();
    if (want) veil.classList.remove('on');
    switching = false;
  }, 230);
}

// Adaptive resolution: if the device can't hold ~40 fps, render fewer pixels;
// give them back once there's headroom. Checked about every 1.5 s.
const perf = { t: 0, n: 0, sum: 0, good: 0 };
function govern(now) {
  const dt = now - perf.t;
  perf.t = now;
  if (dt <= 0 || dt > 250) return; // tab switches, first frame, debugger
  perf.sum += dt;
  if (++perf.n < 90) return;
  const avg = perf.sum / perf.n;
  perf.n = perf.sum = 0;
  // Step down fast; step back up only after a few smooth windows in a row.
  perf.good = avg < 19 ? perf.good + 1 : 0;
  let next = quality;
  if (avg > 25) next = Math.max(0.5, quality * 0.8);
  else if (perf.good >= 3 && quality < 1) { next = Math.min(1, quality + 0.1); perf.good = 0; }
  if (next !== quality) { quality = next; resize(); }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) { last = now; perf.t = 0; return; }
  govern(now);
  tick(now);
}

function tick(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  state.time += dt;
  runAutoplay(now);

  const c = measure();
  setActive(c);
  for (const ch of chapters) {
    if (ch !== c && ch.beats.every((b) => !b.on)) continue;
    for (const b of ch.beats) {
      const on = ch === c && ch.p >= b.from && ch.p < b.to;
      if (on !== b.on) { b.on = on; b.el.classList.toggle('on', on); }
    }
  }

  // passTime: the master value for the pass, eased toward scroll position.
  const passTarget = chapters[3].p;
  state.passTime = reduced ? passTarget : state.passTime + (passTarget - state.passTime) * (1 - Math.exp(-dt * 8));
  $('#pass .scrubber').style.setProperty('--p', state.passTime.toFixed(4));

  if (countersStarted && !reduced) {
    const t = (now - counterT0) / 1600;
    if (t <= 1.05) renderCounters(t);
  }

  if (!renderer) return updateHudNoGL(c);

  // Hero copy fades out as the camera starts to climb.
  const hp = chapters[0].p;
  heroPanel.style.opacity = String(1 - clamp((hp - 0.3) / 0.2));
  heroPanel.style.transform = `translateY(${-clamp((hp - 0.3) / 0.2) * 24}px)`;

  setTransitionFade(-1); // the dive/land handoffs below set it while they play
  const { a, b } = autoBounds();
  if (scenes.globe && scrollY > a && scrollY < b) {
    labelsEl.style.display = 'none';
    updateHud(c, renderTransition((scrollY - a) / (b - a), dt));
    return;
  }

  const dv = diveBounds();
  if (scenes.globe && scenes.collar && scrollY > dv.a && scrollY < dv.b) {
    labelsEl.style.display = 'none';
    renderDive((scrollY - dv.a) / (dv.b - dv.a), dt);
    updateHud(c, null);
    return;
  }

  const ld = landBounds();
  if (scenes.collar && scenes.valley && scrollY > ld.a && scrollY < ld.b) {
    labelsEl.style.display = 'none';
    updateHud(c, renderLand((scrollY - ld.a) / (ld.b - ld.a), dt));
    return;
  }

  // Scene boundaries covered by a handoff get no veil.
  const seamless = (shown === 'valley' && c.id === 'gap') || (shown === 'globe' && c.id === 'hero') ||
    (shown === 'globe' && c.id === 'chip') || (shown === 'collar' && c.id === 'gap') ||
    (shown === 'collar' && c.id === 'pass') || (shown === 'valley' && c.id === 'chip');
  switchScene(c.scene, seamless);
  const s = scenes[shown];
  const showChip = shown === 'collar' && c.id === 'chip';
  const showSite = shown === 'globe' && c.id === 'gap';
  const showPass = shown === 'valley' && c.id === 'pass';
  const showRelay = shown === 'globe' && c.id === 'relay';
  const showLabels = showChip || showSite || showPass || showRelay;
  if (!s) {
    labelsEl.style.display = 'none';
    updateHud(c, null);
    return;
  }
  const tel = s.update({ mode: c.mode, p: c.p, passTime: state.passTime, time: state.time, dt, sats: state.sats, exact: auto.active });
  renderer.render(s.scene, s.camera);
  updateHud(c, tel);

  labelsEl.style.display = showLabels ? '' : 'none';
  if (!showChip) collarLabels.forEach((el) => el.classList.remove('on'));
  if (showPass) {
    const sp = s.passScreen(innerWidth, innerHeight);
    const [lc, ls] = passLabels;
    const collarText = tel.buffered > 0
      ? `COLLAR-01 · ${tel.buffered} ${i18n.t('hud.msgs')} ${i18n.t(tel.link === 'up' ? 'pass.lbl.sending' : 'pass.lbl.queued')}`
      : `COLLAR-01 · ${i18n.t('pass.lbl.empty')}`;
    setLabel(lc, collarText, sp.collar, true, tel.link === 'up' || tel.buffered === 0 ? 'ok' : 'warn');
    setLabel(ls, `${i18n.t('pass.lbl.sat')} · ${tel.el.toFixed(0)}°`, sp.sat, tel.el > 7, tel.link === 'up' ? 'ok' : '');
  } else passLabels.forEach((el) => el.classList.remove('on'));
  if (showRelay) {
    const sp = s.relayScreen(innerWidth, innerHeight);
    const st = tel.relayState;
    const [lc, ls, lg] = relayLabels;
    setLabel(lc, 'COLLAR-01', sp.collar, true, st === 'collar' ? 'warn' : '');
    setLabel(ls, i18n.t(st === 'sat' ? 'relay.lbl.carry' : 'relay.lbl.sat'), sp.sat, true, st === 'sat' ? 'ok' : '');
    setLabel(lg, i18n.t('relay.lbl.gs'), sp.gs, true, st === 'down' || st === 'net' ? 'ok' : '', true);
  } else relayLabels.forEach((el) => el.classList.remove('on'));
  if (siteLabel) {
    const on = showSite && c.p > 0.18;
    if (on) {
      const sp = s.siteScreen(innerWidth, innerHeight);
      siteLabel.style.transform = `translate(${sp.x - 3.5}px, ${sp.y}px) translateY(-50%)`;
      siteLabel.classList.toggle('on', sp.facing);
    } else siteLabel.classList.remove('on');
  }
  if (showChip) {
    const on = tel.explode > 0.8;
    const pos = s.labelPositions(innerWidth, innerHeight);
    pos.forEach((l, i) => {
      const el = collarLabels[i];
      el.style.transform = `translate(${l.x - 3.5}px, ${l.y}px) translateY(-50%)`;
      el.classList.toggle('on', on);
      el.classList.toggle('primary', l.primary);
    });
  }
}

function setLabel(el, text, pos, on, tone, left = false) {
  const span = el.firstChild;
  if (span.textContent !== text) span.textContent = text;
  el.classList.toggle('left', left);
  el.style.transform = left
    ? `translate(${pos.x + 3.5}px, ${pos.y}px) translate(-100%, -50%)`
    : `translate(${pos.x - 3.5}px, ${pos.y}px) translateY(-50%)`;
  el.classList.toggle('on', on && pos.visible);
  el.dataset.tone = tone || '';
}

function updateHud(c, tel) {
  switch (c.id) {
    case 'hero':
      hud.bars(0);
      break;
    case 'gap':
      hud.bars(0);
      break;
    case 'chip':
      hud.bars(4);
      break;
    case 'pass': {
      if (!tel) break;
      hud.set('elev', `${tel.el.toFixed(1)}°`, tel.el > MODEL.elevationMaskDeg ? 'ok' : tel.el > 0 ? 'warn' : 'off');
      const toneMap = { below: 'off', search: 'warn', acq: 'warn', up: 'ok', lost: 'off' };
      hud.set('link', { key: `hud.link.${tel.link}` }, toneMap[tel.link]);
      hud.set('buffered', `${tel.buffered} ${i18n.t('hud.msgs')}`, tel.buffered ? 'warn' : 'ok');
      hud.set('onboard', `${tel.onboard} ${i18n.t('hud.msgs')}`, tel.onboard ? 'ok' : '');
      hud.set('clock', `T+${fmtClock(tel.clock)}`);
      hud.bars(tel.bars);
      if (tel.onboard > lastBlipCount) ambient.blip(1100 + tel.onboard * 40);
      lastBlipCount = tel.onboard;
      break;
    }
    case 'relay': {
      const st = tel?.relayState ?? 'net';
      hud.set('state', { key: `hud.state.${st}` }, st === 'net' ? 'ok' : st === 'collar' ? 'warn' : '');
      hud.bars({ collar: 1, sat: 3, down: 4, net: 4 }[st]);
      break;
    }
    case 'constellation':
      updateHudStatic(c);
      break;
    case 'scale':
      hud.bars(3);
      break;
    case 'faq':
      updateHudStatic(c);
      break;
    case 'contact': {
      const up = tel?.link === 'up';
      hud.set('link', { key: up ? 'hud.link.up' : 'hud.standby' }, up ? 'ok' : 'off');
      hud.bars(tel?.bars ?? 0);
      break;
    }
  }
}
function updateHudNoGL(c) {
  updateHud(c, null);
}

// ---------------------------------------------------------------------------
addEventListener('resize', resize);
if (import.meta.env.DEV) {
  // Lets automated checks step frames while the tab is hidden.
  window.__debug = {
    step(n = 30) { for (let i = 0; i < n; i++) tick(last + 1000 / 60); },
    state,
    scenes,
  };
}
reducedMQ.addEventListener?.('change', (e) => { reduced = e.matches; });
boot();
