// NGワードゲーム：3台（公開中継サーバー経由）
// 使い方: node test/ng-e2e.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { NG_WORDS } from '../ng-data.js';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/ng/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = async (p) => JSON.parse(await p.evaluate(() => window.render_game_to_text()));
const shot = async (p, name) => { await p.screenshot({ path: OUT + name + '.png' }); console.log('shot', name); };
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
async function waitAll(pages, pred, label, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ss = await Promise.all(pages.map(st));
    if (ss.every(pred)) return ss;
    await sleep(200);
  }
  throw new Error('timeout: ' + label + '\n' + JSON.stringify(await Promise.all(pages.map(st))).slice(0, 800));
}

const host = await open(BASE, 'はる');
await host.click('[data-g="ng"]');
await sleep(300);
console.log('1台モードのボタンなし:', (await host.locator('[data-act="local"]').count()) === 0);
await shot(host, '00-setup');
await host.fill('#in-name', 'はる');
await host.click('[data-act="create"]');
await host.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'lobby', null, { timeout: 25000 });
const h0 = await st(host);
const pages = [host];
for (const n of ['あお', 'みさき']) pages.push(await open(`${BASE}?r=${h0.code}&b=${h0.broker}&name=${encodeURIComponent(n)}&autojoin=1`, n));
await waitAll(pages, (s) => s.phase === 'lobby' && s.players.length === 3, '3人そろう');
await host.click('[data-act="set-min"][data-m="3"]');
await waitAll(pages, (s) => s.settings?.minutes === 3, '3分');
await host.click('[data-act="start"]');
let ss = await waitAll(pages, (s) => s.phase === 'play' && s.words, '開始');
await sleep(400);
ss = await Promise.all(pages.map(st));
const ids = ss[0].players.map((p) => p.id);
const words = ss[0].words;
// 自分のワードは見えず、ほかの2人のワードだけが見える
for (const [i, s] of ss.entries()) {
  const vis = s.visibleWords;
  const myWord = NG_WORDS[words[s.me]];
  const others = ids.filter((pid) => pid !== s.me).map((pid) => NG_WORDS[words[pid]]);
  console.log(`${i + 1}台目：ほかの2人のワードだけ見える・自分のは見えない:`, vis.length === 2 && others.every((w) => vis.includes(w)) && !vis.includes(myWord), JSON.stringify(vis));
}
await shot(pages[1], '01-play');
// あお（1）が、みさき（2）の「言った！」を押す。同時にはる（0）も押す
const w2 = words[ids[2]];
await Promise.all([
  pages[1].click(`[data-act="ngout"][data-pid="${ids[2]}"]`),
  pages[0].click(`[data-act="ngout"][data-pid="${ids[2]}"]`),
]);
ss = await waitAll(pages, (s) => s.outs?.[ids[2]] >= 1, 'みさき1回');
await sleep(2500);
ss = await Promise.all(pages.map(st));
console.log('同時に押しても1回だけ:', ss.every((s) => s.outs[ids[2]] === 1), JSON.stringify(ss.map((s) => s.outs[ids[2]])));
console.log('みさきのワードが替わった:', ss[0].words[ids[2]] !== w2);
console.log('全員に通知:', ss.every((s) => s.notice?.kind === 'out' && s.notice.target === ids[2]));
await shot(pages[2], '02-after-out-target');
await shot(pages[0], '03-after-out-other');
// 本人の画面に、新しいワードが出ていない
const newWord = NG_WORDS[(await st(pages[0])).words[ids[2]]];
const leak = (await st(pages[2])).visibleWords.includes(newWord);
console.log('本人には新しいワードが見えない:', !leak);
// ホストが終える
await host.click('[data-act="menu"]');
await host.click('[data-act="tend"]');
ss = await waitAll(pages, (s) => s.phase === 'over', '終了');
await sleep(1300);
console.log('いちばん言った人＝みさき:', JSON.stringify(ss[0].worst) === JSON.stringify([ids[2]]));
console.log('結果に全員の行:', (await pages[2].locator('.t-row').count()) === 3);
await shot(pages[2], '04-over');
await host.click('[data-act="again"]');
ss = await waitAll(pages, (s) => s.phase === 'play' && s.round === 2, '2ラウンド目');
console.log('2ラウンド目は回数リセット:', Object.values(ss[0].outs).every((n) => n === 0));
console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
