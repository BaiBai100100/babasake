import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';
import * as N from '../ng.js';
import { NG_WORDS } from '../ng-data.js';

function rng(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; }
function room(n, settings = {}) {
  let s = L.makeRoomState('TEST', { id: 'p0', name: 'P0' }, 0, 'ng', settings);
  for (let i = 1; i < n; i++) s = L.addPlayer(s, { id: 'p' + i, name: 'P' + i });
  return s;
}

test('NGワード：重複なし・十分な数', () => {
  assert.equal(new Set(NG_WORDS).size, NG_WORDS.length);
  assert.ok(NG_WORDS.length >= 40);
});

test('始めると全員に別々のNGワード（10人でも）', () => {
  for (let seed = 1; seed < 40; seed++) {
    const n = 2 + (seed % 9);
    const s = N.startGame(room(n), rng(seed), 0);
    assert.equal(new Set(Object.values(s.game.words)).size, n);
    assert.equal(s.game.endsAt, 5 * 60000);
  }
});

test('言った！：一口ぶん数えて、新しい言葉に替わる（いま他の人が持つ言葉・さっきの言葉にはならない）', () => {
  let s = N.startGame(room(4), rng(3), 0);
  for (let k = 0; k < 40; k++) {
    const target = 'p' + (1 + (k % 3));
    const old = s.game.words[target];
    s = N.callOut(s, 'p0', target, old, rng(100 + k));
    const w = s.game.words[target];
    assert.notEqual(w, old);
    assert.equal(new Set(Object.values(s.game.words)).size, 4);
    assert.equal(s.game.notice.kind, 'out');
    assert.equal(s.game.notice.word, old);
  }
  assert.equal(N.outsOf(s.game, 'p1') + N.outsOf(s.game, 'p2') + N.outsOf(s.game, 'p3'), 40);
  assert.equal(s.game.said.length, 40);
});

test('同時に押しても1回だけ／自分は押せない', () => {
  let s = N.startGame(room(3), rng(9), 0);
  const w = s.game.words.p1;
  s = N.callOut(s, 'p0', 'p1', w, rng(1));
  assert.throws(() => N.callOut(s, 'p2', 'p1', w), /もう新しい/);
  assert.throws(() => N.callOut(s, 'p1', 'p1', s.game.words.p1), /自分の/);
});

test('時間切れ・終了：いちばん言った人が出る', () => {
  let s = N.startGame(room(3, { minutes: 3 }), rng(4), 1000);
  s = N.callOut(s, 'p0', 'p2', s.game.words.p2, rng(2));
  s = N.callOut(s, 'p1', 'p2', s.game.words.p2, rng(3));
  s = N.callOut(s, 'p2', 'p0', s.game.words.p0, rng(4));
  assert.throws(() => N.timeUp(s, 2000), /まだ時間/);
  s = N.timeUp(s, 1000 + 3 * 60000);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.game.worst, ['p2']);
  const t = N.endRound(N.startGame(room(2, { minutes: 0 }), rng(5), 0));
  assert.deepEqual(t.game.worst, []);
  assert.equal(t.game.endsAt, null);
});

test('途中で抜ける：その人のワードと回数が消え、結果にも出ない', () => {
  let s = N.startGame(room(3), rng(51), 0);
  s = N.callOut(s, 'p0', 'p2', s.game.words.p2, rng(1));
  s = N.callOut(s, 'p0', 'p2', s.game.words.p2, rng(2));
  s = N.removeMid(s, 'p2');
  assert.ok(!('p2' in s.game.words) && !('p2' in s.game.outs));
  assert.throws(() => N.callOut(s, 'p0', 'p2', 0), /参加していません/);
  s = N.endRound(s);
  assert.deepEqual(s.game.worst, []);
});
