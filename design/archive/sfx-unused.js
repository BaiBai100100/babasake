// 効果音（WebAudioで合成。音声ファイルなし）
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('babasake:mute') === '1'; } catch { /* noop */ }

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('babasake:mute', m ? '1' : '0'); } catch { /* noop */ }
}

// iPhoneは操作のあとでないと音が出ないので、最初のタップで準備する
export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}

function tone(freq, start, dur, { type = 'sine', vol = 0.3, slide = 0 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(master);
  o.start(start);
  o.stop(start + dur + 0.05);
}

function noise(start, dur, { vol = 0.25, freq = 2400 } = {}) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(start);
}

const SOUNDS = {
  flip: (t) => { noise(t, 0.12, { vol: 0.35, freq: 3200 }); },
  draw: (t) => { noise(t, 0.08, { vol: 0.3, freq: 2600 }); tone(660, t + 0.05, 0.08, { type: 'triangle', vol: 0.12 }); },
  turn: (t) => { tone(880, t, 0.12, { type: 'triangle', vol: 0.18 }); tone(1320, t + 0.1, 0.16, { type: 'triangle', vol: 0.16 }); },
  pair: (t) => { [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.07, 0.22, { type: 'triangle', vol: 0.2 })); },
  clink: (t) => { tone(2600, t, 0.5, { vol: 0.16 }); tone(3900, t, 0.35, { vol: 0.1 }); tone(2600, t + 0.12, 0.4, { vol: 0.1 }); },
  win: (t) => { [523, 659, 784].forEach((f, i) => tone(f, t + i * 0.1, 0.18, { type: 'square', vol: 0.09 })); tone(1046, t + 0.3, 0.6, { type: 'square', vol: 0.11 }); SOUNDS.clink(t + 0.45); },
  lose: (t) => { [392, 370, 349, 262].forEach((f, i) => tone(f, t + i * 0.16, 0.22, { type: 'sawtooth', vol: 0.08 })); },
  buzz: (t) => { tone(140, t, 0.35, { type: 'square', vol: 0.12, slide: 0.8 }); },
  water: (t) => { [0, 0.09, 0.18].forEach((d, i) => tone(500 + i * 220, t + d, 0.12, { vol: 0.18, slide: 1.8 })); },
  tap: (t) => { tone(1200, t, 0.04, { type: 'triangle', vol: 0.08 }); },
};

export function play(name) {
  if (muted || !ctx || !SOUNDS[name]) return;
  try { SOUNDS[name](ctx.currentTime + 0.01); } catch { /* noop */ }
}
