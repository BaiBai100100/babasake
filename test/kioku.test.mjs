import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';
import * as K from '../kioku.js';
import { KIOKU_CARDS, GENRES } from '../kioku-data.js';

function rng(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; }
function room(n, deck = 'k1') {
  let s = L.makeRoomState('TEST', { id: 'p0', name: 'P0' }, 0, 'kioku', { deck, penalty: '一口飲む' });
  for (let i = 1; i < n; i++) s = L.addPlayer(s, { id: 'p' + i, name: 'P' + i });
  return s;
}

test('第1弾・第2弾はそれぞれ54枚、合わせて108枚。IDの重複なし・ジャンルは定義済み', () => {
  assert.equal(KIOKU_CARDS.filter((c) => c.set === 1).length, 54);
  assert.equal(KIOKU_CARDS.filter((c) => c.set === 2).length, 54);
  assert.equal(new Set(KIOKU_CARDS.map((c) => c.id)).size, 108);
  assert.equal(new Set(KIOKU_CARDS.map((c) => c.t)).size, 108, 'お題の文面が重複している');
  for (const c of KIOKU_CARDS) assert.ok(GENRES[c.g], c.id);
  assert.equal(K.deckFor('k1').length, 54);
  assert.equal(K.deckFor('k2').length, 54);
  assert.equal(K.deckFor('mix').length, 108);
});

test('山札を最後まで引くと end になり、全カードが1回ずつ出る', () => {
  for (const deck of ['k1', 'k2', 'mix']) {
    const r = rng(deck.length);
    let s = K.startGame(room(5, deck), r);
    const seen = [];
    let guard = 0;
    while (s.game.step !== 'end') {
      const a = K.autoAction(s, r);
      assert.equal(a.pid, K.actorOf(s));
      s = K.applyAction(s, a, r);
      if (a.type === 'draw') seen.push(s.game.card);
      if (++guard > 2000) assert.fail('終わらない');
    }
    assert.equal(seen.length, K.deckFor(deck).length);
    assert.equal(new Set(seen).size, seen.length);
    s = K.reshuffle(s, r);
    assert.equal(s.game.step, 'draw');
    assert.equal(K.remaining(s), K.deckFor(deck).length);
  }
});

test('番は席順に回る', () => {
  let s = K.startGame(room(3), rng(1));
  const order = [];
  for (let i = 0; i < 6; i++) {
    order.push(s.game.turn);
    s = K.draw(s, s.game.turn);
    const a = K.autoAction(s);
    if (a.type === 'commit') s = K.applyAction(s, a);
    s = K.next(s, s.game.turn);
  }
  const seats = ['p0', 'p1', 'p2'];
  for (let i = 1; i < order.length; i++) assert.equal(seats.indexOf(order[i]), (seats.indexOf(order[i - 1]) + 1) % 3);
});

test('指名カードは選ぶまで次へ進めない／他人は操作できない', () => {
  let s = K.startGame(room(4, 'k2'), rng(2));
  s.game.deck = ['K2-01', ...s.game.deck];
  s.game.pos = 0;
  const me = s.game.turn;
  const other = s.players.find((p) => p.id !== me).id;
  assert.throws(() => K.draw(s, other), /あなたの番ではありません/);
  s = K.draw(s, me);
  assert.equal(s.game.card, 'K2-01');
  assert.throws(() => K.next(s, me), /指名・入力/);
  assert.throws(() => K.commit(s, me, { picks: [] }), /1人を選んで/);
  s = K.commit(s, me, { picks: [other] });
  assert.deepEqual(s.game.picks, [other]);
  s = K.next(s, me);
  assert.equal(s.game.step, 'draw');
});

test('「次の私の番まで」の縛りは、その人がまた引くときに消える', () => {
  let s = K.startGame(room(2, 'k2'), rng(3));
  const id = KIOKU_CARDS.find((c) => c.rule).id;
  s.game.deck = [id, 'K2-06', 'K2-08'];
  const a = s.game.turn;
  s = K.draw(s, a);
  assert.equal(s.game.rules.length, 1);
  s = K.next(s, a);
  const b = s.game.turn;
  s = K.draw(s, b);
  assert.equal(s.game.rules.length, 1, '他の人の番では続く');
  s = K.applyAction(s, K.autoAction(s));
  if (s.game.step === 'card') s = K.next(s, b);
  s = K.draw(s, a);
  assert.equal(s.game.rules.length, 0);
});

test('自由入力のルールとタイマー', () => {
  let s = K.startGame(room(3, 'k2'), rng(4));
  const textId = KIOKU_CARDS.find((c) => c.need === 'text').id;
  const timerId = KIOKU_CARDS.find((c) => c.timer && !c.need).id;
  s.game.deck = [textId, timerId, 'K2-06'];
  const a = s.game.turn;
  s = K.draw(s, a);
  assert.throws(() => K.commit(s, a, { text: ' ' }), /ルールを入れて/);
  s = K.commit(s, a, { text: '左手で飲む' });
  assert.equal(s.game.rules[0].text, '左手で飲む');
  s = K.next(s, a);
  s = K.draw(s, s.game.turn);
  s = K.startTimer(s, s.game.turn, 1000);
  assert.equal(s.game.timer.end, 1000 + K.currentCard(s).timer * 1000);
});

test('2人モード：文面が「相手」「2人で」になり、指名は自動', () => {
  let s = K.startGame(room(2, 'k2'), rng(9));
  assert.equal(s.game.duo, true);
  s.game.deck = ['K2-01', 'K2-02'];
  const a = s.game.turn;
  s = K.draw(s, a);
  assert.equal(K.currentCard(s).t, '王様：相手に一口飲ませる');
  s = K.next(s, a);
  assert.equal(s.game.step, 'draw');
});

test('泥酔モード：泥酔カードが混ざり、12枚ごとにチェイサーが入る', () => {
  let s = L.setSettings(room(3, 'k1'), { hard: true });
  s = K.startGame(s, rng(10));
  assert.equal(K.remaining(s), 54 + 12);
  let waters = 0;
  for (let i = 0; i < 30; i++) {
    s = K.draw(s, s.game.turn);
    if (s.game.card === 'KW') waters++;
    const a = K.autoAction(s);
    if (a.type === 'commit') s = K.applyAction(s, a);
    s = K.next(s, s.game.turn);
  }
  assert.equal(waters, 2);
  assert.equal(K.cardView('K1-37', { hard: true }).t, 'とりあえず全員で二口');
});

test('だれも当てはまらない：貯金は上限なしで溜まり、いたら総取り', () => {
  let s = K.startGame(room(3, 'k1'), rng(11));
  const hit = KIOKU_CARDS.filter((c) => c.set === 1 && ['match', 'recent', 'late'].includes(c.g)).map((c) => c.id);
  s.game.deck = [hit[0], hit[1], 'K1-37', ...hit.slice(2, 10)];
  s.game.pos = 0;
  const step = (fn) => { s = K.draw(s, s.game.turn); s = fn(s, s.game.turn); };
  step(K.none);
  assert.equal(s.game.pot, 1);
  assert.equal(s.game.notice.kind, 'stock');
  step(K.none);
  assert.equal(s.game.pot, 2);
  // 当てはまり系でないカード：「だれもいない」は使えず、貯金はそのまま
  s = K.draw(s, s.game.turn);
  assert.equal(s.game.notice, null);
  assert.throws(() => K.none(s, s.game.turn), /使えません/);
  s = K.next(s, s.game.turn);
  assert.equal(s.game.pot, 2);
  // 旧上限（2つ）を超えても、だれもいなければ溜まり続ける
  for (let i = 3; i <= 6; i++) {
    step(K.none);
    assert.equal(s.game.pot, i);
    assert.deepEqual([s.game.notice.kind, s.game.notice.pot], ['stock', i]);
  }
  // 当てはまった人がいた → 貯金6つぶん込みで7倍、貯金は0に
  step(K.next);
  assert.equal(s.game.pot, 0);
  assert.deepEqual([s.game.notice.kind, s.game.notice.mult], ['paid', 7]);
  assert.equal(K.penaltyText('一口飲む', s.game.notice.mult), '七口飲む');
  // また貯金1つから
  step(K.none);
  assert.equal(s.game.pot, 1);
});

test('貯金があるときに全員で乾杯：分け合わず全員がひとりずつ貯金ぶん、貯金は0に', () => {
  let s = K.startGame(room(3, 'k1'), rng(5));
  const hit = KIOKU_CARDS.filter((c) => c.set === 1 && c.g === 'match').map((c) => c.id);
  // 乾杯の文字があっても「全員で乾杯」でないカード（K1-34）では精算しない
  s.game.deck = ['K1-33', hit[0], hit[1], hit[2], 'K1-34', 'K1-40', hit[3]];
  s.game.pos = 0;
  const step = (fn) => { s = K.draw(s, s.game.turn); s = fn(s, s.game.turn); };
  // 貯金0で乾杯：なにも起きない
  step(K.next);
  assert.equal(s.game.notice, null);
  assert.equal(s.game.pot, 0);
  step(K.none); step(K.none); step(K.none);
  assert.equal(s.game.pot, 3);
  step(K.next); // K1-34
  assert.equal(s.game.pot, 3);
  assert.equal(s.game.notice, null);
  // 全員で乾杯 → 乾杯ぶん＋貯金3つで、全員ひとりずつ×4（四口ずつ）、貯金0
  s = K.draw(s, s.game.turn);
  assert.equal(K.isToastCard(K.currentCard(s)), true);
  s = K.next(s, s.game.turn);
  assert.equal(s.game.pot, 0);
  assert.deepEqual([s.game.notice.kind, s.game.notice.mult], ['kanpai', 4]);
  assert.equal(K.penaltyText('一口飲む', s.game.notice.mult), '四口飲む');
  // 対象は「全員で乾杯」の4枚。2人モード・泥酔モードの文面でも乾杯のまま
  assert.deepEqual(KIOKU_CARDS.filter((c) => c.toast).map((c) => c.id), ['K1-33', 'K1-40', 'K2-06']);
  assert.equal(K.isToastCard(K.cardView('KX-08', { hard: true })), true);
  for (const id of ['K1-33', 'K1-40', 'K2-06', 'KX-08']) assert.match(K.cardView(id, { duo: true }).t, /乾杯/);
});

test('ペナルティの倍数表示', () => {
  assert.equal(K.penaltyText('一口飲む', 1), '一口飲む');
  assert.equal(K.penaltyText('一口飲む', 3), '三口飲む');
  assert.equal(K.penaltyText('二口飲む', 3), '六口飲む');
  assert.equal(K.penaltyText('一発芸＋一口', 2), '一発芸＋二口');
  assert.equal(K.penaltyText('一発芸', 2), '一発芸を2回');
  assert.equal(K.penaltyText('一口飲む', 12), '十二口飲む');
  assert.equal(K.penaltyText('二口飲む', 12), '二十四口飲む');
  assert.equal(K.penaltyText('二口飲む', 10), '二十口飲む');
  assert.equal(K.penaltyText('二口飲む', 60), '120口飲む');
  assert.equal(K.penaltyText('一発芸', 9), '一発芸を9回');
});

test('2人未満では始められない', () => {
  assert.throws(() => K.startGame(room(1)), /2人以上/);
});
