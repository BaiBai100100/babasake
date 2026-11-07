// 記憶のカード画面が、どのカードでもスクロールなしで1画面に収まるか
// node test/fit.mjs [URL]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { KIOKU_BY_ID } from '../kioku-data.js';

const BASE = process.argv[2] || 'http://localhost:8766/';
const OUT = new URL('../shots/fit/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
// iPhone SE / 12〜16 / Pro Max の Safari（ツールバー表示中）と Android の小さめ
const SIZES = [[375, 548], [360, 640], [390, 664], [393, 694], [430, 740]];
const IDS = Object.keys(KIOKU_BY_ID);
const browser = await chromium.launch({ channel: 'chromium' });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(players) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE);
  await page.waitForTimeout(800);
  await page.click('[data-g="kioku2"]');
  await page.fill('#in-name', 'おす');
  await page.click('[data-act="local"]');
  for (const n of players) { await page.fill('#in-add', n); await page.click('[data-act="add-local"]'); }
  await page.click('[data-act="start"]');
  await sleep(600);
  // 飲む演出の画面ゆれ（transform）は計測のじゃまなので止める
  // カードのめくりアニメ（transform）も止める：途中だと scrollHeight が見かけで増える。fitStage 自体は transform の影響を受けない
  await page.addStyleTag({ content: '#fx-layer { display: none !important; } body .game, .k-card { animation: none !important; }' });
  return page;
}

async function measure(page, id) {
  await page.evaluate((id) => window.__bb.commit((s) => {
    const t = structuredClone(s);
    const g = t.game;
    const c = window.__bb.K.cardView(id, g);
    Object.assign(g, { step: 'card', card: id, n: g.n + 1, picks: [], text: null, timer: null, committed: !c.need, pot: 3 });
    return t;
  }), id);
  await page.waitForTimeout(30);
  return page.evaluate(() => {
    const st = document.querySelector('.k-stage');
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const stage = st.getBoundingClientRect();
    const body = r('.k-body');
    const acts = r('.k-actions');
    const ctl = r('.k-ctl');
    return {
      over: Math.round(st.scrollHeight - st.clientHeight),
      bodyCut: Math.round(body.bottom - stage.bottom),
      ctlCut: Math.round((ctl?.bottom ?? 0) - stage.bottom),
      actCut: Math.round(acts.bottom - innerHeight),
      art: Math.round(r('.k-art')?.height ?? 0),
      font: parseFloat(getComputedStyle(document.querySelector('.k-text')).fontSize),
    };
  });
}

const fails = [];
const summary = [];
for (const [label, players] of [['2人', ['めふ']], ['3人', ['めふ', 'よろ']], ['6人', ['めふ', 'よろ', 'たか', 'みさき', 'ゆう']]]) {
  const page = await setup(players);
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    let worst = { over: -1 };
    let minArt = Infinity;
    let minFont = Infinity;
    let bad = 0;
    for (const id of IDS) {
      const m = await measure(page, id);
      minArt = Math.min(minArt, m.art);
      minFont = Math.min(minFont, m.font);
      if (m.over > 1 || m.bodyCut > 1 || m.ctlCut > 1 || m.actCut > 1) {
        bad++;
        if (fails.length < 400) fails.push({ label, size: `${w}x${h}`, id, ...m });
      }
      if (m.over > worst.over) worst = { id, ...m };
    }
    summary.push(`${label} ${w}x${h}: はみ出し ${bad}/${IDS.length}枚, 最大 ${Math.max(0, worst.over)}px (${worst.id}), 絵の最小 ${minArt}px, 文字の最小 ${minFont}px`);
    // 指摘されたカード（30秒以内に誕生日）と、いちばん長いカードを撮る
    for (const id of ['K2-33', 'K2-16']) {
      await measure(page, id);
      await sleep(900); // めくりアニメと書体の読み込みが終わってから撮る
      await page.screenshot({ path: `${OUT}${label}-${w}x${h}-${id}.png` });
      // 絵を縮めたのに下が大きく空いている（縮めすぎ）はだめ
      const slack = await page.evaluate(() => {
        const st = document.querySelector('.k-stage');
        const art = [...st.querySelectorAll('.k-art.squeezed')].find((a) => a.offsetHeight > 0);
        const last = [...st.children].filter((e) => e.offsetParent).pop();
        const pad = parseFloat(getComputedStyle(st).paddingBottom);
        return art ? Math.round(st.getBoundingClientRect().bottom - pad - last.getBoundingClientRect().bottom) : 0;
      });
      if (slack > 12) fails.push({ label, size: `${w}x${h}`, id, slack });
      summary.push(`  ${id}: 絵を縮めたあとの余り ${slack}px`);
    }
  }
  await page.context().close();
}
console.log(summary.join('\n'));
if (fails.length) console.log('はみ出し例:', JSON.stringify(fails.slice(0, 8)));
console.log('1画面に収まる:', fails.length === 0);
console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
process.exit(fails.length || errors.length ? 1 : 0);
