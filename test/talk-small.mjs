// トークトライアル：小さい画面（375×560）で収まるか
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = '/Users/100dodo/dev/babasake/shots/talk/';
const browser = await chromium.launch({ channel: 'chromium' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url, vp) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto(url);
  await sleep(600);
  return p;
}
const st = async (p) => JSON.parse(await p.evaluate(() => window.render_game_to_text()));
const vp = { width: 375, height: 560 };
const host = await open(BASE, vp);
await host.click('[data-g="talk"]');
await sleep(300);
await host.screenshot({ path: OUT + 's0-setup.png' });
await host.fill('#in-name', 'はる');
await host.click('[data-act="create"]');
await host.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'lobby', null, { timeout: 25000 });
const h = await st(host);
const pages = [host];
for (const n of ['あおい', 'みさき', 'たける']) pages.push(await open(`${BASE}?r=${h.code}&b=${h.broker}&name=${encodeURIComponent(n)}&autojoin=1`, vp));
for (let i = 0; i < 100; i++) { if ((await st(host)).players.length === 4) break; await sleep(250); }
await host.click('[data-act="start"]');
for (let i = 0; i < 100; i++) { const ss = await Promise.all(pages.map(st)); if (ss.every((s) => s.step === 'talk')) break; await sleep(250); }
const p = pages[1];
await p.click('.t-mission');
await sleep(300);
const m = async (pg) => pg.evaluate(() => { const s = document.querySelector('.k-stage'); return { over: s.scrollHeight - s.clientHeight, cls: s.className }; });
console.log('open', await m(p));
await p.screenshot({ path: OUT + 's1-open.png' });
// ハズレのお知らせを出す
const g = await host.evaluate(() => window.__bb.ui.state.game);
const ids = (await st(host)).players.map((x) => x.id);
const wrong = g.options[ids[2]].find((x) => x !== g.missions[ids[2]]);
await pages[3].click('[data-act="taccuse"]');
await pages[3].click(`[data-act="tacc-target"][data-pid="${ids[2]}"]`);
await sleep(200);
await pages[3].screenshot({ path: OUT + 's2-accuse.png' });
await pages[3].click(`[data-act="tacc-pick"][data-m="${wrong}"]`);
for (let i = 0; i < 60; i++) { if ((await st(p)).notice?.kind === 'miss') break; await sleep(250); }
await sleep(2600);
console.log('notice', await m(p), (await st(p)).notice);
await p.screenshot({ path: OUT + 's3-notice.png' });
await host.click('[data-act="tachieve"]');
for (let i = 0; i < 60; i++) { if ((await st(p)).phase === 'over') break; await sleep(250); }
await sleep(1500);
console.log('over', (await st(p)).phase);
await p.screenshot({ path: OUT + 's4-over.png' });
await browser.close();
