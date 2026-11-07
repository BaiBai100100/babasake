// 複数台のスマホを模した別々のブラウザで、実際の画面操作だけで遊ぶ
// 使い方: node test/e2e.mjs [URL]
//  シナリオA：ババ酒 人間3人＋CPU1人（公開中継サーバー経由）
//  シナリオB：記憶 第2弾 2人モード＋ゴリゴリ泥酔モード
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8765/';
const OUT = new URL('../shots/e2e/', import.meta.url).pathname;
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
  const ss = await Promise.all(pages.map(st));
  throw new Error(`timeout: ${label}\n` + ss.map((s) => JSON.stringify({ n: s.name, phase: s.phase, step: s.step, v: s.v, players: s.players.length })).join('\n'));
}
async function createVia(page, gameKey, name) {
  await page.click(`[data-g="${gameKey}"]`);
  await page.fill('#in-name', name);
  await page.click('[data-act="create"]');
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'lobby', null, { timeout: 25000 });
  return st(page);
}

if (!process.env.ONLY_B) {
// ================= シナリオA：ババ酒 3人＋CPU =================
{
  const names = ['はる', 'あお', 'みさき'];
  const host = await open(BASE, names[0]);
  const h0 = await createVia(host, 'baba', names[0]);
  console.log('A room', h0.code, 'broker', h0.broker);
  const pages = [host];
  pages.push(await open(`${BASE}?r=${h0.code}&b=${h0.broker}&name=${encodeURIComponent(names[1])}&autojoin=1`, names[1]));
  // 3人目はホームのコード入力から
  const p3 = await open(BASE, names[2]);
  await p3.evaluate((n) => localStorage.setItem('babasake:name', n), names[2]);
  await p3.reload();
  await p3.waitForTimeout(500);
  await p3.fill('#in-code', h0.code);
  await p3.click('[data-act="join-code"]');
  pages.push(p3);
  await waitAll(pages, (s) => s.phase === 'lobby' && s.players.length === 3, '3人そろう');
  await host.click('[data-act="add-cpu"]');
  await waitAll(pages, (s) => s.players.length === 4 && s.players.some((p) => p.cpu), 'CPU参加');
  await sleep(400);
  await shot(host, 'A1-lobby-host');
  await shot(pages[1], 'A2-lobby-guest');
  await host.click('[data-act="start"]');
  await waitAll(pages, (s) => s.phase === 'play', 'ゲーム開始');
  const ids = (await Promise.all(pages.map(st))).map((x) => x.me);
  const P = (pid) => pages[ids.indexOf(pid)];

  let checkedHover = false;
  const seen = new Set();
  let guard = 0;
  let cpuTurns = 0;
  let reloaded = false;
  while (true) {
    if (++guard > 1500) throw new Error('A 終わらない');
    const s = await st(host);
    if (s.phase === 'over') break;
    const actorIsCpu = s.players.find((p) => p.id === s.actor)?.cpu;
    let p = P(s.actor);
    if (actorIsCpu) {
      // CPUの番：人がやるステップならだれか（2人目）が押す
      const g = await st(pages[1]);
      if (g.iAct && g.step === 'odai') p = pages[1];
      else { cpuTurns++; await sleep(300); continue; }
    }
    const ps = await st(p);
    if (ps.v !== s.v || ps.step !== s.step) { await sleep(150); continue; }
    try {
      if (s.step === 'draw') {
        if (!checkedHover) {
          const target = P(s.target);
          const other = pages.find((x) => x !== p && x !== target);
          await p.click('.fan .card[data-act="pick-draw"] >> nth=1');
          await sleep(1200);
          const onOther = other ? await other.locator('.fan .card.sel').count() : 1;
          console.log('A 選んだカードがほかの人の画面で光る:', onOther === 1);
          await shot(p, 'A3-draw-drawer');
          if (other) await shot(other, 'A4-draw-watcher');
          checkedHover = true;
        } else {
          await p.click('.fan .card[data-act="pick-draw"] >> nth=0', { timeout: 3000 });
        }
        await p.click('[data-act="draw"]', { timeout: 3000 });
      } else if (s.step === 'choose') {
        if (!seen.has('choose')) { seen.add('choose'); await sleep(700); await shot(p, 'A5-choose'); }
        await p.click('.bigcard.tappable >> nth=0', { timeout: 3000 });
      } else if (s.step === 'odai') {
        if (await p.locator('[data-act="pick"]').count()) {
          const need = await p.evaluate(() => window.__bb.L.needCount(window.__bb.ui.state.game.pair.chosen));
          for (let k = 0; k < need; k++) await p.click(`[data-act="pick"] >> nth=${k}`);
          await p.click('[data-act="commit"]');
        } else if (await p.locator('#in-rule').count()) {
          await p.fill('#in-rule', '敬語禁止');
          await p.click('[data-act="commit"]');
        } else if (await p.locator('[data-act="commit"]').count()) {
          await p.click('[data-act="commit"]');
        } else {
          const key = actorIsCpu ? 'odai-cpu' : 'odai';
          if (!seen.has(key)) { seen.add(key); await sleep(700); await shot(p, actorIsCpu ? 'A7-odai-cpu-pressed-by-human' : 'A6-odai'); }
          if (await p.locator('[data-act="finish-drank"]').count()) await p.click('[data-act="finish-drank"]', { timeout: 3000 });
          else await p.click('[data-act="finish"]', { timeout: 3000 });
        }
      } else if (s.step === 'penalty') {
        await sleep(800);
        await shot(p, 'A8-penalty');
        await p.click('[data-act="preset"] >> nth=0');
        await p.click('[data-act="penalty"]');
      }
    } catch { await sleep(300); }
    if (!reloaded && s.step === 'draw' && guard > 15) {
      reloaded = true;
      await pages[2].reload();
      await pages[2].waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'play', null, { timeout: 20000 });
      console.log('A 再読み込みから復帰: OK');
    }
    await sleep(200);
  }
  const fin = await waitAll(pages, (x) => x.phase === 'over', 'A 全員に結果');
  await sleep(1000);
  await shot(host, 'A9-over');
  console.log('A 全員同じ結果:', fin.every((f) => f.loser === fin[0].loser && f.v === fin[0].v), '負け:', fin[0].players.find((x) => x.id === fin[0].loser)?.name, 'CPUの番を待った回数:', cpuTurns, '見た場面:', [...seen].join(','));
  console.log('A 飲む演出の回数（各スマホ）:', fin.map((f) => f.fx.count).join(' / '), '全員で出た:', fin.every((f) => f.fx.count > 0));
  for (const p of pages) await p.context().close();
}
}

// ================= シナリオB：記憶 第2弾 2人＋泥酔 =================
{
  const host = await open(BASE, 'B-はる');
  const h0 = await createVia(host, 'kioku2', 'はる');
  const guest = await open(`${BASE}?r=${h0.code}&b=${h0.broker}&name=${encodeURIComponent('あお')}&autojoin=1`, 'B-あお');
  const pages = [host, guest];
  await waitAll(pages, (s) => s.phase === 'lobby' && s.players.length === 2, 'B 2人');
  await host.click('[data-act="toggle-hard"]');
  await waitAll(pages, (s) => s.settings?.hard === true, 'B 泥酔ON反映');
  await host.click('[data-act="set-deck"][data-d="mix"]');
  await waitAll(pages, (s) => s.settings?.deck === 'mix', 'B 山札mix反映');
  await sleep(3200);
  await shot(guest, 'B1-lobby-guest');
  await host.click('[data-act="start"]');
  const s0 = await waitAll(pages, (s) => s.phase === 'play', 'B 開始');
  console.log('B 2人モード:', s0[0].duo, '泥酔:', s0[0].hard, '山札:', s0[0].remaining);
  const ids = s0.map((x) => x.me);
  const checks = { duoText: false, timer: false, water: false, none: false };
  for (let i = 0; i < 30; i++) {
    // 2台の状態がそろうまで待ってから読む
    for (let t = 0; t < 40; t++) { const [a, b] = await Promise.all(pages.map(st)); if (a.v === b.v) break; await sleep(200); }
    let s = await st(host);
    const p = pages[ids.indexOf(s.turn)];
    if (s.step === 'draw') { await p.click('[data-act="kdraw"]'); await sleep(700); s = await st(host); }
    if (s.step === 'card') {
      if (/相手|2人/.test(s.text)) checks.duoText = true;
      if (s.card === 'KW') { checks.water = true; await shot(p, 'B3-water'); }
      if (i === 2) { await sleep(500); await shot(p, 'B2-card-drawer'); await shot(pages.find((x) => x !== p), 'B2-card-other'); }
      if (await p.locator('[data-act="ktimer"]').count() && !checks.timer) {
        await p.click('[data-act="ktimer"]');
        // 公開の中継サーバー経由なので、相手の画面に届くまで最大6秒待つ（かかった時間も出す）
        const other = pages.find((x) => x !== p);
        const t0 = Date.now();
        while (Date.now() - t0 < 6000 && (await other.locator('.timer-num').count()) !== 1) await sleep(150);
        checks.timer = (await other.locator('.timer-num').count()) === 1;
        checks.timerMs = Date.now() - t0;
      }
      if (await p.locator('#in-rule').count()) { await p.fill('#in-rule', '左手で飲む'); await p.click('[data-act="kcommit"]'); }
      if (!checks.none && await p.locator('[data-act="knone"]').count()) {
        await p.click('[data-act="knone"]');
        await sleep(1500);
        const other = pages.find((x) => x !== p);
        const o = await st(other);
        checks.none = o.pot === 1 && (await other.locator('.k-notice.stock').count()) === 1;
        await shot(other, 'B5-none-notice-other');
        continue;
      }
      // 勝負・条件つきのカードは「飲んだ！」を押す（飲む演出の同期も見る）
      if (await p.locator('[data-act="kdrank"]:not([disabled])').count()) await p.click('[data-act="kdrank"]', { timeout: 4000 });
      else await p.click('[data-act="knext"]', { timeout: 4000 });
      await sleep(300);
    }
  }
  await sleep(800);
  const fin = await Promise.all(pages.map(st));
  await shot(host, 'B4-late');
  console.log('B 2台の状態が一致:', fin[0].v === fin[1].v && fin[0].n === fin[1].n, '引いた枚数:', fin[0].n, '2人用の文面:', checks.duoText, 'タイマー共有:', checks.timerMs == null ? '（タイマーのカードが出なかった）' : `${checks.timer} (${checks.timerMs}ms)`, 'チェイサー:', checks.water, 'だれもいない共有:', checks.none);
  // 飲む演出は、めくった人だけでなく相手のスマホにも出る（取りこぼし1回までは許す）
  console.log('B 飲む演出の回数（2台）:', fin.map((x) => x.fx.count).join(' / '), '両方で出た:', fin.every((x) => x.fx.count > 0) && Math.abs(fin[0].fx.count - fin[1].fx.count) <= 1);
}

console.log('コンソールエラー:', errors.length ? errors : 'なし');
await browser.close();
