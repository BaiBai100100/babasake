// 飲む演出：めくった瞬間に、ひとりならグラスひとつ・みんなならグラスふたつ。node test/drink.mjs [URL] [--video]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const VIDEO = process.argv.includes('--video');
const OUT = new URL('../shots/drink/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP',
  ...(VIDEO ? { recordVideo: { dir: OUT + 'video/', size: { width: 390, height: 780 } } } : {}),
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const shot = (name) => page.screenshot({ path: OUT + name + '.png' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inject = (cards, extra = {}) => page.evaluate(([cards, extra]) => window.__bb.commit((s) => {
  const t = JSON.parse(JSON.stringify(s));
  t.game.deck.splice(t.game.pos, 0, ...cards);
  Object.assign(t.game, extra);
  return t;
}), [cards, extra]);
const fxCount = async () => (await st()).fx.count;

await page.goto(BASE);
await page.waitForTimeout(1200);
await page.click('[data-g="kioku1"]');
await page.fill('#in-name', 'はる');
await page.click('[data-act="local"]');
for (const n of ['あお', 'みさき']) { await page.fill('#in-add', n); await page.click('[data-act="add-local"]'); }
await page.click('[data-act="start"]');
await sleep(800);

const r = {};
// 1) 当てはまり系 → グラスひとつ
await inject(['K1-01', 'K1-35', 'K1-33', 'K1-02', 'KW', 'K1-03']);
let c0 = await fxCount();
await page.click('[data-act="kdraw"]');
await sleep(250); await shot('S1-solo-in');
r.soloEl = await page.locator('#fx-layer .fx.fx-solo').count();
await sleep(600); await shot('S2-solo-gulp');
await sleep(500); await shot('S3-solo-puhaa');
let s = await st();
r.solo = { added: s.fx.count - c0, last: s.fx.last };
await sleep(900);
r.soloGone = await page.locator('#fx-layer .fx').count();
await page.click('[data-act="knext"]');
await sleep(500);

// 2) 飲まないカード → 出ない
c0 = await fxCount();
await page.click('[data-act="kdraw"]');
await sleep(700);
r.noDrinkAdded = (await fxCount()) - c0;
await page.click('[data-act="knext"]');
await sleep(500);

// 3) 全員で乾杯 → グラスふたつ
c0 = await fxCount();
await page.click('[data-act="kdraw"]');
await sleep(180); await shot('M1-multi-in');
r.multiEl = await page.locator('#fx-layer .fx.fx-multi').count();
await sleep(230); await shot('M2-multi-clink');
await sleep(450); await shot('M3-multi-kanpai');
s = await st();
r.multi = { added: s.fx.count - c0, last: s.fx.last };
await sleep(1000);
await page.click('[data-act="knext"]');
await sleep(500);

// 4) 貯金3つで当てはまり → ×4 のバッジ
await inject([], { pot: 3 });
await page.click('[data-act="kdraw"]');
await sleep(1450); await shot('B1-big-badge');
s = await st();
r.big = { last: s.fx.last, badge: (await page.locator('#fx-layer .fx.big .fx-mult').textContent().catch(() => null)) };
await sleep(800);
await page.click('[data-act="knext"]');
await sleep(500);

// 5) チェイサー（お水）→ お水のグラスふたつ
await page.click('[data-act="kdraw"]');
await sleep(700); await shot('W1-water');
s = await st();
r.water = { last: s.fx.last, el: await page.locator('#fx-layer .fx.fx-multi.water').count() };
await sleep(1200);
await page.click('[data-act="knext"]');
await sleep(500);

// 6) 効果音オフ（メニュー）→ 鳴らさない・記憶される
await page.click('[data-act="menu"]');
await sleep(300);
r.menuLabelOn = (await page.locator('[data-act="sound"]').textContent())?.trim();
await page.click('[data-act="sound"]');
await sleep(200);
r.menuLabelOff = (await page.locator('[data-act="sound"]').textContent())?.trim();
await page.click('.sheet [data-act="close-sheet"]');
await sleep(300);
await page.click('[data-act="kdraw"]');
await sleep(400);
s = await st();
r.muted = { last: s.fx.last, stored: await page.evaluate(() => localStorage.getItem('babasake:sound')) };
await sleep(1800);

// 7) 音そのもの：オフラインで鳴らして、無音でないか
r.audio = await page.evaluate(async () => {
  const out = {};
  for (const name of ['pop', 'clink', 'fizz', 'gulp', 'puhaa']) {
    const oc = new OfflineAudioContext(1, 44100 * 1.2, 44100);
    window.__bb.FX.SOUNDS[name](oc, 0.01, oc.destination);
    const buf = await oc.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0;
    for (const v of d) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
    out[name] = { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4) };
  }
  return out;
});

console.log(JSON.stringify(r, null, 1));
const ok = r.soloEl === 1 && r.solo.added === 1 && r.solo.last.kind === 'solo' && r.solo.last.sound === true && r.soloGone === 0
  && r.noDrinkAdded === 0
  && r.multiEl === 1 && r.multi.added === 1 && r.multi.last.kind === 'multi'
  && r.big.last.mult === 4 && r.big.badge === '×4'
  && r.water.last.water === true && r.water.el === 1
  && r.menuLabelOn === '効果音：オン' && r.menuLabelOff === '効果音：オフ' && r.muted.last.sound === false && r.muted.stored === '0'
  && Object.values(r.audio).every((a) => a.peak > 0.05 && a.peak <= 1.0);
console.log('飲む演出:', ok);
console.log('コンソールエラー:', errors.length ? errors.join(' / ') : 'なし');
await ctx.close();
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
