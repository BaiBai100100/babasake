// 貯金があるときに「全員で乾杯」のカードが出たら、全員がひとりずつ貯金ぶんを受ける。node test/toast.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/toast/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const st = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: OUT + name + '.png' }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(BASE);
await page.waitForTimeout(1200);
await page.click('[data-g="kioku1"]');
await page.fill('#in-name', 'はる');
await page.click('[data-act="local"]');
for (const n of ['あお', 'みさき']) { await page.fill('#in-add', n); await page.click('[data-act="add-local"]'); }
await page.click('[data-act="start"]');
await sleep(800);

// 山札の次に「当てはまり2枚 → 全員で乾杯」を仕込む
await page.evaluate(() => window.__bb.commit((s) => {
  const t = JSON.parse(JSON.stringify(s));
  t.game.deck.splice(t.game.pos, 0, 'K1-01', 'K1-02', 'K1-33');
  return t;
}));

const results = {};
for (let i = 0; i < 2; i++) {
  await page.click('[data-act="kdraw"]');
  await sleep(700);
  await page.click('[data-act="knone"]');
  await sleep(500);
}
results.potBefore = (await st()).pot;
await page.click('[data-act="kdraw"]');
await sleep(800);
const s1 = await st();
results.card = s1.card;
results.toastFlag = s1.toast;
results.foot = (await page.locator('.k-foot').first().textContent().catch(() => null))?.trim() ?? null;
await shot('T1-toast-card');
await page.click('[data-act="knext"]');
await sleep(1500);
const s2 = await st();
results.potAfter = s2.pot;
results.notice = s2.notice;
results.noticeVisible = await page.locator('.k-notice.kanpai').isVisible();
results.noticeText = (await page.locator('.k-notice').first().textContent().catch(() => null))?.trim() ?? null;
await shot('T2-toast-notice');

const ok = results.potBefore === 2 && results.card === 'K1-33' && results.toastFlag === true
  && results.potAfter === 0 && results.notice?.kind === 'kanpai' && results.notice?.mult === 3
  && results.noticeVisible && /全員ひとりずつ三口飲む/.test(results.noticeText || '') && /全員ひとりずつ → 三口飲む/.test(results.foot || '');
console.log(JSON.stringify(results));
console.log('乾杯で全員ひとりずつ精算:', ok);
console.log('コンソールエラー:', errors.length ? errors.join(' / ') : 'なし');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
