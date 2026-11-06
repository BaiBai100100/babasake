// 4台のスマホを模した別々のブラウザで、実際の画面操作だけで1ゲーム最後まで遊ぶ
// 使い方: node test/e2e.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const NAMES = ['はる', 'あお', 'みさき', 'けん'];

const browser = await chromium.launch({ channel: 'chromium' });
const errors = [];
const pages = [];
async function open(url, i) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 750 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${NAMES[i]}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${NAMES[i]}] ${e.message}`));
  await page.goto(url);
  return page;
}
const st = async (p) => JSON.parse(await p.evaluate(() => window.render_game_to_text()));
const shot = async (p, name) => { await p.screenshot({ path: OUT + name + '.png' }); console.log('shot', name); };
async function waitAll(pred, label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ss = await Promise.all(pages.map(st));
    if (ss.every(pred)) return ss;
    await new Promise((r) => setTimeout(r, 200));
  }
  const ss = await Promise.all(pages.map(st));
  throw new Error(`timeout: ${label}\n` + ss.map((s) => JSON.stringify({ n: s.name, phase: s.phase, step: s.step, v: s.v, players: s.players.length })).join('\n'));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. ホスト：部屋を作る
const host = await open(BASE, 0);
pages.push(host);
await host.waitForTimeout(800);
await shot(host, '01-home');
await host.fill('#in-name', NAMES[0]);
await host.click('[data-act="create"]');
await host.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'lobby', null, { timeout: 20000 });
const h0 = await st(host);
console.log('room', h0.code, 'broker', h0.broker);

// 2. 3人がリンクから参加（1人は手入力のコードで参加）
for (let i = 1; i < 4; i++) {
  if (i === 3) {
    const p = await open(BASE, i);
    pages.push(p);
    await p.fill('#in-name', NAMES[i]);
    await p.fill('#in-code', h0.code);
    await p.click('[data-act="join"]');
  } else {
    pages.push(await open(`${BASE}?r=${h0.code}&b=${h0.broker}&name=${encodeURIComponent(NAMES[i])}&autojoin=1`, i));
  }
}
await waitAll((s) => s.phase === 'lobby' && s.players.length === 4, '4人そろう', 30000);
await host.waitForTimeout(400);
await shot(host, '02-lobby-host');
await shot(pages[1], '03-lobby-guest');

// 席の並べ替え（ホスト）：3番目を上へ
const before = (await st(host)).players.map((p) => p.name);
await host.click('[data-act="move"][data-d="-1"] >> nth=2');
await waitAll((s) => s.players[1]?.name === before[2] && s.players[2]?.name === before[1], '並べ替え反映');
console.log('並べ替え: OK', before.join('→'), '⇒', (await st(pages[3])).players.map((p) => p.name).join('→'));

// 3. スタート
await host.click('[data-act="start"]');
await waitAll((s) => s.phase === 'play', 'ゲーム開始');
await sleep(500);

// 4. 引く人がカードを選ぶ → 相手の画面でも光るか
let s = await st(host);
const pageOf = (pid) => pages[(s.players.findIndex((p) => p.id === pid) >= 0) ? pagesIds.indexOf(pid) : -1];
const pagesIds = (await Promise.all(pages.map(st))).map((x) => x.me);
const P = (pid) => pages[pagesIds.indexOf(pid)];
const drawer = P(s.turn);
const target = P(s.target);
const other = pages.find((p) => p !== drawer && p !== target);

// 引かれる側がカードを1枚浮かせる
await target.click('.hand-row .card >> nth=0');
await target.click('[data-act="raise"]');
await sleep(1200);
const raisedOnDrawer = await drawer.locator('.fan .card.raised').count();
console.log('浮かせたカードが引く人の画面に見える:', raisedOnDrawer === 1);

await drawer.click('.fan .card >> nth=1');
await sleep(1200);
const hoverOnTarget = await target.locator('.fan .card.sel').count();
const hoverOnOther = await other.locator('.fan .card.sel').count();
console.log('選んだカードが相手の画面で光る:', hoverOnTarget === 1, '／他の人の画面でも:', hoverOnOther === 1);
await shot(drawer, '04-draw-drawer');
await shot(target, '05-draw-target');
await shot(other, '06-draw-other');

// 小さい画面でも「引く」ボタンが画面内に収まるか
for (const [w, hgt] of [[375, 560], [430, 830]]) {
  await drawer.setViewportSize({ width: w, height: hgt });
  await sleep(300);
  await drawer.click('.fan .card >> nth=0');
  const fit = await drawer.evaluate(() => {
    const b = document.querySelector('[data-act="draw"]').getBoundingClientRect();
    return { bottom: Math.round(b.bottom), inner: innerHeight, overflowX: document.documentElement.scrollWidth > innerWidth };
  });
  console.log(`${w}x${hgt}: 引くボタン下端 ${fit.bottom} / 画面 ${fit.inner}`, fit.bottom <= fit.inner ? 'OK' : 'はみ出し', fit.overflowX ? '横はみ出しあり' : '横OK');
  await shot(drawer, `04b-draw-${w}x${hgt}`);
}
await drawer.setViewportSize({ width: 390, height: 750 });

// 5. 実際の画面操作だけで最後まで進める
const seen = new Set();
let guard = 0;
let reloaded = false;
while (true) {
  if (++guard > 900) throw new Error('終わらない');
  s = await st(host);
  if (s.phase === 'over') break;
  const p = P(s.actor);
  const ps = await st(p);
  if (ps.v !== s.v || ps.step !== s.step) { await sleep(150); continue; }
  try {
    if (s.step === 'draw') {
      await p.click('.fan .card[data-act="pick-draw"] >> nth=0', { timeout: 3000 });
      await p.click('[data-act="draw"]', { timeout: 3000 });
    } else if (s.step === 'choose') {
      if (!seen.has('choose')) { seen.add('choose'); await sleep(700); await shot(p, '07-choose-actor'); await shot(P(s.players.find((x) => x.id !== s.actor).id), '08-choose-watcher'); }
      await p.click('.bigcard.tappable >> nth=0', { timeout: 3000 });
    } else if (s.step === 'odai') {
      if (await p.locator('[data-act="pick"]').count()) {
        const need = await p.evaluate(() => window.__bb.L.needCount(window.__bb.ui.state.game.pair.chosen));
        for (let k = 0; k < need; k++) await p.click(`[data-act="pick"] >> nth=${k}`);
        if (!seen.has('pick')) { seen.add('pick'); await shot(p, '09-odai-pick'); }
        await p.click('[data-act="commit"]');
      } else if (await p.locator('#in-rule').count()) {
        await p.fill('#in-rule', '敬語禁止');
        if (!seen.has('rule')) { seen.add('rule'); await shot(p, '10-odai-rule'); }
        await p.click('[data-act="commit"]');
      } else if (await p.locator('[data-act="commit"]').count()) {
        await p.click('[data-act="commit"]');
      } else {
        if (!seen.has('odai')) { seen.add('odai'); await sleep(700); await shot(p, '11-odai'); }
        await p.click('[data-act="finish"]', { timeout: 3000 });
      }
    } else if (s.step === 'penalty') {
      await sleep(900);
      await shot(p, '12-penalty-actor');
      await p.click('[data-act="preset"] >> nth=0');
      await p.click('[data-act="penalty"]');
    }
  } catch (e) {
    await sleep(300);
  }
  // 途中で1人がページを再読み込みしても復帰できるか
  if (!reloaded && s.step === 'draw' && guard > 12) {
    reloaded = true;
    const victim = pages[2];
    await victim.reload();
    await victim.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'play', null, { timeout: 20000 });
    console.log('再読み込みから復帰: OK');
  }
  await sleep(250);
}
const finals = await waitAll((x) => x.phase === 'over', '全員に結果が出る');
await sleep(1000);
await shot(host, '13-over-host');
await shot(pages[1], '14-over-guest');
const loser = finals[0].loser;
console.log('全員同じ結果:', finals.every((f) => f.loser === loser && f.v === finals[0].v), '負け:', finals[0].players.find((x) => x.id === loser)?.name, '罰:', finals[0].penalty);
const loserHand = await host.evaluate((id) => window.__bb.ui.state.game.hands[id], loser);
console.log('負けた人の手札:', loserHand);

// 6. もう一回
await host.click('[data-act="again"]');
await waitAll((x) => x.phase === 'play' && x.round === 2, '2戦目開始');
console.log('2戦目開始: OK');
await shot(pages[3], '15-round2');

console.log('見た場面:', [...seen].join(','));
console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
