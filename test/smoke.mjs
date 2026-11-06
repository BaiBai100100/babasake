// 画面ごとの見た目チェック（1台モード中心）。node test/smoke.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/smoke/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const shot = async (name, full = false) => { await page.waitForTimeout(350); await page.screenshot({ path: OUT + name + '.png', fullPage: full }); console.log('shot', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(BASE);
await page.waitForTimeout(1200);
await shot('01-hub', true);
await page.click('[data-g="kioku1"]');
await shot('02-setup-kioku1', true);
await page.fill('#in-name', 'はる');
await page.click('[data-act="local"]');
await page.fill('#in-add', 'あお');
await page.click('[data-act="add-local"]');
await page.fill('#in-add', 'みさき');
await page.click('[data-act="add-local"]');
await page.click('[data-act="add-cpu"]');
await shot('03-lobby-local', true);
await page.click('[data-act="toggle-hard"]');
await page.click('[data-act="set-deck"][data-d="mix"]');
await shot('04-lobby-hard', true);
await page.click('[data-act="start"]');
await shot('05-kioku-draw');
// 何枚か引いて、いろいろな場面を撮る
const seen = new Set();
let nones = 0;
for (let i = 0; i < 40; i++) {
  let s = await st();
  if (s.step === 'draw') {
    if (await page.locator('[data-act="kdraw"]').count()) await page.click('[data-act="kdraw"]');
    else { await sleep(1500); continue; }
    await sleep(700);
    s = await st();
    const g = s.text;
    if (!seen.has('card')) { seen.add('card'); await shot('06-kioku-card'); }
    if (await page.locator('[data-act="kpick"]').count() && !seen.has('pick')) { seen.add('pick'); await shot('07-kioku-pick'); }
    if (s.card === 'KW' && !seen.has('water')) { seen.add('water'); await shot('08-kioku-water'); }
    if (s.card?.startsWith('KX') && !seen.has('chaos')) { seen.add('chaos'); await shot('09-kioku-chaos'); }
    if (await page.locator('[data-act="ktimer"]').count() && !seen.has('timer')) { seen.add('timer'); await page.click('[data-act="ktimer"]'); await sleep(1300); await shot('10-kioku-timer'); }
  }
  s = await st();
  if (s.step === 'card') {
    if (await page.locator('[data-act="kpick"]').count()) {
      const need = await page.evaluate(() => window.__bb.K.currentCard(window.__bb.ui.state).need);
      for (let k = 0; k < need; k++) await page.click(`[data-act="kpick"] >> nth=${k}`);
      await page.click('[data-act="kcommit"]');
    } else if (await page.locator('#in-rule').count()) {
      await page.fill('#in-rule', '左手で飲む');
      await page.click('[data-act="kcommit"]');
    }
    if (await page.locator('[data-act="knone"]').count() && nones < 3) {
      nones++;
      if (nones === 3) await shot('20-kioku-none-full');
      await page.click('[data-act="knone"]');
      await sleep(350);
      if (nones === 3) { await shot('21-kioku-notice-drawer'); console.log('pot after full none', (await st()).pot, JSON.stringify((await st()).notice)); }
      continue;
    }
    if (await page.locator('[data-act="knext"]:not([disabled])').count()) await page.click('[data-act="knext"]');
    else await sleep(1200);
  }
}
await shot('11-kioku-drunk-late');
console.log('kioku seen', [...seen].join(','), JSON.stringify((await st()).rules));

// ババ酒：1人でCPUと
await page.evaluate(() => localStorage.removeItem('babasake:local'));
await page.goto(BASE);
await page.waitForTimeout(800);
await page.click('[data-g="baba"]');
await shot('12-setup-baba', true);
await page.click('[data-act="local"]');
await shot('13-lobby-baba-cpu', true);
await page.click('[data-act="start"]');
await sleep(600);
const bseen = new Set();
for (let i = 0; i < 400; i++) {
  const s = await st();
  if (s.phase === 'over') break;
  if (s.actor !== s.me && !s.iAct) { await sleep(400); continue; }
  try {
    if (s.step === 'draw') {
      await page.click('.fan .card[data-act="pick-draw"] >> nth=0', { timeout: 2000 });
      if (!bseen.has('draw')) { bseen.add('draw'); await shot('14-baba-draw'); }
      await page.click('[data-act="draw"]', { timeout: 2000 });
    } else if (s.step === 'choose') {
      if (!bseen.has('choose')) { bseen.add('choose'); await sleep(700); await shot('15-baba-choose'); }
      await page.click('.bigcard.tappable >> nth=0', { timeout: 2000 });
    } else if (s.step === 'odai') {
      if (await page.locator('[data-act="pick"]').count()) {
        const need = await page.evaluate(() => window.__bb.L.needCount(window.__bb.ui.state.game.pair.chosen));
        for (let k = 0; k < need; k++) await page.click(`[data-act="pick"] >> nth=${k}`);
        await page.click('[data-act="commit"]');
      } else if (await page.locator('#in-rule').count()) {
        await page.fill('#in-rule', '敬語禁止'); await page.click('[data-act="commit"]');
      } else if (await page.locator('[data-act="commit"]').count()) {
        await page.click('[data-act="commit"]');
      } else {
        const cpuPair = s.pair && s.pair.by !== s.me;
        const key = cpuPair ? 'odai-cpu' : 'odai';
        if (!bseen.has(key)) { bseen.add(key); await sleep(700); await shot(cpuPair ? '17-baba-odai-cpu' : '16-baba-odai'); }
        await page.click('[data-act="finish"]', { timeout: 2000 });
      }
    } else if (s.step === 'penalty') {
      await sleep(600); await shot('18-baba-penalty');
      await page.click('[data-act="preset"] >> nth=0');
      await page.click('[data-act="penalty"]');
    }
  } catch { await sleep(300); }
  await sleep(150);
}
await sleep(800);
await shot('19-baba-over');
console.log('baba seen', [...bseen].join(','), 'phase', (await st()).phase);
console.log('errors', errors.length ? errors : 'なし');
await browser.close();
