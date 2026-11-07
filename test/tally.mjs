// 通算成績：ババ酒の通算負け数（2ゲーム目の結果画面）と、トークトライアルのテーマ引き直し（1台モード）
// 使い方: node test/tally.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/tally/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  await sleep(800);
  return page;
}
const st = async (p) => JSON.parse(await p.evaluate(() => window.render_game_to_text()));

// ===== ババ酒：CPU3人と2ゲーム（ゲームの進行は内部の自動手で一気に進める） =====
const p = await open();
await p.click('[data-g="baba"]');
await p.fill('#in-name', 'はる');
await p.click('[data-act="local"]');
for (let i = 0; i < 3; i++) await p.click('[data-act="add-cpu"]');
await p.click('[data-act="start"]');
const finish = () => p.evaluate(() => {
  const { L, commit } = window.__bb;
  commit((x) => { let y = x; let k = 0; while (y.phase === 'play' && k++ < 5000) y = L.applyAction(y, L.autoAction(y)); return y; });
});
await finish();
await sleep(1200);
console.log('1ゲーム目は通算を出さない:', (await p.locator('.loss-tally').count()) === 0);
await p.evaluate(() => { const { L, commit } = window.__bb; commit((x) => L.startGame(x)); });
await sleep(500);
await finish();
await sleep(1500);
const tally = await p.locator('.loss-tally').innerText().catch(() => '');
const losses = await p.evaluate(() => window.__bb.ui.state.losses);
console.log('2ゲーム目に通算が出る:', !!tally, tally.replace(/\s+/g, ' '));
console.log('合計2敗:', Object.values(losses).reduce((a, b) => a + b, 0) === 2);
await p.screenshot({ path: OUT + '01-baba-tally.png' });
await p.context().close();

// ===== トークトライアル：テーマを変える =====
const q = await open();
await q.click('[data-g="talk"]');
await q.fill('#in-name', 'はる');
await q.click('[data-act="local"]');
for (const n of ['あお', 'みさき']) { await q.fill('#in-add', n); await q.click('[data-act="add-local"]'); }
await q.click('[data-act="start"]');
await sleep(400);
const t1 = (await st(q)).theme;
await q.click('[data-act="treroll"]');
await sleep(300);
const t2 = (await st(q)).theme;
console.log('テーマが変わる:', t1 !== t2, `${t1} → ${t2}`);
await q.screenshot({ path: OUT + '02-talk-reroll.png' });
await q.click('[data-act="taccuse"]');
await q.click('[data-act="tacc-by"] >> nth=0');
await q.click('[data-act="tacc-target"] >> nth=0');
await q.click('[data-act="tacc-pick"] >> nth=0');
await sleep(400);
console.log('見破りのあとは「別のテーマ」ボタンが消える:', (await q.locator('[data-act="treroll"]').count()) === 0);
console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
