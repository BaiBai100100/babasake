// 罰ゲームルーレット：決める人が回すと、もう1台にも同じ並び・同じ結果で回る。飲む演出はルーレットのあと
// 使い方: node test/roulette.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/roulette/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await page.waitForTimeout(600);
  return page;
}
async function until(fn, label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await sleep(150); }
  throw new Error('timeout: ' + label);
}
const a = await open(BASE, 'A');
await a.click('[data-g="baba"]');
await a.fill('#in-name', 'はる');
await a.click('[data-act="create"]');
await a.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'lobby', null, { timeout: 25000 });
const s0 = JSON.parse(await a.evaluate(() => window.render_game_to_text()));
const b = await open(`${BASE}?r=${s0.code}&b=${s0.broker}&name=${encodeURIComponent('あお')}&autojoin=1`, 'B');
await until(async () => (await a.evaluate(() => window.__bb.ui.state.players.length)) === 2, '2人');
await a.click('[data-act="start"]');
await until(async () => (await b.evaluate(() => window.__bb.ui.state.phase)) === 'play', '開始');
// 罰ゲームを決める場面まで一気に進めて、はる（A）を1番上がりにする
await a.evaluate(() => window.__bb.commit((x) => {
  const { L, me } = window.__bb;
  let y = x;
  let k = 0;
  while (y.game.step !== 'penalty' && k++ < 5000) y = L.applyAction(y, L.autoAction(y));
  y = structuredClone(y);
  const g = y.game;
  const other = y.players.map((p) => p.id).find((pid) => pid !== me.id);
  g.finished = [me.id];
  g.loser = other;
  g.hands[other] = ['JK'];
  g.hands[me.id] = [];
  return y;
}));
await until(async () => (await b.evaluate(() => window.__bb.ui.state.game.step)) === 'penalty', 'Bにも罰ゲームの場面');
await sleep(600);
await a.locator('[data-act="pen-roulette"]').scrollIntoViewIfNeeded();
await a.screenshot({ path: OUT + '00-choose.png' });
await a.click('[data-act="pen-roulette"]');
await until(async () => (await b.locator('.fx-roulette').count()) === 1, 'Bでも回る', 8000);
await sleep(500);
const spinA = await a.evaluate(() => !!document.querySelector('.fx-roulette') && !document.querySelector('.fx-roulette.landed'));
const drinkDuring = await b.evaluate(() => !!document.querySelector('#fx-layer .fx'));
console.log('回っている（A）:', spinA, '／回っている間は飲む演出なし（B）:', !drinkDuring);
await b.screenshot({ path: OUT + '01-spinning.png' });
await until(async () => (await b.locator('.fx-roulette.landed').count()) === 1, 'Bで止まる', 8000);
const landedA = await a.evaluate(() => document.querySelector('.fx-roulette .rl-item')?.textContent);
const landedB = await b.evaluate(() => document.querySelector('.fx-roulette .rl-item')?.textContent);
const pen = await b.evaluate(() => window.__bb.ui.state.game.penalty);
console.log('2台とも同じ結果で止まる・罰ゲームと一致:', landedA === landedB && landedB === pen, pen);
await b.screenshot({ path: OUT + '02-landed.png' });
await sleep(1600);
console.log('ルーレットは消える:', (await b.locator('.fx-roulette').count()) === 0);
console.log('結果画面に「ルーレット」:', (await b.locator('.penalty span', { hasText: 'ルーレット' }).count()) === 1);
await b.screenshot({ path: OUT + '03-over.png' });
console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
