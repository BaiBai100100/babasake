// マイお題：ロビーで追加 → 山札の先頭に仕込んで引く（1台モード）
// 使い方: node test/custom-e2e.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/custom/', import.meta.url).pathname;
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
const shot = async (name, full = false) => { await page.screenshot({ path: OUT + name + '.png', fullPage: full }); console.log('shot', name); };

await page.goto(BASE);
await sleep(800);
await page.click('[data-g="kioku2"]');
await page.fill('#in-name', 'はる');
await page.click('[data-act="local"]');
await page.fill('#in-add', 'あお');
await page.click('[data-act="add-local"]');
await page.fill('#in-custom', '今日いちばん最後に来た人');
await page.click('[data-act="custom-add"]');
await page.fill('#in-custom', '右どなりの人と腕を組んで一口');
await page.press('#in-custom', 'Enter');
await page.fill('#in-custom', '消すお題');
await page.click('[data-act="custom-add"]');
let s = await st();
console.log('3枚追加:', s.settings.custom.length === 3);
await page.click('[data-act="custom-del"] >> nth=2');
s = await st();
console.log('1枚消せる:', s.settings.custom.length === 2);
await page.locator('.custom-list').scrollIntoViewIfNeeded();
await shot('01-lobby-custom');
await page.click('[data-act="start"]');
await sleep(400);
const ids = s.settings.custom.map((c) => c.id);
for (const [i, id] of ids.entries()) {
  // 山札の次に引く位置（g.pos）に仕込む
  await page.evaluate((cid) => window.__bb.commit((x) => { const y = JSON.parse(JSON.stringify(x)); const g = y.game; const rest = g.deck.slice(g.pos).filter((d) => d !== cid); g.deck = [...g.deck.slice(0, g.pos), cid, ...rest]; return y; }), id);
  await sleep(200);
  await page.click('[data-act="kdraw"]');
  await sleep(900);
  s = await st();
  console.log(`マイお題${i + 1}が出る:`, s.card === id, s.text, 'hit=' + s.hit);
  await shot(`0${i + 2}-card-${s.hit ? 'hit' : 'plain'}`);
  if (s.hit) {
    await page.click('[data-act="knone"]');
    await sleep(500);
    console.log('だれもいない→貯金:', (await st()).pot === 1);
  } else {
    const b = page.locator('[data-act="knext"], [data-act="kdrank"]').first();
    await b.click();
    await sleep(500);
  }
}
console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
