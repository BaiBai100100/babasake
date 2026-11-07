// 飲む演出をコマ送りで撮って、音つきのプレビュー動画（mp4）を作る。node test/fx-preview.mjs [URL]
// アニメーションを止めて currentTime を動かすので、どのコマも狙いどおりの瞬間になる。ffmpeg が必要
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/fx-preview/', import.meta.url).pathname;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT + 'frames', { recursive: true });
const FPS = 30;
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, locale: 'ja-JP' });
await page.goto(BASE);
await page.waitForTimeout(1000);
await page.click('[data-g="kioku1"]');
await page.fill('#in-name', 'はる');
await page.click('[data-act="local"]');
await page.fill('#in-add', 'あお');
await page.click('[data-act="add-local"]');
await page.click('[data-act="start"]');
await page.waitForTimeout(600);

// 場面：[カードid, 演出, 長さ(s), 貯金]。--mega で特大演出（貯金 ×5 以上）だけ
const MEGA = process.argv.includes('--mega');
const scenes = MEGA ? [
  ['K1-02', { kind: 'solo', mult: 7 }, 4.0, 6],
  ['K1-33', { kind: 'multi', mult: 12 }, 3.1, 11],
] : [
  ['K1-01', { kind: 'solo', mult: 1 }, 2.2, 0],
  ['K1-33', { kind: 'multi', mult: 1 }, 1.9, 0],
  ['K1-02', { kind: 'solo', mult: 4 }, 2.2, 3],
  ['KW', { kind: 'multi', water: true, mult: 1 }, 1.9, 0],
];
let frame = 0;
const audioPlan = [];
let t0 = 0;
for (const [card, fx, len, pot] of scenes) {
  await page.evaluate(([card, pot]) => window.__bb.commit((s) => {
    const t = JSON.parse(JSON.stringify(s));
    const g = t.game;
    g.card = card; g.step = 'card'; g.committed = true; g.pot = pot; g.notice = null; g.n = (g.n || 0) + 1;
    return t;
  }), [card, pot]);
  await page.waitForTimeout(900); // カードのめくりアニメが終わるまで
  // 演出を出して、すぐ全部止める
  await page.evaluate((fx) => {
    window.__bb.FX.setSound(false);
    window.__bb.FX.playDrink({ ...fx, hold: true });
    document.body.classList.remove('fx-shake', 'fx-shake-strong');
    for (const a of fxAnims()) a.pause();
    function fxAnims() { return document.getAnimations().filter((a) => a.effect?.target?.closest?.('#fx-layer')); }
  }, fx);
  const n = Math.round(len * FPS);
  for (let i = 0; i < n; i++) {
    const ms = (i * 1000) / FPS;
    await page.evaluate((ms) => {
      document.body.classList.remove('fx-shake', 'fx-shake-strong');
      for (const a of document.getAnimations().filter((x) => x.effect?.target?.closest?.('#fx-layer'))) { a.pause(); a.currentTime = ms; }
    }, ms);
    await page.screenshot({ path: `${OUT}frames/${String(frame++).padStart(4, '0')}.png` });
  }
  const sched = await page.evaluate((fx) => window.__bb.FX.soundPlan(fx.kind, fx.mult), fx);
  for (const [name, at] of sched) audioPlan.push([name, t0 + at]);
  t0 += n / FPS;
  await page.evaluate(() => document.getElementById('fx-layer')?.replaceChildren());
}

// 音：同じ合成音をオフラインで鳴らして WAV に
const total = t0 + 0.3;
const wavB64 = await page.evaluate(async ([plan, total]) => {
  const sr = 44100;
  const oc = new OfflineAudioContext(1, Math.ceil(sr * total), sr);
  const comp = oc.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  const g = oc.createGain(); g.gain.value = 0.85; g.connect(comp).connect(oc.destination);
  for (const [name, at] of plan) window.__bb.FX.SOUNDS[name](oc, at + 0.02, g);
  const buf = await oc.startRendering();
  const d = buf.getChannelData(0);
  const bytes = new DataView(new ArrayBuffer(44 + d.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); bytes.setUint32(4, 36 + d.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
  bytes.setUint32(24, sr, true); bytes.setUint32(28, sr * 2, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true);
  w(36, 'data'); bytes.setUint32(40, d.length * 2, true);
  for (let i = 0; i < d.length; i++) bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
  let bin = '';
  const u8 = new Uint8Array(bytes.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}, [audioPlan, total]);
fs.writeFileSync(OUT + 'sound.wav', Buffer.from(wavB64, 'base64'));
await browser.close();

execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${OUT}frames/%04d.png`, '-i', `${OUT}sound.wav`,
  '-vf', 'scale=780:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', `${OUT}${MEGA ? 'mega' : 'preview'}.mp4`]);
console.log('frames', frame, 'sec', total.toFixed(2), '→', OUT + (MEGA ? 'mega' : 'preview') + '.mp4');
