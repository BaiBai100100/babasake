// 飲む演出（画面・音・振動）。#app の外に置くので、再描画されても止まらない
// playDrink({ kind: 'solo' | 'multi', water, mult })
//   solo  … グラスひとつ：飛び出す → ゴクッ、ゴクッ → プハーッ！
//   multi … グラスふたつ：左右から飛んできてカチン → カンパーイ！
//   mult ≥ MEGA_AT（貯金が大きい）… 特大演出：ドラムロールで「×N」がカウントアップ → ドーン！で
//   ファンファーレ・歓声、下からビールの波、紙吹雪の雨、画面フラッシュ

const INK = '#1b1a22';
const PAPER = '#fdf8f0';
const PINK = '#fb3ea8';
const BLUE = '#1c3cc2';
const BLUE_L = '#d6defb';
const DUR = { solo: 2000, multi: 1700 }; // 演出の長さ（ms）
export const MEGA_AT = 5; // この倍率から特大演出
const MEGA_Z = { solo: 1260, multi: 380 }; // 特大演出のカウントアップが始まる時刻（ms）
const MEGA_COUNT = 900; // カウントアップの長さ → ここで「ドーン！」
const MEGA_LEN = 2600; // カウントアップ開始から終わりまで
export const isMega = (mult) => mult >= MEGA_AT;
export const megaWord = (mult) => (mult >= 10 ? '伝説の一杯！' : '貯金ドーン！');
export function totalMs(kind, mult = 1) {
  return isMega(mult) ? MEGA_Z[kind] + MEGA_LEN : DUR[kind];
}

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
// ルーレットの「カチッ」
function tick(ctx, t, out) {
  tone(ctx, out, { type: 'square', f0: 1700, f1: 1500, t, a: 0.002, d: 0.035, peak: 0.07 });
  return t + 0.05;
}
// ハズレのブザー「ブッブー」
function buzz(ctx, t, out) {
  tone(ctx, out, { type: 'square', f0: 196, f1: 180, t, a: 0.005, d: 0.2, peak: 0.13 });
  tone(ctx, out, { type: 'square', f0: 147, f1: 120, t: t + 0.24, a: 0.005, d: 0.38, peak: 0.13 });
  return t + 0.65;
}
// 出だしの「ポンッ」
function pop(ctx, t, out) {
  tone(ctx, out, { f0: 520, f1: 1300, t, a: 0.003, d: 0.09, peak: 0.28, glide: 0.06 });
  return t + 0.12;
}
// ドラムロール：だんだん速く、強く
function drumroll(ctx, t, out, dur = MEGA_COUNT / 1000) {
  let x = 0;
  let gap = 0.075;
  while (x < dur - 0.02) {
    const k = x / dur;
    hiss(ctx, out, { t: t + x, a: 0.002, d: 0.045, peak: 0.16 + k * 0.32, filters: [{ type: 'bandpass', f: 240 + k * 160, q: 0.9 }] });
    tone(ctx, out, { f0: 130, f1: 70, t: t + x, a: 0.002, d: 0.05, peak: 0.12 + k * 0.28 });
    x += gap;
    gap = Math.max(0.03, gap * 0.92);
  }
  return t + dur;
}
// ブラス風の音（ファンファーレ用）
function brass(ctx, out, f, t, d, peak = 0.11) {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f, t);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(f * 1.5, t);
  lp.frequency.linearRampToValueAtTime(f * 6, t + 0.04);
  lp.frequency.exponentialRampToValueAtTime(f * 2.5, t + d);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
  g.gain.setValueAtTime(peak, t + d * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.14);
  o.connect(lp).connect(g).connect(out);
  o.start(t);
  o.stop(t + d + 0.2);
}
// ファンファーレ「パッパッパッ、パーン！」
function fanfare(ctx, t, out) {
  const notes = [[523.25, 0, 0.1], [659.25, 0.12, 0.1], [783.99, 0.24, 0.1], [1046.5, 0.36, 0.8]];
  for (const [f, at, d] of notes) for (const det of [1, 1.007]) brass(ctx, out, f * det, t + at, d);
  // 最後の音は和音で厚く
  for (const f of [659.25, 783.99]) brass(ctx, out, f, t + 0.36, 0.8, 0.07);
  return t + 1.3;
}
// 歓声「ワーッ！」：ざわざわした息の音を何層か重ねる
function cheer(ctx, t, out) {
  for (let i = 0; i < 5; i++) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(500 + i * 320, t);
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    const t0 = t + i * 0.04;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.18);
    g.gain.setValueAtTime(0.14, t0 + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
    src.connect(bp).connect(g).connect(out);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + 1.6);
  }
  return t + 1.6;
}
export const SOUNDS = { clink, fizz, gulp, puhaa, pop, drumroll, fanfare, cheer, buzz, tick };

// 罰ゲームルーレット：だんだん遅くなって items[at] で止まる。全体の長さ（ms）を返す
export function playRoulette({ items, at }) {
  const root = ensureLayer();
  root.querySelector('.fx-roulette')?.remove();
  const el = document.createElement('div');
  el.className = 'fx-roulette';
  el.innerHTML = '<div class="rl-panel"><span class="rl-title">罰ゲームルーレット</span><div class="rl-window"><b class="rl-item"></b></div></div>';
  root.appendChild(el);
  const item = el.querySelector('.rl-item');
  const show = (i) => { item.textContent = items[i % items.length]; };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const steps = still ? 0 : items.length * 2 + at; // 2周してから止まる
  const delays = [];
  for (let i = 0; i < steps; i++) delays.push(50 + 300 * (i / Math.max(1, steps)) ** 2.6);
  let t = 0;
  for (let i = 0; i < steps; i++) {
    setTimeout(() => { show(i); playSounds([['tick', 0]]); }, t);
    t += delays[i];
  }
  setTimeout(() => {
    show(at);
    el.classList.add('landed');
    playSounds([['fanfare', 0], ['clink', 0.1]]);
    vibrate([80, 40, 160]);
  }, t);
  const total = t + 1400;
  setTimeout(() => el.remove(), total);
  return total;
}

// ババ酒：JOKERを引いた（ドキッ）／引かれた（ホッ）。自分の画面だけに出す。音なし・短め
export function playJoker(kind) {
  const root = ensureLayer();
  root.querySelector('.fx-joker')?.remove();
  const el = document.createElement('div');
  el.className = `fx-joker ${kind === 'gone' ? 'gone' : 'got'}`;
  el.innerHTML = `<div class="jk-panel"><div class="jk-card"><img src="img/joker.webp" alt=""></div><b>${kind === 'gone' ? 'ホッ…' : 'ドキッ…'}</b></div>`;
  root.appendChild(el);
  // 音は出さない（まわりに聞こえると、だれがJOKERを持ったかバレる）。振動も手に伝わる程度に短く
  if (kind !== 'gone') vibrate([40, 90, 40]);
  setTimeout(() => el.remove(), 1700);
}

// でかいハンコ（トークトライアルの「見破った！」「ハズレ！」「ミッション達成！」など）。1.5秒で消える
export const STAMP_MS = 1500;
export function playStamp({ text, sub = '', tone = 'pink', sounds = [] } = {}) {
  const root = ensureLayer();
  root.querySelector('.fx-stamp')?.remove();
  const el = document.createElement('div');
  el.className = `fx-stamp ${tone}`;
  el.innerHTML = `<div class="st"><b>${text}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  root.appendChild(el);
  playSounds(sounds);
  vibrate(tone === 'ink' ? [200] : [60, 40, 60, 40, 120]);
  setTimeout(() => el.remove(), STAMP_MS);
}

// 鳴らす音の予定表 [名前, 秒]（プレビュー動画も同じ表を使う）
export function soundPlan(kind, mult = 1) {
  const big = mult > 1;
  const mega = isMega(mult);
  const base = kind === 'solo'
    ? [['pop', 0], ['gulp', 0.74], ['gulp', 1.0], ['puhaa', 1.26]].concat(big && !mega ? [['clink', 1.3]] : [])
    : [['pop', 0.02], ['clink', 0.37], ['fizz', 0.45]].concat(big && !mega ? [['clink', 0.55]] : []);
  if (!mega) return base;
  const z = MEGA_Z[kind] / 1000;
  const hit = z + MEGA_COUNT / 1000;
  return base.concat([['drumroll', z], ['clink', hit], ['fanfare', hit], ['cheer', hit + 0.05], ['clink', hit + 0.16]]);
}

export function playSounds(list) {
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

// 特大演出：上から降る紙吹雪
function rain(n, { water = false } = {}) {
  const cols = water ? [BLUE, BLUE_L, PAPER] : [PINK, BLUE, PAPER, PINK, BLUE_L];
  let h = '';
  for (let i = 0; i < n; i++) {
    const shape = ['conf', 'conf', 'dot', 'drop'][i % 4];
    h += `<i class="fx-p ${shape}" style="--x:${(Math.random() * 100).toFixed(1)}%;--r:${(Math.random() * 900 - 450).toFixed(0)}deg;--s:${(0.7 + Math.random() * 0.8).toFixed(2)};--c:${cols[i % cols.length]};--dl:${(Math.random() * 700).toFixed(0)}ms;--sw:${(Math.random() * 60 - 30).toFixed(0)}px"></i>`;
  }
  return h;
}
// 特大演出：下からせり上がるビール（お水なら水）の波
function waveSvg({ water = false } = {}) {
  const liq = water ? BLUE_L : PINK;
  const dots = BLUE;
  let crest = 'M0 46';
  for (let x = 0; x < 440; x += 40) crest += ' q10 -26 20 -6 q10 -20 20 6';
  let under = 'L440 74';
  for (let x = 440; x > 0; x -= 40) under += ' q-10 14 -20 2 q-10 12 -20 -2';
  return `<svg viewBox="0 0 440 300" preserveAspectRatio="none" aria-hidden="true">
    <defs><pattern id="wv-d" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.8" fill="${dots}" opacity=".35"/></pattern></defs>
    <rect x="0" y="60" width="440" height="240" fill="${liq}"/>
    <rect x="0" y="60" width="440" height="240" fill="url(#wv-d)"/>
    <path d="${crest} ${under} Z" fill="${PAPER}" stroke="${INK}" stroke-width="4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
  </svg>${Array.from({ length: 14 }, (_, i) => `<i class="fx-wb" style="--x:${(4 + Math.random() * 92).toFixed(1)}%;--i:${i};--sz:${(8 + Math.random() * 14).toFixed(0)}px"></i>`).join('')}`;
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
let timers = [];
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
  const mega = isMega(mult);
  const n = 26 + Math.min(mult - 1, 6) * 10;
  const el = document.createElement('div');
  el.className = `fx fx-${kind}${water ? ' water' : ''}${big ? ' big' : ''}${mega ? ' mega' : ''}`;
  const total = totalMs(kind, mult);
  if (mega) el.style.cssText = `--mz:${MEGA_Z[kind]}ms;--total:${total}ms;--to:${mult}`;
  // 特大のときは小さいバッジの代わりに、上で大きくカウントアップする
  const badge = big && !mega ? `<b class="fx-mult">×${mult}</b>` : '';
  const back = mega ? `<div class="fx-strobe"></div><div class="fx-wave">${waveSvg({ water })}</div>` : '';
  const front = mega ? `<div class="fx-rain">${rain(36 + Math.min(mult, 20) * 3, { water })}</div>
      <div class="fx-count-wrap"><i class="fx-star"></i><b class="fx-count" data-to="${mult}"></b><span class="fx-word fx-mega-word">${megaWord(mult)}</span></div>` : '';
  if (kind === 'solo') {
    el.innerHTML = `<div class="fx-veil"></div><div class="fx-rays"></div>${back}
      <div class="fx-stage">
        <div class="fx-g one">${water ? highballSvg({ water }) : mugSvg()}</div>
        <span class="fx-word w1">ゴクッ</span><span class="fx-word w2">ゴクッ</span>
        <div class="fx-burst">${particles(n, { water })}</div>
        <span class="fx-word big-word">${water ? 'ふぅ〜ッ！' : 'プハーッ！'}</span>${badge}
      </div>${front}`;
  } else {
    el.innerHTML = `<div class="fx-veil"></div><div class="fx-rays"></div>${back}
      <div class="fx-stage">
        <div class="fx-g left">${water ? highballSvg({ water }) : mugSvg({ flip: true })}</div>
        <div class="fx-g right">${highballSvg({ water })}</div>
        <div class="fx-flash"></div>
        <div class="fx-burst">${particles(n, { spread: 1.15, water })}</div>
        <span class="fx-word big-word">${water ? 'チェイサー！' : 'カンパーイ！'}</span>${badge}
      </div>${front}`;
  }
  root.appendChild(el);
  current = el;
  const sound = playSounds(soundPlan(kind, mult));
  const later = (ms, fn) => { if (!hold) timers.push(setTimeout(fn, ms)); };
  timers.forEach(clearTimeout);
  timers = [];
  if (kind === 'solo') {
    later(740, () => vibrate([25]));
    later(1000, () => vibrate([25]));
    later(1260, () => { vibrate(big ? [80, 40, 140] : [90]); shake(380, big); });
  } else {
    later(370, () => { vibrate(big ? [60, 30, 160] : [110]); shake(420, true); });
  }
  if (mega) {
    // ドーン！：長めの振動と、2回ゆれる
    const hit = MEGA_Z[kind] + MEGA_COUNT;
    later(hit, () => { vibrate([150, 60, 150, 60, 320]); shake(420, true); });
    later(hit + 480, () => shake(420, true));
  }
  fxState.count++;
  fxState.last = { kind, water, mult, mega, sound, at: Date.now(), ms: total };
  if (!hold) setTimeout(() => { el.remove(); if (current === el) current = null; }, total + 80);
  return fxState.last;
}
