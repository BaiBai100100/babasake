// バグ修正の確認：同時押し・シートを開いたままロビーへ・次のラウンドのミッション・ロビーで外した人・中継サーバー経由の差し込み
// 使い方: node test/robust.mjs [URL]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8765/';
const browser = await chromium.launch({ channel: 'chromium' });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await page.waitForTimeout(600);
  return page;
}
const st = async (p) => JSON.parse(await p.evaluate(() => window.render_game_to_text()));
async function until(fn, label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return; await sleep(150); }
  throw new Error('timeout: ' + label);
}
async function room(kind, names) {
  const a = await open(BASE, names[0]);
  await a.click(`[data-g="${kind}"]`);
  await a.fill('#in-name', names[0]);
  await a.click('[data-act="create"]');
  await a.waitForFunction(() => JSON.parse(window.render_game_to_text()).phase === 'lobby', null, { timeout: 25000 });
  const h = await st(a);
  const ps = [a];
  for (const n of names.slice(1)) ps.push(await open(`${BASE}?r=${h.code}&b=${h.broker}&name=${encodeURIComponent(n)}&autojoin=1`, n));
  await until(async () => (await st(a)).players.length === names.length, '全員そろう');
  return ps;
}

// ===== NG：2人がほぼ同時に別の人の「言った！」 =====
{
  const [a, b, c] = await room('ng', ['はる', 'あお', 'みさき']);
  await a.click('[data-act="start"]');
  await until(async () => (await st(c)).phase === 'play' && (await st(b)).phase === 'play', '開始');
  const ids = (await st(a)).players.map((p) => p.id);
  const w = (await st(a)).words;
  // A は B を、B は C を、同じ版から同時に
  await Promise.all([
    a.evaluate(([t, x]) => window.__bb.commit((s) => window.__bb.N.callOut(s, window.__bb.me.id, t, x)), [ids[1], w[ids[1]]]),
    b.evaluate(([t, x]) => window.__bb.commit((s) => window.__bb.N.callOut(s, window.__bb.me.id, t, x)), [ids[2], w[ids[2]]]),
  ]);
  await sleep(3500);
  const outs = await Promise.all([a, b, c].map(async (p) => (await st(p)).outs));
  const ok = outs.every((o) => o[ids[1]] === 1 && o[ids[2]] === 1);
  console.log('同時押し：両方とも数えられて、3台で一致:', ok, JSON.stringify(outs.map((o) => [o[ids[1]], o[ids[2]]])));
  for (const p of [a, b, c]) await p.context().close();
}

// ===== トーク：シートを開いたままロビーへ／次のラウンドのミッションは閉じている =====
{
  const [a, b] = await room('talk', ['はる', 'あお', 'みさき']).then((ps) => [ps[0], ps[1], ps[2]]);
  await a.click('[data-act="start"]');
  await until(async () => (await st(b)).phase === 'play', '開始');
  await b.click('.t-mission');
  await b.click('[data-act="taccuse"]');
  await sleep(300);
  // ホストがラウンドを終えて、ロビーへ
  await a.evaluate(() => window.__bb.commit((x) => window.__bb.T ? x : x));
  await a.evaluate(() => { const { commit } = window.__bb; return commit((x) => { const y = structuredClone(x); y.phase = 'over'; y.game.step = 'over'; return y; }); });
  await until(async () => (await st(b)).phase === 'over', '終了が届く');
  await a.click('[data-act="again"]');
  await until(async () => (await st(b)).round === 2, '2ラウンド目');
  await sleep(500);
  console.log('次のラウンドのミッションは閉じている（ホスト以外）:', (await b.locator('.t-mission.closed').count()) === 1);
  await b.click('[data-act="taccuse"]');
  await a.evaluate(() => window.__bb.commit((x) => window.__bb.L.backToLobby(x)));
  await until(async () => (await st(b)).phase === 'lobby', 'ロビーが届く');
  await sleep(500);
  const okLobby = await b.evaluate(() => !!document.querySelector('.lobby') && !document.querySelector('.sheet'));
  console.log('見破りシートを開いたままロビーに戻っても止まらない:', okLobby);
  // ロビーで B を外す → 戻ってこない → ボタンで入り直せる
  const bid = (await st(b)).me;
  await a.click(`[data-act="kick"][data-pid="${bid}"]`);
  await sleep(2500);
  console.log('ロビーで外した人は勝手に戻らない:', !(await st(a)).players.some((p) => p.id === bid));
  console.log('外された人には「もう一度参加する」:', (await b.locator('[data-act="rejoin"]').count()) === 1);
  await b.click('[data-act="rejoin"]');
  await until(async () => (await st(a)).players.some((p) => p.id === bid), '入り直し');
  console.log('ボタンで入り直せる: true');

  // ===== 中継サーバー経由の差し込み =====
  const before = (await st(b)).v;
  await a.evaluate(() => {
    const r = window.__bb.ui.room;
    const s = structuredClone(window.__bb.ui.state);
    s.v += 1;
    s.ts = Date.now();
    s.players[0].name = '<img src=x onerror="window.__xss=1">';
    s.settings.minutes = '"><img src=x onerror="window.__xss=2">';
    r.client.publish(r.topic('state'), JSON.stringify(s), { qos: 1, retain: true });
    // id に引用符を入れた状態（受け取らないこと）
    const bad = structuredClone(s);
    bad.v += 1;
    bad.players[0].id = 'x" onclick="window.__xss=3';
    r.client.publish(r.topic('state'), JSON.stringify(bad), { qos: 1, retain: false });
  });
  await sleep(1500);
  const xss = await b.evaluate(() => window.__xss ?? null);
  const vb = (await st(b)).v;
  console.log('差し込んだ HTML は動かない:', xss === null, '／怪しい id の状態は受け取らない:', vb === before + 1, `（v ${before}→${vb}）`);
}
console.log('ページのエラー:', errors.length ? errors : 'なし');
await browser.close();
