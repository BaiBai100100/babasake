// 途中で帰った人を外す：1台の記憶（その人の番なら次へ）と、3台のNGワード（ワードが消える・外された人は観戦に）
// 使い方: node test/kickmid.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/kickmid/', import.meta.url).pathname;
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
const st = async (p) => JSON.parse(await p.evaluate(() => window.render_game_to_text()));
async function until(fn, label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await sleep(150); }
  throw new Error('timeout: ' + label);
}

// ---- 1台の記憶 ----
const p = await open(BASE, '1台');
await p.click('[data-g="kioku1"]');
await p.fill('#in-name', 'はる');
await p.click('[data-act="local"]');
for (const n of ['あお', 'みさき']) { await p.fill('#in-add', n); await p.click('[data-act="add-local"]'); }
await p.click('[data-act="start"]');
await sleep(400);
await p.click('[data-act="kdraw"]');
await sleep(600);
let s = await st(p);
const turn = s.turn;
const turnName = s.players.find((x) => x.id === turn).name;
await p.click('[data-act="menu"]');
console.log('メニューに「途中で帰った人を外す」:', (await p.locator('[data-act="kickmid-menu"]').count()) === 1);
await p.click('[data-act="kickmid-menu"]');
await sleep(200);
await p.screenshot({ path: OUT + '01-pick.png' });
await p.click(`[data-act="kick-mid"][data-pid="${turn}"]`);
await sleep(500);
s = await st(p);
console.log(`記憶：${turnName}（番の人）を外す → 2人・次の人の引く場面:`, s.players.length === 2 && s.step === 'draw' && s.turn !== turn);
await p.screenshot({ path: OUT + '02-after.png' });
await p.click('[data-act="menu"]');
console.log('2人になったらメニューから消える:', (await p.locator('[data-act="kickmid-menu"]').count()) === 0);
await p.context().close();

// ---- 3台のNGワード ----
const a = await open(BASE, 'A');
await a.click('[data-g="ng"]');
await a.fill('#in-name', 'はる');
await a.click('[data-act="create"]');
await a.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'lobby', null, { timeout: 25000 });
const h = await st(a);
const b = await open(`${BASE}?r=${h.code}&b=${h.broker}&name=${encodeURIComponent('あお')}&autojoin=1`, 'B');
const c = await open(`${BASE}?r=${h.code}&b=${h.broker}&name=${encodeURIComponent('みさき')}&autojoin=1`, 'C');
await until(async () => (await st(a)).players.length === 3, '3人');
await a.click('[data-act="start"]');
await until(async () => (await st(c)).phase === 'play' && (await st(b)).phase === 'play', '開始');
const cid = (await st(c)).me;
await a.click('[data-act="menu"]');
await a.click('[data-act="kickmid-menu"]');
await a.click(`[data-act="kick-mid"][data-pid="${cid}"]`);
await until(async () => (await st(b)).players.length === 2, 'Bに届く');
await sleep(500);
const sb = await st(b);
console.log('NG：外した人のワードがほかの人の画面から消える:', sb.visibleWords.length === 1 && !(cid in sb.words));
const cView = await c.evaluate(() => ({ me: !!document.querySelector('.ng-me'), out: document.querySelectorAll('[data-act="ngout"]').length }));
console.log('外された人は観戦（自分の欄・「言った！」なし・「観戦中」の表示）:', !cView.me && cView.out === 0 && (await c.locator('.spectate').count()) === 1);
await c.screenshot({ path: OUT + '03-removed-view.png' });
console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
