// トークトライアルのハンコ演出：見破った／ハズレ／達成 を1台モードで出して撮る
// 使い方: node test/stamp.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/stamp/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
await page.goto(BASE);
await sleep(800);
await page.click('[data-g="talk"]');
await page.fill('#in-name', 'はる');
await page.click('[data-act="local"]');
for (const n of ['あお', 'みさき']) { await page.fill('#in-add', n); await page.click('[data-act="add-local"]'); }
await page.click('[data-act="start"]');
await sleep(400);
const g = await page.evaluate(() => window.__bb.ui.state.game);
const ids = (await st()).players.map((p) => p.id);
async function accuse(by, target, right) {
  await page.click('[data-act="taccuse"]');
  await page.click(`[data-act="tacc-by"][data-pid="${by}"]`);
  await page.click(`[data-act="tacc-target"][data-pid="${target}"]`);
  const m = right ? g.missions[target] : g.options[target].find((x) => x !== g.missions[target]);
  await page.click(`[data-act="tacc-pick"][data-m="${m}"]`);
}
const seen = async () => page.evaluate(() => document.querySelector('.fx-stamp b')?.textContent || null);
const drinkShown = async () => page.evaluate(() => !!document.querySelector('#fx-layer .fx'));

// ハズレ
await accuse(ids[0], ids[1], false);
await sleep(450);
console.log('ハズレのハンコ:', await seen(), '／同時に飲む演出は出ない:', !(await drinkShown()));
await page.screenshot({ path: OUT + '01-miss.png' });
await sleep(1300);
console.log('ハンコのあとに飲む演出:', await drinkShown(), '／ハンコは消える:', (await seen()) === null);
await sleep(4500);
// 見破った
await accuse(ids[1], ids[2], true);
await sleep(450);
console.log('見破りのハンコ:', await seen());
await page.screenshot({ path: OUT + '02-busted.png' });
await sleep(5500);
// 達成
await page.click('[data-act="tachieve"]');
await page.click(`[data-act="tach-who"][data-pid="${ids[0]}"]`);
await sleep(450);
console.log('達成のハンコ:', await seen());
await page.screenshot({ path: OUT + '03-won.png' });
console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
