import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';
import * as T from '../talk.js';
import { MISSIONS, THEMES } from '../talk-data.js';

function rng(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; }
function room(n, settings = {}) {
  let s = L.makeRoomState('TEST', { id: 'p0', name: 'P0' }, 0, 'talk', settings);
  for (let i = 1; i < n; i++) s = L.addPlayer(s, { id: 'p' + i, name: 'P' + i });
  return s;
}

test('お題データ：重複なし・十分な数', () => {
  assert.equal(new Set(MISSIONS).size, MISSIONS.length);
  assert.equal(new Set(THEMES).size, THEMES.length);
  assert.ok(MISSIONS.length >= 50 && THEMES.length >= 30);
});

test('全員に別々のミッション。3択は本物を含み重複なし（10人でも）', () => {
  for (let seed = 1; seed < 60; seed++) {
    const n = 2 + (seed % 9);
    const s = T.startGame(room(n), rng(seed));
    const ms = Object.values(s.game.missions);
    assert.equal(new Set(ms).size, n);
    for (const p of s.players) {
      const o = s.game.options[p.id];
      assert.equal(o.length, 3);
      assert.equal(new Set(o).size, 3);
      assert.ok(o.includes(s.game.missions[p.id]));
      // ダミーにほかの人の本物ミッションは混ざらない（情報が漏れない）
      for (const x of o) if (x !== s.game.missions[p.id]) assert.ok(!ms.includes(x));
    }
  }
});

test('見破り：当たればバレて脱落、外れたらチャンス消費。1人1回', () => {
  let s = T.startGame(room(3), rng(3));
  const g = s.game;
  const wrong = g.options.p1.find((x) => x !== g.missions.p1);
  s = T.accuse(s, 'p0', 'p1', wrong);
  assert.equal(s.game.notice.kind, 'miss');
  assert.equal(s.game.status.p1, 'play');
  assert.throws(() => T.accuse(s, 'p0', 'p2', s.game.missions.p2), /1ラウンド1回/);
  s = T.accuse(s, 'p2', 'p1', s.game.missions.p1);
  assert.equal(s.game.notice.kind, 'busted');
  assert.equal(s.game.status.p1, 'out');
  assert.throws(() => T.achieve(s, 'p1'), /バレた人/);
  assert.throws(() => T.accuse(s, 'p1', 'p0', s.game.missions.p0), /バレた人/);
});

test('最後の1人になったら逃げ切りで勝ち', () => {
  let s = T.startGame(room(2), rng(5));
  s = T.accuse(s, 'p0', 'p1', s.game.missions.p1);
  assert.equal(s.phase, 'over');
  assert.equal(s.game.winner, 'p0');
  assert.equal(s.game.notice.kind, 'last');
});

test('達成で即終了／時間切れ／ホストが終える', () => {
  let s = T.startGame(room(3), rng(7));
  s = T.achieve(s, 'p2');
  assert.equal(s.game.winner, 'p2');
  assert.equal(s.phase, 'over');
  let t = T.startGame(room(3, { minutes: 5 }), rng(8), 1000);
  assert.equal(t.game.endsAt, 1000 + 300000);
  assert.throws(() => T.timeUp(t, 2000), /まだ時間/);
  t = T.timeUp(t, 400000);
  assert.equal(t.game.notice.kind, 'timeup');
  assert.equal(t.game.winner, null);
  const u = T.endRound(T.startGame(room(2), rng(9)));
  assert.equal(u.phase, 'over');
});

test('通算の勝ち数はラウンドをまたいで増える', () => {
  let s = T.startGame(room(3), rng(21));
  s = T.achieve(s, 'p1');
  s = T.startGame(s, rng(22));
  s = T.achieve(s, 'p1');
  s = T.startGame(s, rng(23));
  s = T.endRound(s);
  assert.equal(T.winsOf(s, 'p1'), 2);
  assert.equal(T.winsOf(s, 'p0'), 0);
});

test('2ラウンド目はテーマが変わる', () => {
  const a = T.startGame(room(3), () => 0);
  const b = T.startGame(a, () => 0);
  assert.notEqual(a.game.theme, b.game.theme);
  assert.equal(b.round, 2);
});

test('テーマの引き直し：何も起きていない間だけ、別のテーマに', () => {
  let s = T.startGame(room(3), () => 0);
  const before = s.game.theme;
  s = T.rerollTheme(s, () => 0);
  assert.notEqual(s.game.theme, before);
  assert.equal(s.game.rerolls, 1);
  const g = s.game;
  s = T.accuse(s, 'p0', 'p1', g.options.p1.find((x) => x !== g.missions.p1));
  assert.throws(() => T.rerollTheme(s), /変えられません/);
});

test('途中で抜ける：残りが1人になったら逃げ切り', () => {
  let s = T.startGame(room(3), rng(41));
  s = T.accuse(s, 'p0', 'p1', s.game.missions.p1);
  s = T.removeMid(s, 'p2');
  assert.equal(s.phase, 'over');
  assert.equal(s.game.winner, 'p0');
  assert.equal(s.game.notice.kind, 'last');
  assert.throws(() => T.removeMid(s, 'p1'), /少なく/);
});
