import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';
import { ODAI } from '../odai.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lobby(n) {
  let s = L.makeRoomState('TEST', { id: 'p0', name: 'P0' }, 0);
  for (let i = 1; i < n; i++) s = L.addPlayer(s, { id: 'p' + i, name: 'P' + i });
  return s;
}

function totalCards(s) {
  return Object.values(s.game.hands).reduce((a, h) => a + h.length, 0);
}

function checkInvariants(s) {
  const g = s.game;
  for (const [pid, h] of Object.entries(g.hands)) {
    const ranks = h.filter((c) => c !== 'JK').map(L.rankOf);
    assert.equal(new Set(ranks).size, ranks.length, `${pid} に同じ数字が2枚ある: ${h}`);
  }
  const all = Object.values(g.hands).flat();
  assert.equal(all.filter((c) => c === 'JK').length, 1, 'JOKERはちょうど1枚');
  assert.equal(new Set(all).size, all.length, 'カード重複なし');
  // 捨て札は偶数枚（ペアで消える）なので残りは奇数（JOKER分）
  assert.equal(totalCards(s) % 2, 1, '残りカードは奇数枚');
}

test('山札は53枚（52+JOKER）', () => {
  assert.equal(L.DECK.length, 53);
  assert.equal(new Set(L.DECK).size, 53);
  for (const id of L.DECK) if (id !== 'JK') assert.ok(ODAI[id], `お題がない: ${id}`);
});

test('最初のペアは捨てられ、手札に同じ数字は残らない', () => {
  const s = L.startGame(lobby(4), mulberry32(1));
  checkInvariants(s);
  assert.equal(s.phase, 'play');
  assert.equal(s.game.step, 'draw');
  assert.ok(s.game.turn);
});

test('お題で「飲んだ！」→ lastDrink を残す（セーフなら残さない）', () => {
  let s = fixedHands(2, { p0: ['S5', 'H2'], p1: ['H6', 'JK', 'D7'] });
  s = forcePair(s, 'p0', 'S1');
  const seq = s.game.seq;
  s = L.finishOdai(s, 'p0', Math.random, { drank: true });
  assert.deepEqual(s.game.lastDrink, { seq, id: 'S1', mult: 1 });
  let t = fixedHands(2, { p0: ['S5', 'H2'], p1: ['H6', 'JK', 'D7'] });
  t = forcePair(t, 'p0', 'S1');
  t = L.finishOdai(t, 'p0');
  assert.equal(t.game.lastDrink, undefined);
});

test('1人では始められない（2人からOK）', () => {
  assert.throws(() => L.startGame(lobby(1)), /2人以上/);
  assert.equal(L.startGame(lobby(2), mulberry32(5)).game.duo, true);
});

test('2人モード：お題が2人用の文面になり、指名は自動で相手に決まる', () => {
  let s = fixedHands(2, { p0: ['S5'], p1: ['H6', 'JK'] });
  s.game.duo = true;
  assert.equal(L.odaiOf('D1', s.game).t, '相手が一口飲む。');
  assert.equal(L.odaiOf('C2', s.game).fx, null, 'リバースは2人では無効');
  s = forcePair(s, 'p0', 'D1');
  s = L.finishOdai(s, 'p0');
  assert.equal(s.game.step, 'draw');
});

test('泥酔モード：一口が二口になり、縛りは3つまで重なる', () => {
  let s = fixedHands(3, { p0: ['S5'], p1: ['H6', 'JK'], p2: ['S9'] });
  s.game.hard = true;
  assert.match(L.odaiOf('D1', s.game).t, /二口/);
  for (const text of ['敬語禁止', 'カタカナ語禁止', '語尾に「ござる」', '左手で飲む']) s = L.commitOdai(forcePair(s, 'p0', 'C13'), 'p0', { text });
  assert.equal(s.game.rules.length, 3);
  assert.equal(s.game.rules[2].text, '左手で飲む');
});

test('CPUを呼ぶ：順番にキャラが来て、CPU入りでも最後まで遊べる', () => {
  let s = lobby(1);
  s = L.addCpu(s);
  s = L.addCpu(s);
  assert.deepEqual(s.players.map((p) => p.cpu || null), [null, 'zaruko', 'senpai']);
  const rng = mulberry32(42);
  s = L.startGame(s, rng);
  let guard = 0;
  while (s.phase === 'play') { s = L.applyAction(s, L.autoAction(s, rng), rng); if (++guard > 3000) assert.fail('終わらない'); }
  assert.equal(s.phase, 'over');
});

test('ランダムに1000ゲーム最後まで回しても破綻しない', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const rng = mulberry32(seed);
    const n = 2 + (seed % 9);
    const hard = seed % 3 === 0;
    let s = L.startGame(L.setSettings(lobby(n), { hard }), rng);
    let steps = 0;
    const effects = new Set();
    while (s.phase === 'play') {
      const a = L.autoAction(s, rng);
      assert.ok(a, 'play中なのに手がない');
      assert.equal(a.pid, L.actorOf(s));
      if (a.type === 'choose') effects.add(ODAI[a.card].fx);
      s = L.applyAction(s, a, rng);
      if (s.phase === 'play' && s.game.step !== 'penalty') checkInvariants(s);
      if (++steps > 5000) assert.fail(`終わらない seed=${seed}`);
    }
    const g = s.game;
    assert.equal(s.phase, 'over');
    assert.ok(g.loser, '負けた人がいる');
    assert.deepEqual(g.hands[g.loser], ['JK'], '負けた人の手札はJOKERだけ');
    assert.equal(g.finished.length, n - 1, '負け以外は全員上がっている');
    assert.ok(!g.finished.includes(g.loser));
    assert.ok(g.penalty);
  }
});

function forcePair(s, pid, cardId) {
  // テスト用：pid が cardId を選んだ odai 状態を作る
  const t = JSON.parse(JSON.stringify(s));
  t.game.step = 'odai';
  t.game.pair = { by: pid, from: 'p1', cards: [cardId, 'H1'], chosen: cardId, picks: [], text: null, committed: false, double: false, result: null, peek: null };
  t.game.turn = null;
  return t;
}

function fixedHands(n, hands) {
  const s = L.startGame(lobby(n), mulberry32(7));
  s.game.hands = hands;
  return s;
}

test('スキップ：次の人の番がとぶ', () => {
  let s = fixedHands(4, { p0: ['S1'], p1: ['S2', 'JK'], p2: ['S3'], p3: ['S4'] });
  s = forcePair(s, 'p0', 'C1');
  s = L.finishOdai(s, 'p0');
  assert.equal(s.game.turn, 'p2');
});

test('リバース：向きが逆になり、前の人の番になる', () => {
  let s = fixedHands(4, { p0: ['S1'], p1: ['S2', 'JK'], p2: ['S3'], p3: ['S4'] });
  s = forcePair(s, 'p0', 'C2');
  s = L.finishOdai(s, 'p0');
  assert.equal(s.game.dir, -1);
  assert.equal(s.game.turn, 'p3');
  assert.equal(L.drawTarget(s), 'p2');
});

test('効果2倍：次のお題に2倍が付き、スキップなら2人とぶ', () => {
  let s = fixedHands(4, { p0: ['S1'], p1: ['S2', 'JK'], p2: ['S3'], p3: ['S4'] });
  s = forcePair(s, 'p0', 'C3');
  s = L.finishOdai(s, 'p0');
  assert.equal(s.game.double, true);
  // 次のペアでスキップを選ぶ
  s.game.step = 'choose';
  s.game.pair = { by: 'p1', from: 'p2', cards: ['C6', 'H6'], chosen: null, picks: [], committed: false, double: false };
  s.game.turn = null;
  s = L.choose(s, 'p1', 'C6');
  assert.equal(s.game.pair.double, true);
  assert.equal(s.game.double, false);
  s = L.finishOdai(s, 'p1');
  // p1 の次は p2, p3 をとばして p0
  assert.equal(s.game.turn, 'p0');
});

test('交換：1枚ずつ入れ替わり、そろったら自動で捨てる', () => {
  let s = fixedHands(3, { p0: ['S5'], p1: ['H5', 'JK'], p2: ['S9'] });
  s = forcePair(s, 'p0', 'C4');
  // 乱数0で先頭を取り出す → p0:S5 と p1:H5 を交換 → どちらもそろわない
  s = L.commitOdai(s, 'p0', { picks: ['p1'] }, () => 0);
  assert.deepEqual(s.game.hands.p0, ['H5']);
  assert.deepEqual(s.game.hands.p1.sort(), ['JK', 'S5'].sort());
  assert.throws(() => L.commitOdai(forcePair(s, 'p0', 'C4'), 'p0', { picks: [] }), /1人を選んで/);
});

test('のぞき見：対象の手札から1枚がpeekに入る', () => {
  let s = fixedHands(3, { p0: ['S5'], p1: ['H6', 'JK'], p2: ['S9'] });
  s = forcePair(s, 'p0', 'C5');
  s = L.commitOdai(s, 'p0', { picks: ['p1'] }, () => 0);
  assert.equal(s.game.pair.peek.length, 1);
  assert.ok(['H6', 'JK'].includes(s.game.pair.peek[0]));
});

test('大移動：全員が次の人へ1枚渡し、ペアは自動で捨てる', () => {
  let s = fixedHands(3, { p0: ['S5', 'S7'], p1: ['H7', 'JK'], p2: ['H5'] });
  s = forcePair(s, 'p0', 'C10');
  s = L.commitOdai(s, 'p0', {}, () => 0);
  const all = Object.values(s.game.hands).flat();
  assert.equal(all.filter((c) => c === 'JK').length, 1);
  checkInvariants(s);
});

test('縛り：王様ルール（自由入力）だけ。空だと止まる（♠の縛りは飲みゲーに置き換え済み）', () => {
  let s = fixedHands(3, { p0: ['S5'], p1: ['H6', 'JK'], p2: ['S9'] });
  for (const id of ['S2', 'S4', 'S6', 'S8', 'S10', 'S12']) assert.ok(L.odaiOf(id, {}).game, id);
  assert.throws(() => L.commitOdai(forcePair(s, 'p0', 'C13'), 'p0', { text: '  ' }), /縛りの内容/);
  s = L.commitOdai(forcePair(s, 'p0', 'C13'), 'p0', { text: '敬語禁止' });
  assert.equal(s.game.rule.text, '敬語禁止');
});

test('手札最多・両隣は選んだ瞬間に計算される', () => {
  let s = fixedHands(4, { p0: ['S5'], p1: ['H6', 'JK', 'S1'], p2: ['S9'], p3: ['D2', 'D3', 'D4'] });
  s.game.step = 'choose';
  s.game.pair = { by: 'p0', from: 'p1', cards: ['D7', 'D3'], chosen: null, picks: [], committed: false, double: false };
  const most = L.choose(s, 'p0', 'D7');
  assert.deepEqual(most.game.pair.picks.sort(), ['p1', 'p3']);
  const nb = L.choose(s, 'p0', 'D3');
  assert.deepEqual(nb.game.pair.picks.sort(), ['p1', 'p3']);
});

test('担当者以外は操作できない', () => {
  const s = L.startGame(lobby(3), mulberry32(3));
  const other = s.players.map((p) => p.id).find((id) => id !== s.game.turn);
  assert.throws(() => L.draw(s, other, 0), /あなたの番ではありません/);
});

test('罰ゲームは1番に上がった人が決める', () => {
  let s = fixedHands(3, { p0: [], p1: ['JK'], p2: [] });
  s.game.finished = ['p2', 'p0'];
  s.game.step = 'penalty';
  s.game.loser = 'p1';
  assert.equal(L.actorOf(s), 'p2');
  assert.throws(() => L.setPenalty(s, 'p0', 'x'), /1番に上がった人/);
  s = L.setPenalty(s, 'p2', 'モノマネ');
  assert.equal(s.phase, 'over');
});

test('ロビー：並べ替え・退出・ホスト交代', () => {
  let s = lobby(3);
  s = L.movePlayer(s, 'p2', -1);
  assert.deepEqual(s.players.map((p) => p.id), ['p0', 'p2', 'p1']);
  s = L.removePlayer(s, 'p0');
  assert.equal(s.hostId, 'p2');
  s = L.makeHost(s, 'p1');
  assert.equal(s.hostId, 'p1');
  s = L.addPlayer(s, { id: 'p1', name: '改名' });
  assert.equal(s.players.find((p) => p.id === 'p1').name, '改名');
});