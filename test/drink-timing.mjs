// 指摘された K2-36（2人でポーズ）を2台で再現。公開URLにも同じテストを使う。
// node test/drink-timing.mjs [URL]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8766/';
const OUT = new URL('../shots/drink-timing/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
const pages = [];
const errors = [];
const state = (p) => p.evaluate(() => JSON.parse(window.render_game_to_text()));
const counts = () => Promise.all(pages.map(async (p) => (await state(p)).fx.count));
const delta = (before, after) => after.map((n, i) => n - before[i]);
async function open(url) {
  const c = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ja-JP' });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(url);
  await p.waitForFunction(() => !!window.__bb);
  pages.push(p);
  return p;
}
async function sync() {
  // ゲスト操作直後のホストはまだ前の版のことがある。片方の版を固定せず、両方が一致するまで待つ。
  for (let i = 0; i < 150; i++) {
    const ss = await Promise.all(pages.map(state));
    if (ss.every((s) => s.v === ss[0].v)) {
      await pages[0].waitForTimeout(400);
      return;
    }
    await pages[0].waitForTimeout(200);
  }
  throw new Error('同期タイムアウト: ' + JSON.stringify(await Promise.all(pages.map(state))));
}
async function actor() {
  const s = await state(pages[0]);
  for (const p of pages) if ((await state(p)).me === s.turn) return p;
  throw new Error('担当者が見つからない');
}
async function draw() {
  await (await actor()).click('[data-act="kdraw"]');
  await sync();
}
try {
  const host = await open(BASE);
  await host.click('[data-g="kioku2"]');
  await host.fill('#in-name', '演出テストA');
  await host.click('[data-act="create"]');
  await host.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'lobby');
  const lobby = await state(host);
  const guest = await open(`${BASE}?r=${lobby.code}&b=${lobby.broker}&name=${encodeURIComponent('演出テストB')}&autojoin=1`);
  await Promise.all(pages.map((p) => p.waitForFunction(() => JSON.parse(window.render_game_to_text()).players.length === 2)));
  await host.click('[data-act="start"]');
  await sync();
  await host.evaluate(() => window.__bb.commit((s) => {
    const t = structuredClone(s);
    t.game.deck = ['K2-36', 'K2-36', 'K1-33', 'K2-36', 'K1-01'];
    t.game.pos = 0;
    return t;
  }));
  await sync();

  let before = await counts();
  await draw();
  assert.equal((await state(host)).duo, true);
  assert.match((await state(host)).text, /崩れた方/);
  const reveal = delta(before, await counts());
  console.log('ポーズ勝負をめくった時の演出回数（2台）:', reveal);
  assert.deepEqual(reveal, [0, 0], '勝負の結果前に飲む演出を出さない');
  const p = await actor();
  for (const [width, height] of [[390, 780], [375, 560], [430, 830]]) {
    await p.setViewportSize({ width, height });
    for (const act of ['kdrank', 'knext']) {
      const b = await p.locator(`[data-act="${act}"]`).boundingBox();
      assert.ok(b && b.y >= 0 && b.y + b.height <= height + 1, `${act} が ${width}x${height} で画面内`);
    }
    await p.screenshot({ path: `${OUT}pose-${width}x${height}.png` });
  }
  // タイマーはフッターに隠れていてもスクロールして操作でき、開始だけでは飲む演出は出さない。
  await p.click('[data-act="ktimer"]');
  await sync();
  for (const phone of pages) assert.equal(await phone.locator('.timer-num').count(), 1);
  assert.deepEqual(delta(before, await counts()), [0, 0]);
  await p.click('[data-act="kdrank"]');
  await sync();
  console.log('飲んだ！の演出回数（2台）:', delta(before, await counts()));
  assert.deepEqual(delta(before, await counts()), [1, 1]);
  await guest.reload();
  await guest.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'play');
  assert.equal((await state(guest)).fx.count, 0, '再読込で過去の演出を再生しない');

  before = await counts();
  await draw();
  await (await actor()).click('[data-act="knext"]'); // セーフ。前のlastDrinkがあっても再生しない
  await sync();
  assert.deepEqual(delta(before, await counts()), [0, 0]);
  console.log('セーフの演出回数（2台）:', delta(before, await counts()));

  before = await counts();
  await draw(); // 全員乾杯は結果待ち不要
  assert.deepEqual(delta(before, await counts()), [1, 1]);
  await (await actor()).click('[data-act="knext"]');
  await sync();
  assert.deepEqual(delta(before, await counts()), [1, 1], '乾杯の完了では重複再生しない');
  console.log('全員乾杯はめくった時だけ（2台）:', delta(before, await counts()));

  before = await counts();
  await draw();
  assert.deepEqual(delta(before, await counts()), [0, 0]);
  await (await actor()).click('[data-act="kdrank"]');
  await sync();
  assert.deepEqual(delta(before, await counts()), [1, 1], '次の勝負でも1回ずつ出る');
  assert.deepEqual(errors, []);
  console.log('ポーズ勝負・確定後演出・セーフ・再読込・2端末同期・3画面サイズ: OK');
  console.log('コンソールエラー: なし');
} finally {
  await browser.close();
}
