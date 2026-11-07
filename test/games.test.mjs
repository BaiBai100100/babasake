import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../kioku.js';
import * as L from '../logic.js';
import { ODAI } from '../odai.js';
import { KIOKU_CARDS, HARD_CARDS } from '../kioku-data.js';
import { GAMES, makeTopic, fillTopic, DOSUKOI, ATAMA_WORDS, YAMANOTE, BANANA, MAJORITY, INSHOU, MOZZA } from '../games.js';
import { kiokuDrink, babaDrink } from '../drink.js';

function seeded(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('どのゲームもお題が必ず決まり、出る候補は重複なし', () => {
  const rng = seeded(1);
  for (const [game, def] of Object.entries(GAMES)) {
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const tp = makeTopic(game, rng);
      assert.equal(tp.game, game);
      assert.ok(tp.text && !tp.text.includes('undefined'), `${def.name}: ${tp.text}`);
      seen.add(tp.text);
    }
    assert.ok(seen.size >= 10, `${def.name} のお題が少なすぎる (${seen.size})`);
  }
  for (const list of [YAMANOTE, BANANA, DOSUKOI, ATAMA_WORDS, INSHOU, MOZZA]) assert.equal(new Set(list).size, list.length);
  assert.equal(new Set(MAJORITY.map((p) => p.join('/'))).size, MAJORITY.length);
});

test('どすこいの頭文字はひらがな1文字、あたまおしりは実在の言葉から作るので答えが必ずある', () => {
  for (const c of DOSUKOI) assert.match(c, /^[ぁ-ゖ]$/);
  assert.ok(!DOSUKOI.includes('ん') && !DOSUKOI.includes('を'));
  for (const w of ATAMA_WORDS) assert.match(w, /^[ぁ-ゖ]{2,}$/, w);
  const rng = seeded(7);
  for (let i = 0; i < 200; i++) {
    const [, head, tail] = makeTopic('atama', rng).text.match(/^「(.)」で始まって「(.)」で終わる$/);
    assert.ok(ATAMA_WORDS.some((w) => w[0] === head && w[w.length - 1] === tail), `${head}〜${tail}`);
  }
});

test('記憶：飲みゲーのカードを引くと、お題がその場で決まって文面に入る（state に残るので全員同じ）', () => {
  const games = [...KIOKU_CARDS, ...HARD_CARDS].filter((c) => c.game);
  assert.ok(games.length >= 10, `飲みゲーのカードは ${games.length} 枚`);
  for (const duo of [false, true]) {
    for (const c of games) {
      const room = { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, ...(duo ? [] : [{ id: 'c', name: 'C' }])], settings: { deck: 'mix' }, hostId: 'a', phase: 'lobby' };
      let s = K.startGame(room, seeded(3));
      s.game.deck = [c.id, ...s.game.deck];
      s.game.pos = 0;
      s = K.draw(s, s.game.turn, seeded(c.id.length + 5));
      const cv = K.currentCard(s);
      assert.ok(s.game.topic?.text, c.id);
      assert.ok(cv.t.includes(s.game.topic.text), `${c.id}: ${cv.t}`);
      assert.ok(!/\{お題\}|？？？/.test(cv.t), cv.t);
      assert.equal(cv.topic, s.game.topic.text);
      // 結果しだいで飲むカードなので「飲んだ！／セーフ」で進める
      const d = kiokuDrink(cv, { pen: '一口飲む' });
      assert.ok(d?.after, `${c.id} は「飲んだ！」で演出: ${JSON.stringify(d)}`);
      // 次のカードではお題が消える
      s = K.next(s, s.game.turn);
      s.game.deck.splice(s.game.pos, 0, 'K1-01');
      s = K.draw(s, s.game.turn);
      assert.equal(s.game.topic, null);
    }
  }
});

test('ババ酒：♥はぜんぶ飲みゲー。ペアがそろった瞬間にお題が決まり、選ぶ前の2枚にも出る', () => {
  for (let i = 1; i <= 13; i++) assert.ok(GAMES[ODAI['H' + i].game], `H${i}`);
  // H3 と D3 のペアがそろう状態を作る
  let s = L.startGame({ players: [{ id: 'p0', name: 'P0' }, { id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }], settings: {}, hostId: 'p0', phase: 'lobby', created: 1 }, seeded(2));
  s.game.hands = { p0: ['H3', 'S9'], p1: ['D3', 'JK'], p2: ['C9', 'S5'] };
  s.game.turn = 'p0';
  s.game.step = 'draw';
  s.game.dir = 1;
  s = L.draw(s, 'p0', 0, seeded(9));
  assert.equal(s.game.step, 'choose');
  const tp = s.game.pair.topics.H3;
  assert.ok(tp?.text);
  assert.equal(s.game.pair.topics.D3, undefined);
  assert.ok(L.odaiOf('H3', s.game).t.includes(tp.text));
  s = L.choose(s, 'p0', 'H3');
  const def = L.odaiOf('H3', s.game);
  assert.equal(def.topic, tp.text);
  assert.ok(!/\{お題\}|？？？/.test(def.t));
  assert.ok(babaDrink('H3', def).after);
});

test('お題が決まる前（古い状態）でも文面は壊れない', () => {
  assert.equal(fillTopic('お題は「{お題}」', null), 'お題は「？？？」');
  assert.ok(!L.odaiOf('H1', {}).t.includes('{お題}'));
  assert.ok(!K.cardView('K2-02', {}).t.includes('{お題}'));
});
