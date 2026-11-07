import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../kioku.js';
import * as L from '../logic.js';
import { ODAI } from '../odai.js';
import { GENRES, KIOKU_CARDS, HARD_CARDS, WATER_CARD } from '../kioku-data.js';
import { drinkKind, kiokuDrink, kiokuHitDrink, babaDrink } from '../drink.js';

const kd = (id, opt = {}, g = {}) => {
  const c = K.cardView(id, g);
  return kiokuDrink(c, { pen: '一口飲む', foot: GENRES[c.g]?.foot, ...opt });
};

test('文面の判定：ひとり／みんな／飲まない', () => {
  assert.equal(drinkKind('好きな人を1人指名。その人が一口飲む。'), 'solo');
  assert.equal(drinkKind('全員でじゃんけん。最後まで勝ち抜けなかった人が一口。'), 'solo');
  assert.equal(drinkKind('とりあえず全員で乾杯！'), 'multi');
  assert.equal(drinkKind('2人で一口。'), 'multi');
  assert.equal(drinkKind('1人を指名。自分とその人で一口ずつ。'), 'multi');
  assert.equal(drinkKind('初恋の話を30秒で。'), null);
  assert.equal(drinkKind('一発芸'), null);
});

test('記憶：めくった瞬間は、全員で乾杯はふたつ・飲まないカードと当てはまり系は出さない', () => {
  assert.equal(kd('K1-01'), null); // 当てはまり系は「いた！」を押してから
  assert.equal(kd('K1-01', { pot: 5 }), null);
  assert.equal(kd('K1-33').kind, 'multi');
  assert.equal(kd('K1-37').kind, 'multi'); // とりあえず全員で一口
  assert.equal(kd('K1-35'), null); // 全員で、私のいいところを1つずつ言う
  assert.equal(kd('K1-38').kind, 'solo'); // 全員でじゃんけん → 負けた1人がペナルティ
  assert.equal(kd('K2-14').kind, 'multi'); // 指名した人と腕を組んで一口
  assert.equal(kd('KX-03'), null); // ルールを足すだけ
  assert.equal(kd('KX-04'), null); // 道連れ（次から）
  assert.deepEqual(kiokuDrink(K.cardView('KW', {}), { pen: '一口飲む' }), { kind: 'multi', water: true, mult: 1, after: false });
});

test('記憶：「いた！」を押したときの演出（貯金込みの倍率）。ペナルティが飲まない系なら出さない', () => {
  assert.deepEqual(kiokuHitDrink('一口飲む', 1), { kind: 'solo', water: false, mult: 1 });
  assert.equal(kiokuHitDrink('二口飲む', 14).mult, 14);
  assert.equal(kiokuHitDrink('一発芸', 3), null);
  assert.equal(kiokuHitDrink('一発芸＋一口', 1).kind, 'solo');
});

test('記憶：ペナルティが飲まない系なら、ペナルティ系では出さない', () => {
  assert.equal(kd('K1-38', { pen: '変顔で写真' }), null);
  assert.equal(kd('K1-33', { pen: '一発芸' }).kind, 'multi'); // 乾杯は文面そのものが飲む
});

test('記憶：貯金があれば倍率つき（全員で乾杯）', () => {
  assert.equal(kd('K1-33', { pot: 4 }).mult, 5);
  assert.equal(kd('K1-37', { pot: 4 }).mult, 1); // 乾杯カード以外の全員一口は貯金を受けない
});

test('ババ酒：お題ごとの判定（縛りは出さない、2倍は×2）', () => {
  const bd = (id, g = {}, opt) => babaDrink(id, L.odaiOf(id, g), opt);
  assert.equal(bd('D1').kind, 'solo');
  assert.equal(bd('D2').kind, 'multi');
  assert.equal(bd('D4').kind, 'multi');
  assert.equal(bd('D5').kind, 'solo');
  assert.equal(bd('D10'), null);
  assert.equal(bd('S2').after, true); // あたまおしり（もとは縛り）
  assert.equal(bd('C13'), null); // 王様ルール（縛り）
  assert.equal(bd('C3'), null); // 効果2倍（次から）
  assert.equal(bd('C4'), null); // 交換
  assert.deepEqual(bd('C11'), { kind: 'multi', water: true, mult: 1, after: false });
  assert.equal(bd('D1', {}, { double: true }).mult, 2);
  assert.equal(bd('C2', { duo: true }).kind, 'multi'); // 2人だとリバースの代わりに乾杯
});

test('勝負・条件つきは「飲んだ！」を押してから（after）。確実に飲むカードはめくった瞬間', () => {
  assert.equal(kd('K2-36', {}, { duo: true }).after, true); // 2人でポーズ、崩れた方がペナルティ
  assert.equal(kd('K1-38').after, true); // じゃんけん
  assert.equal(kd('K2-33').after, true); // 外したら私がペナルティ
  assert.equal(kd('K1-34').after, true); // かぶった人同士で乾杯
  assert.equal(kd('KX-12').after, true); // 言えなかったら全員一口
  assert.equal(kd('K1-33').after, false); // とりあえず全員で乾杯
  assert.equal(kd('K1-37').after, false);
  assert.equal(kd('K2-01').after, false); // 指名して一口飲ませる
  assert.equal(kd('KX-01').after, false); // 連帯責任
  const bd = (id, g = {}) => babaDrink(id, L.odaiOf(id, g));
  for (const id of ['S1', 'S3', 'S5', 'S7', 'S9', 'S11', 'S13', 'H9', 'D5', 'D6']) assert.equal(bd(id).after, true, id);
  for (const id of ['D1', 'D2', 'D3', 'D4', 'D7', 'D8', 'D9', 'D11', 'D12', 'C11', 'C12']) assert.equal(bd(id).after, false, id);
});

test('恋愛のお題はなし。ババ酒の♥は全部「飲む」カード', () => {
  const ROMANCE = /恋|キス|告白し|告白され|デート|モテ|結婚|好きなタイプ|ドキッ|ドキドキ|見つめ合|好きなところ|好きな人/;
  const texts = [
    ...[...KIOKU_CARDS, ...HARD_CARDS].flatMap((c) => [c.id, c.t, c.t2].join(' ')),
    ...Object.entries(ODAI).map(([id, d]) => [id, d.t, d.t2].join(' ')),
  ];
  assert.deepEqual(texts.filter((t) => ROMANCE.test(t)), []);
  for (let i = 1; i <= 13; i++) {
    for (const duo of [false, true]) assert.ok(babaDrink('H' + i, L.odaiOf('H' + i, { duo })), `H${i} は飲むカード`);
  }
  // ♥（乾杯タイム）の中でも、結果しだいのものは「飲んだ！」を押してから
  for (const id of ['H8', 'H9', 'H10', 'H13']) assert.equal(babaDrink(id, L.odaiOf(id, {})).after, true, id);
  for (const id of ['H1', 'H3', 'H5', 'H6', 'H11', 'H12']) assert.equal(babaDrink(id, L.odaiOf(id, {})).kind, 'multi', id);
  // ♠の偶数と7は飲みゲー：負けた人が飲むので「飲んだ！」を押してから
  for (const id of ['S2', 'S4', 'S6', 'S7', 'S8', 'S10', 'S12']) for (const duo of [false, true]) assert.equal(babaDrink(id, L.odaiOf(id, { duo })).after, true, id);
  assert.equal(kd('K2-02').kind, 'multi'); // 王様：2人に一口ずつ（飲むだけのカードは残す）
  assert.equal(kd('K2-22').kind, 'solo'); // 「乾杯」を各国語で言い合う：負けた1人が飲む
});

test('記憶：エピソードを話すお題（暴露）はなく、かわりに乾杯・飲むお題', () => {
  assert.equal([...KIOKU_CARDS, ...HARD_CARDS].filter((c) => c.g === 'expose').length, 0);
  const kanpai = KIOKU_CARDS.filter((c) => c.g === 'kanpai');
  assert.equal(kanpai.length, 12);
  for (const duo of [false, true]) for (const c of kanpai) assert.ok(kd(c.id, {}, { duo }), `${c.id} は飲む`);
  // 結果しだいのもの（いちばん遅かった人・言えなかったら）だけ「飲んだ！」
  assert.deepEqual(kanpai.filter((c) => kd(c.id).after).map((c) => c.id), ['K2-47', 'K2-51']);
});

test('全カードで例外なく判定できる', () => {
  for (const duo of [false, true]) {
    for (const c of [...KIOKU_CARDS, ...HARD_CARDS, WATER_CARD]) {
      const r = kd(c.id, {}, { duo });
      assert.ok(r === null || ['solo', 'multi'].includes(r.kind), c.id);
    }
    for (const id of Object.keys(ODAI)) {
      const r = babaDrink(id, L.odaiOf(id, { duo }));
      assert.ok(r === null || ['solo', 'multi'].includes(r.kind), id);
    }
  }
});
