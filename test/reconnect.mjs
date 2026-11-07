// 再接続：1台の通信を切って、そのあいだに相手が進める → 切れている側の操作は止まる → つながり直すと追いつく。
// 長く画面を消したあとの「つながって見えて実は切れている」も、作り直しで追いつくか
// 使い方: node test/reconnect.mjs [URL]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8765/';
const browser = await chromium.launch({ channel: 'chromium' });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await page.waitForTimeout(600);
  return page;
}
const v = (p) => p.evaluate(() => window.__bb.ui.state?.v ?? 0);
const net = (p) => p.evaluate(() => window.__bb.ui.net);
async function until(fn, label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(150); }
  throw new Error('timeout: ' + label);
}
// 相手（ホスト）が1手進める（テストなので、だれの番でも自動の手を指す）
const step = (p) => p.evaluate(() => window.__bb.commit((x) => window.__bb.K.applyAction(x, window.__bb.K.autoAction(x))));

const a = await open(BASE, 'A');
await a.click('[data-g="kioku1"]');
await a.fill('#in-name', 'はる');
await a.click('[data-act="create"]');
await a.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'lobby', null, { timeout: 25000 });
const s0 = JSON.parse(await a.evaluate(() => window.render_game_to_text()));
const b = await open(`${BASE}?r=${s0.code}&b=${s0.broker}&name=${encodeURIComponent('あお')}&autojoin=1`, 'B');
await until(async () => (await a.evaluate(() => window.__bb.ui.state.players.length)) === 2, '2人');
console.log('作った直後でも操作できる（ホストの設定変更）:', await a.evaluate(() => window.__bb.commit((x) => window.__bb.L.setSettings(x, { deck: 'k1' }))));
await a.click('[data-act="start"]');
await until(async () => (await v(b)) === (await v(a)) && (await b.evaluate(() => window.__bb.ui.state.phase)) === 'play', '開始が届く');

// ---- 1) 通信を切る ----
await b.context().setOffline(true);
await b.evaluate(() => window.__bb.ui.room.client.stream?.destroy());
const tOff = await until(async () => (await net(b)) !== 'online', 'Bが切れたと気づく');
console.log(`切れたと気づく: ${tOff}ms`);
for (let i = 0; i < 4; i++) { await step(a); await sleep(150); }
const va = await v(a);
const vb = await v(b);
const blocked = await b.evaluate(() => window.__bb.commit((x) => window.__bb.K.applyAction(x, window.__bb.K.autoAction(x))));
const toast = await b.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / '));
console.log('切れている側の操作は止まる:', blocked === false && (await v(b)) === vb, `（A=${va} B=${vb}）`, toast);
console.log('「再接続中」の表示:', (await b.locator('.net.bad').count()) === 1);
// ---- つながり直す（画面を付け直したことにする）----
await b.context().setOffline(false);
await b.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const tBack = await until(async () => (await net(b)) === 'online' && (await v(b)) === (await v(a)), 'Bが追いつく');
console.log(`つながり直して追いつく: ${tBack}ms`, (await v(b)) === va);
await sleep(800);
console.log('Aの状態は巻き戻っていない:', (await v(a)) === va);

// ---- 2) 長く画面を消した（つながって見えて実は止まっている）----
await b.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await b.context().setOffline(true); // スリープ中は通信が止まる。ソケットは開いたまま（気づかない）
for (let i = 0; i < 3; i++) { await step(a); await sleep(150); }
await sleep(5500);
await b.context().setOffline(false);
const looked = await net(b);
await b.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
const tWake = await until(async () => (await net(b)) === 'online' && (await v(b)) === (await v(a)), '画面を付けたあと追いつく');
console.log(`スリープ中の見かけ: ${looked}／画面を付けてから追いつくまで: ${tWake}ms`);

// ---- 3) 読み込み直した人が受け取る状態（部屋に保存されている状態）も最新か ----
await b.reload();
await until(async () => (await b.evaluate(() => window.__bb.ui.state?.v ?? 0)) > 0, '読み込み直し');
await sleep(1500);
console.log('部屋に保存された状態も最新:', (await v(b)) === (await v(a)), `（A=${await v(a)} B=${await v(b)}）`);
console.log('ページのエラー:', errors.length ? errors : 'なし');
await browser.close();
