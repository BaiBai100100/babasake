// ババ酒の♥（乾杯タイム）と♠の飲みゲー（お題はアプリが決める）を大きく表示して撮る。node test/heart.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8766/';
const OUT = new URL('../shots/heart/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 393, height: 694 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE);
await page.waitForTimeout(800);
await page.click('[data-g="baba"]');
if (await page.locator('#in-name').count()) await page.fill('#in-name', 'おす');
await page.click('[data-act="local"]'); // ババ酒の1台モードは CPU 入りのロビーになる
await page.waitForTimeout(500);
await page.click('[data-act="start"]');
await page.waitForTimeout(800);
await page.addStyleTag({ content: '#fx-layer { display: none !important; }' });
const out = {};
for (const id of ['H1', 'S6', 'S12']) {
  await page.evaluate(async (id) => {
    const { makeTopic } = await import('./games.js');
    const { ODAI } = await import('./odai.js');
    const topics = ODAI[id].game ? { [id]: makeTopic(ODAI[id].game) } : {};
    window.__bb.commit((s) => {
    const t = structuredClone(s);
    const by = t.players[0].id;
    t.game.step = 'odai';
    t.game.seq = (t.game.seq || 0) + 1;
    t.game.pair = { by, from: t.players[1].id, cards: [id, 'D2'], chosen: id, picks: [], text: null, committed: false, double: false, result: null, peek: null, topics };
    t.game.turn = null;
    return t;
    });
  }, id);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}${id}.png` });
  out[id] = await page.evaluate(() => ({
    role: document.querySelector('.bigcard .bc-role')?.textContent,
    note: document.querySelectorAll('.bc-note').length,
    img: document.querySelector('.bigcard .bc-art img')?.getAttribute('src'),
    imgLoaded: document.querySelector('.bigcard .bc-art img')?.naturalWidth > 0,
    buttons: [...document.querySelectorAll('[data-act="finish"], [data-act="finish-drank"]')].map((b) => b.innerText.replace(/\s+/g, ' ')),
    text: document.querySelector('.bigcard .bc-text')?.textContent,
    topic: document.querySelector('.bigcard .bc-text .topic')?.textContent,
    topicMarks: document.querySelectorAll('.bigcard .bc-text .topic').length,
  }));
}
console.log(JSON.stringify(out, null, 1));
// ♥は乾杯（すぐ飲む）。♠の偶数は飲みゲー：お題（頭文字と文字数）が出ていて、負けた人が飲むので「飲んだ！／セーフ」
const game = (o) => o.role === '勝負と飲みゲー' && o.imgLoaded && o.topic && o.topicMarks === 1 && !/\{お題\}|？？？/.test(o.text)
  && o.buttons.some((t) => t.includes('飲んだ')) && o.buttons.some((t) => t.includes('セーフ'));
const ok = out.H1.role === '乾杯タイム' && out.H1.imgLoaded && !out.H1.topic && out.H1.buttons.some((t) => t.includes('やった'))
  && game(out.S6) && /^『[ぁ-ゖ]』で始まる[2-5]文字の言葉$/.test(out.S6.topic)
  && game(out.S12) && /^(『[ぁ-ゖ]』[2-5]文字→?){3}$/.test(out.S12.topic);
console.log('♥乾杯・♠飲みゲー:', ok, 'コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
