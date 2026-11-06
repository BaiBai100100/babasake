// 飲む演出（画面・音・振動）。#app の外に置くので、再描画されても止まらない
// playDrink({ kind: 'solo' | 'multi', water, mult })
//   solo  … グラスひとつ：飛び出す → ゴクッ、ゴクッ → プハーッ！
//   multi … グラスふたつ：左右から飛んできてカチン → カンパーイ！

const INK = '#1b1a22';
const PAPER = '#fdf8f0';
const PINK = '#fb3ea8';
const BLUE = '#1c3cc2';
const BLUE_L = '#d6defb';
const DUR = { solo: 2000, multi: 1700 }; // 演出の長さ（ms）

const KEY = 'babasake:sound';
export const fxState = { count: 0, last: null, sound: readSound() };

function readSound() {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}
export function setSound(on) {
  fxState.sound = !!on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* noop */ }
  if (on) unlockAudio();
}

// ---------- 音（Web Audio で合成。音源ファイルなし） ----------
let actx = null;
let master = null;
let noise = null;
function audio() {
  if (actx) return actx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  actx = new AC();
  master = makeMaster(actx);
  return actx;
}
function makeMaster(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  const g = ctx.createGain();
  g.gain.value = 0.85;
  g.connect(comp).connect(ctx.destination);
  return g;
}
// iOS は最初のタップで音を解禁しておかないと、他の人がめくったときに鳴らない
export function unlockAudio() {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  if (!unlockAudio.done) {
    unlockAudio.done = true;
    const b = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(ctx.destination);
    src.start(0);
  }
}

function noiseBuf(ctx) {
  if (noise && noise.sampleRate === ctx.sampleRate && ctx === actx) return noise;
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  if (ctx === actx) noise = b;
  return b;
}
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(ctx, out, { type = 'sine', f0, f1 = f0, t, a = 0.004, d = 0.3, peak = 0.3, glide = d }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  env(g, t, a, peak, d);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + a + d + 0.05);
}
function hiss(ctx, out, { t, a = 0.005, d = 0.1, peak = 0.2, filters = [] }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf(ctx);
  const g = ctx.createGain();
  env(g, t, a, peak, d);
  let node = src;
  for (const f of filters) {
    const bq = ctx.createBiquadFilter();
    bq.type = f.type;
    bq.frequency.setValueAtTime(f.f, t);
    if (f.to) bq.frequency.exponentialRampToValueAtTime(f.to, t + a + d);
    if (f.q) bq.Q.value = f.q;
    node.connect(bq);
    node = bq;
  }
  node.connect(g).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + a + d + 0.05);
}

// グラスがぶつかる「カチン」：倍音がずれた高い音を2つ、ほんの少しずらして
function clink(ctx, t, out) {
  const ring = (t0, base, k) => {
    [[1, 1, 0.9], [1.51, 0.55, 0.6], [2.25, 0.32, 0.42], [2.88, 0.18, 0.28]].forEach(([r, amp, dec]) => {
      tone(ctx, out, { f0: base * r, t: t0, a: 0.002, d: dec * k, peak: 0.22 * amp });
    });
  };
  hiss(ctx, out, { t, a: 0.001, d: 0.025, peak: 0.35, filters: [{ type: 'highpass', f: 3500 }] });
  ring(t, 2093, 1);
  ring(t + 0.014, 2349, 0.8);
  return t + 1;
}
// 炭酸の「シュワ」
function fizz(ctx, t, out) {
  hiss(ctx, out, { t, a: 0.05, d: 0.6, peak: 0.07, filters: [{ type: 'highpass', f: 5200 }] });
  for (let i = 0; i < 7; i++) tone(ctx, out, { f0: 1800 + Math.random() * 2400, f1: 3200 + Math.random() * 2000, t: t + Math.random() * 0.5, a: 0.002, d: 0.03, peak: 0.05 });
  return t + 0.7;
}
// 飲み込む「ゴクッ」：のどの低い音＋泡のポコッ
function gulp(ctx, t, out) {
  tone(ctx, out, { f0: 190, f1: 62, t, a: 0.006, d: 0.13, peak: 0.75, glide: 0.1 });
  hiss(ctx, out, { t, a: 0.004, d: 0.08, peak: 0.22, filters: [{ type: 'lowpass', f: 500 }] });
  tone(ctx, out, { f0: 380, f1: 950, t: t + 0.07, a: 0.003, d: 0.07, peak: 0.22, glide: 0.06 });
  return t + 0.25;
}
// 「プハーッ」：唇のプッ＋息の「ハー」（声っぽい響きを少し）
function puhaa(ctx, t, out) {
  hiss(ctx, out, { t, a: 0.002, d: 0.04, peak: 0.55, filters: [{ type: 'lowpass', f: 900 }] });
  tone(ctx, out, { f0: 140, f1: 90, t, a: 0.002, d: 0.05, peak: 0.35 });
  const h = t + 0.07;
  // 息
  hiss(ctx, out, { t: h, a: 0.05, d: 0.55, peak: 0.42, filters: [{ type: 'bandpass', f: 1100, to: 650, q: 1.2 }] });
  // 「あー」の母音（フォルマント 750 / 1200Hz）
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(175, h);
  src.frequency.exponentialRampToValueAtTime(120, h + 0.6);
  const g = ctx.createGain();
  env(g, h, 0.06, 0.16, 0.55);
  const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 760; f1.Q.value = 6;
  const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1220; f2.Q.value = 7;
  src.connect(f1).connect(g);
  src.connect(f2).connect(g);
  g.connect(out);
  src.start(h);
  src.stop(h + 0.7);
  return h + 0.7;
}
// 出だしの「ポンッ」
function pop(ctx, t, out) {
  tone(ctx, out, { f0: 520, f1: 1300, t, a: 0.003, d: 0.09, peak: 0.28, glide: 0.06 });
  return t + 0.12;
}
export const SOUNDS = { clink, fizz, gulp, puhaa, pop };

function playSounds(list) {
  if (!fxState.sound) return false;
  const ctx = audio();
  if (!ctx) return false;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  const t0 = ctx.currentTime + 0.02;
  for (const [name, at] of list) SOUNDS[name](ctx, t0 + at, master);
  return true;
}

// ---------- 絵（リソグラフ調の SVG） ----------
let uid = 0;
function mugSvg({ water = false, flip = false } = {}) {
  const id = `m${++uid}`;
  const liq = water ? BLUE_L : PINK;
  const bubbles = [[34, 118, 3], [52, 96, 2.5], [70, 128, 3.5], [44, 80, 2], [80, 104, 2.5], [62, 70, 2]]
    .map(([x, y, r], i) => `<circle class="bub" style="--i:${i}" cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${PAPER}" stroke-width="2"/>`).join('');
  const foam = water ? '' : `<g class="foam">
      <path d="M12 46 q-6-20 14-22 q4-16 22-10 q10-14 28-4 q16-8 24 8 q16 4 10 26 q-6 8 -14 4 q-2 14 -10 8 q-8 -2 -8 -10 l-50 0 q-12 6 -16 0 z" fill="${PAPER}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <circle cx="40" cy="30" r="3" fill="${INK}" opacity=".18"/><circle cx="72" cy="24" r="2.5" fill="${INK}" opacity=".18"/>
    </g>`;
  // 'flip' はカードをめくるアニメのクラス名と衝突するので 'mirror'
  return `<svg class="fx-glass mug${flip ? ' mirror' : ''}" viewBox="0 0 150 170" aria-hidden="true">
    <defs>
      <clipPath id="${id}c"><rect x="21" y="35" width="74" height="114" rx="8"/></clipPath>
      <pattern id="${id}d" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="${BLUE}" opacity=".38"/></pattern>
    </defs>
    <g transform="translate(7 7)" fill="${BLUE}"><rect x="16" y="30" width="84" height="124" rx="12"/><path d="M100 60 h14 q18 0 18 20 v32 q0 20 -18 20 h-14 v-14 h12 q6 0 6 -8 v-28 q0 -8 -6 -8 h-12 z"/></g>
    <rect x="16" y="30" width="84" height="124" rx="12" fill="#eef1fb" stroke="${INK}" stroke-width="5"/>
    <g clip-path="url(#${id}c)">
      <rect x="21" y="35" width="74" height="114" fill="url(#${id}d)" opacity=".35"/>
      <g class="liq">
      ${water ? '' : `<path d="M10 40 q8 -6 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 v8 h-96 z" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>`}
      <rect x="10" y="44" width="100" height="120" fill="${liq}"/>
      <rect x="10" y="44" width="100" height="120" fill="url(#${id}d)"/>
      ${bubbles}
    </g></g>
    <path d="M100 60 h14 q18 0 18 20 v32 q0 20 -18 20 h-14" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path class="shine" d="M32 56 v74" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".9"/>
    <path d="M44 60 v18" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".8"/>
    <path d="M24 150 h68" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity=".25"/>
    ${foam}
  </svg>`;
}
function highballSvg({ water = false } = {}) {
  const id = `h${++uid}`;
  const liq = water ? BLUE_L : BLUE;
  const dots = water ? BLUE : PINK;
  const body = 'M16 22 L104 22 L95 158 Q94 166 86 166 L34 166 Q26 166 25 158 Z';
  return `<svg class="fx-glass highball" viewBox="0 0 130 180" aria-hidden="true">
    <defs>
      <clipPath id="${id}c"><path d="${body}"/></clipPath>
      <pattern id="${id}d" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="${dots}" opacity=".45"/></pattern>
    </defs>
    <path d="${body}" transform="translate(7 7)" fill="${PINK}"/>
    <path d="M70 -2 L62 70" stroke="${PINK}" stroke-width="9" stroke-linecap="round"/>
    <path d="${body}" fill="#eef1fb" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <g clip-path="url(#${id}c)"><g class="liq">
      <rect x="0" y="44" width="130" height="140" fill="${liq}"/>
      <rect x="0" y="44" width="130" height="140" fill="url(#${id}d)"/>
      <rect class="ice" x="30" y="50" width="28" height="26" rx="5" transform="rotate(-12 44 63)" fill="${PAPER}" fill-opacity=".8" stroke="${INK}" stroke-width="3"/>
      <rect class="ice" x="58" y="62" width="26" height="24" rx="5" transform="rotate(14 71 74)" fill="${PAPER}" fill-opacity=".8" stroke="${INK}" stroke-width="3"/>
      ${[[40, 120, 3], [64, 140, 2.5], [80, 108, 3], [52, 96, 2]].map(([x, y, r], i) => `<circle class="bub" style="--i:${i}" cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${PAPER}" stroke-width="2"/>`).join('')}
    </g></g>
    <path class="shine" d="M34 40 L40 146" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".9"/>
  </svg>`;
}

// 飛び散るしずく・紙吹雪
function particles(n, { spread = 1, water = false } = {}) {
  const cols = water ? [BLUE, BLUE_L, PAPER, PINK] : [PINK, BLUE, PAPER, PINK];
  let h = '';
  for (let i = 0; i < n; i++) {
    const ang = (-90 + (Math.random() * 2 - 1) * 80) * Math.PI / 180;
    const dist = (90 + Math.random() * 170) * spread;
    const x = Math.cos(ang) * dist;
    const y = Math.sin(ang) * dist;
    const shape = ['drop', 'conf', 'dot', 'conf'][i % 4];
    h += `<i class="fx-p ${shape}" style="--x:${x.toFixed(0)}px;--y:${y.toFixed(0)}px;--r:${(Math.random() * 720 - 360).toFixed(0)}deg;--s:${(0.6 + Math.random() * 0.9).toFixed(2)};--c:${cols[i % cols.length]};--dl:${(Math.random() * 60).toFixed(0)}ms"></i>`;
  }
  return h;
}

let layer = null;
let current = null;
let shakeTimer = null;
function ensureLayer() {
  if (layer && document.body.contains(layer)) return layer;
  layer = document.createElement('div');
  layer.id = 'fx-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}
// 画面をゆらす。#app を動かすと中の固定表示がずれるので、全画面ぴったりの main.game だけを動かす。
// クラスは body に付けるので、途中で再描画されても続く
function shake(ms, strong) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const b = document.body;
  b.classList.remove('fx-shake', 'fx-shake-strong');
  void b.offsetWidth;
  b.classList.add(strong ? 'fx-shake-strong' : 'fx-shake');
  clearTimeout(shakeTimer);
  shakeTimer = setTimeout(() => b.classList.remove('fx-shake', 'fx-shake-strong'), ms);
}
function vibrate(p) { try { navigator.vibrate?.(p); } catch { /* noop */ } }

// hold: true で自動で消さない（コマ送りのプレビュー撮影用）
export function playDrink({ kind, water = false, mult = 1, hold = false } = {}) {
  if (kind !== 'solo' && kind !== 'multi') return;
  const root = ensureLayer();
  if (current) current.remove();
  const big = mult > 1;
  const n = 26 + Math.min(mult - 1, 6) * 10;
  const el = document.createElement('div');
  el.className = `fx fx-${kind}${water ? ' water' : ''}${big ? ' big' : ''}`;
  const badge = big ? `<b class="fx-mult">×${mult}</b>` : '';
  if (kind === 'solo') {
    el.innerHTML = `<div class="fx-veil"></div><div class="fx-rays"></div>
      <div class="fx-stage">
        <div class="fx-g one">${water ? highballSvg({ water }) : mugSvg()}</div>
        <span class="fx-word w1">ゴクッ</span><span class="fx-word w2">ゴクッ</span>
        <div class="fx-burst">${particles(n, { water })}</div>
        <span class="fx-word big-word">${water ? 'ふぅ〜ッ！' : 'プハーッ！'}</span>${badge}
      </div>`;
  } else {
    el.innerHTML = `<div class="fx-veil"></div><div class="fx-rays"></div>
      <div class="fx-stage">
        <div class="fx-g left">${water ? highballSvg({ water }) : mugSvg({ flip: true })}</div>
        <div class="fx-g right">${highballSvg({ water })}</div>
        <div class="fx-flash"></div>
        <div class="fx-burst">${particles(n, { spread: 1.15, water })}</div>
        <span class="fx-word big-word">${water ? 'チェイサー！' : 'カンパーイ！'}</span>${badge}
      </div>`;
  }
  root.appendChild(el);
  current = el;
  let sound;
  if (kind === 'solo') {
    sound = playSounds([['pop', 0], ['gulp', 0.74], ['gulp', 1.0], ['puhaa', 1.26]].concat(big ? [['clink', 1.3]] : []));
    setTimeout(() => vibrate([25]), 740);
    setTimeout(() => vibrate([25]), 1000);
    setTimeout(() => { vibrate(big ? [80, 40, 140] : [90]); shake(380, big); }, 1260);
  } else {
    sound = playSounds([['pop', 0.02], ['clink', 0.37], ['fizz', 0.45]].concat(big ? [['clink', 0.55]] : []));
    setTimeout(() => { vibrate(big ? [60, 30, 160] : [110]); shake(420, true); }, 370);
  }
  fxState.count++;
  fxState.last = { kind, water, mult, sound, at: Date.now() };
  if (!hold) setTimeout(() => { el.remove(); if (current === el) current = null; }, DUR[kind] + 80);
  return fxState.last;
}
