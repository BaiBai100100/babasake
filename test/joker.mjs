// ババ酒：JOKERを引いた（ドキッ）／引かれた（ホッ）の演出と、ホーム画面に追加（manifest・アイコン）
// 使い方: node test/joker.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/joker/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- manifest とアイコン ----
const res = await page.goto(BASE);
const man = await page.evaluate(async () => {
  const href = document.querySelector('link[rel="manifest"]')?.href;
  const m = href ? await (await fetch(href)).json() : null;
  const apple = document.querySelector('link[rel="apple-touch-icon"]')?.href;
  const ok = async (u) => { const r = await fetch(u); return r.ok && (r.headers.get('content-type') || '').includes('png'); };
  const icons = m ? await Promise.all(m.icons.map((i) => ok(new URL(i.src, href).href))) : [];
  return { display: m?.display, start: m?.start_url, icons, apple: apple ? await ok(apple) : false };
});
console.log('manifest:', res.ok(), JSON.stringify(man));
console.log('アイコンが全部PNGで読める:', man.icons.length === 3 && man.icons.every(Boolean) && man.apple);
await sleep(800);
console.log('ハブに「ホーム画面に追加」の案内:', (await page.locator('.a2hs').count()) === 1);
await page.locator('.a2hs').scrollIntoViewIfNeeded();
await page.screenshot({ path: OUT + '00-a2hs.png' });

// ---- JOKER ----
await page.click('[data-g="baba"]');
await page.fill('#in-name', 'はる');
await page.click('[data-act="local"]');
await page.click('[data-act="add-cpu"]');
await page.click('[data-act="add-cpu"]');
await page.click('[data-act="start"]');
await sleep(600);
// 自分の番にして、引く相手の手札の先頭に JOKER を置き、その1枚を引く
const me = await page.evaluate(() => window.__bb.me.id);
await page.evaluate((me) => window.__bb.commit((x) => {
  const y = structuredClone(x);
  const g = y.game;
  const owner = Object.keys(g.hands).find((p) => g.hands[p].includes('JK'));
  g.hands[owner] = g.hands[owner].filter((c) => c !== 'JK');
  g.turn = me;
  g.step = 'draw';
  const from = window.__bb.L.drawTarget(y);
  g.hands[from].unshift('JK');
  // 手札の枚数を合わせる（JOKERを抜いた人に、引く相手の最後の1枚を渡す）
  if (owner !== from) g.hands[owner].push(g.hands[from].pop());
  return y;
}), me);
await sleep(300);
await page.evaluate(() => window.__bb.commit((x) => window.__bb.L.draw(x, window.__bb.me.id, 0)));
await sleep(450);
const got = await page.evaluate(() => document.querySelector('.fx-joker')?.className || null);
console.log('JOKERを引いたら「ドキッ」:', got === 'fx-joker got', got);
await page.screenshot({ path: OUT + '01-got.png' });
await sleep(1800);
console.log('しばらくで消える:', (await page.locator('.fx-joker').count()) === 0);
// こんどは自分の手札の JOKER を、だれかに引かせる
const st = await page.evaluate(() => {
  const s = window.__bb.ui.state;
  return { turn: s.game.turn, step: s.game.step, hasJK: s.game.hands[window.__bb.me.id].includes('JK') };
});
console.log('いま自分がJOKERを持っている:', st.hasJK, st.step);
await page.evaluate((me) => window.__bb.commit((x) => {
  const y = structuredClone(x);
  const g = y.game;
  const L = window.__bb.L;
  g.step = 'draw';
  g.pair = null;
  // 自分から引く人（自分が drawTarget になる人）を探して、その人の番にする
  const drawer = Object.keys(g.hands).find((p) => p !== me && g.hands[p].length && (() => { const z = structuredClone(y); z.game.turn = p; return L.drawTarget(z) === me; })());
  g.turn = drawer;
  g.step = 'draw';
  g.pair = null;
  g.hands[me] = ['JK', ...g.hands[me].filter((c) => c !== 'JK')];
  y.__drawer = drawer;
  return y;
}), me);
await page.evaluate(() => window.__bb.commit((x) => { const d = x.__drawer; const y = window.__bb.L.draw(x, d, 0); delete y.__drawer; return y; }));
await sleep(450);
const gone = await page.evaluate(() => document.querySelector('.fx-joker')?.className || null);
console.log('JOKERを引かれたら「ホッ」:', gone === 'fx-joker gone', gone);
await page.screenshot({ path: OUT + '02-gone.png' });
console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
