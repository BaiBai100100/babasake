// トークトライアル：3台（公開中継サーバー経由）と、1台モード
// 使い方: node test/talk-e2e.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/talk/', import.meta.url).pathname;
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

// ===== 3台 =====
const host = await open(BASE, 'はる');
await shot(host, '00-hub');
await host.click('[data-g="talk"]');
await host.fill('#in-name', 'はる');
await host.click('[data-act="create"]');
await host.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'lobby', null, { timeout: 25000 });
const h0 = await st(host);
const pages = [host];
for (const n of ['あお', 'みさき']) pages.push(await open(`${BASE}?r=${h0.code}&b=${h0.broker}&name=${encodeURIComponent(n)}&autojoin=1`, n));
await waitAll(pages, (s) => s.phase === 'lobby' && s.players.length === 3, '3人そろう');
console.log('CPUボタンなし:', (await host.locator('[data-act="add-cpu"]').count()) === 0);
await host.click('[data-act="set-min"][data-m="3"]');
await waitAll(pages, (s) => s.settings?.minutes === 3, '3分反映');
await sleep(300);
await shot(host, '01-lobby');
await host.click('[data-act="start"]');
let ss = await waitAll(pages, (s) => s.phase === 'play' && s.step === 'talk', '開始');
console.log('テーマが全員同じ:', ss.every((s) => s.theme === ss[0].theme), ss[0].theme);
console.log('ミッションが全員バラバラ:', new Set(ss.map((s) => s.myMission)).size === 3);
const [pa, pb, pc] = pages;
console.log('最初は隠れている:', (await pb.locator('.t-mission.closed').count()) === 1);
await pb.click('.t-mission');
const shown = await pb.locator('.t-mission-text').innerText();
const real = await pb.evaluate(() => window.__bb.ui.state.game.missions[window.__bb.me.id]);
const realText = await pb.evaluate((i) => window.__bb.ui.state && document.querySelector('.t-mission-text').textContent, real);
console.log('タップで自分のミッションが出る:', shown.length > 5 && shown === realText);
await shot(pb, '02-mission-open');
await shot(pc, '03-mission-closed');
// あお（pb）がみさき（pc）をハズレで見破る
const ids = ss.map((s) => s.me);
const g = await pa.evaluate(() => window.__bb.ui.state.game);
const wrongForC = g.options[ids[2]].find((m) => m !== g.missions[ids[2]]);
await pb.click('[data-act="taccuse"]');
await pb.click(`[data-act="tacc-target"][data-pid="${ids[2]}"]`);
await sleep(200);
await shot(pb, '04-accuse-options');
await pb.click(`[data-act="tacc-pick"][data-m="${wrongForC}"]`);
ss = await waitAll(pages, (s) => s.notice?.kind === 'miss', 'ハズレが全員に届く');
await sleep(500);
console.log('ハズレ後、あおの見破りボタンが無効:', await pb.locator('[data-act="taccuse"]').isDisabled());
await shot(pa, '05-miss-notice');
// みさき（pc）があお（pb）を当てる
await pc.click('[data-act="taccuse"]');
await pc.click(`[data-act="tacc-target"][data-pid="${ids[1]}"]`);
await pc.click(`[data-act="tacc-pick"][data-m="${g.missions[ids[1]]}"]`);
ss = await waitAll(pages, (s) => s.status?.[ids[1]] === 'out', 'あおが脱落');
await sleep(500);
await shot(pb, '06-busted-self');
// はる（pa）が達成
await pa.click('[data-act="tachieve"]');
ss = await waitAll(pages, (s) => s.phase === 'over' && s.winner === ids[0], '達成で終了');
await sleep(1300);
console.log('結果画面にミッションが3つ並ぶ:', (await pc.locator('.t-row').count()) === 3);
await shot(pc, '07-over');
const t1 = ss[0].theme;
await pa.click('[data-act="again"]');
ss = await waitAll(pages, (s) => s.phase === 'play' && s.round === 2, '2ラウンド目');
console.log('2ラウンド目はテーマが変わる:', ss[0].theme !== t1);
for (const p of pages) await p.context().close();

// ===== 1台モード =====
const loc = await open(BASE, '1台');
await loc.click('[data-g="talk"]');
await loc.fill('#in-name', 'はる');
await loc.click('[data-act="local"]');
for (const n of ['あお', 'みさき']) { await loc.fill('#in-add', n); await loc.click('[data-act="add-local"]'); }
await loc.click('[data-act="start"]');
await sleep(400);
await shot(loc, '08-local');
await loc.click('[data-act="tpeek-who"] >> nth=1');
await loc.click('[data-act="tpeek-show"]');
await sleep(200);
await shot(loc, '09-local-peek');
await loc.click('.sheet [data-act="close-sheet"] >> nth=0');
await loc.click('[data-act="taccuse"]');
await loc.click('[data-act="tacc-by"] >> nth=0');
await loc.click('[data-act="tacc-target"] >> nth=0');
await loc.click('[data-act="tacc-pick"] >> nth=0');
await sleep(400);
const ls = await st(loc);
console.log('1台：見破りが記録される:', ls.notice && ['miss', 'busted'].includes(ls.notice.kind));
if (ls.phase === 'play') { await loc.click('[data-act="tachieve"]'); await loc.click('[data-act="tach-who"] >> nth=0'); }
await sleep(1200);
console.log('1台：達成で終了:', (await st(loc)).phase === 'over');
await shot(loc, '10-local-over');
console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
