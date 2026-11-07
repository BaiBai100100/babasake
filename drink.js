// 飲む演出の判定（純粋関数・Node でテスト可能）
// 'solo'  = ひとりで飲む → グラスひとつ
// 'multi' = 何人かで飲む・乾杯 → グラスふたつがぶつかる
// water   = お水（チェイサー）なら true
// 返り値 null = 飲まないカード（演出なし）

const DRINK = /[一二三四五六七八九十]口|飲|乾杯|お水|一杯/;
// 「何人かで一緒に飲む」言い回し。主語が複数で、そのまま飲む動詞につながるもの
const MULTI = [
  /乾杯/,
  /(全員|みんな|2人とも|2人で|二人で)[^。]{0,8}([一二三四五六七八九十]口|飲|お水)/,
  /[一二三四五六七八九十]口ずつ/,
  /両隣/,
  /連帯責任/,
  /自分とその人で/,
  /私と[^。]{0,10}一緒に/,
];

// 勝負・条件つき（負けた方／言えなかったら／外したら…）：だれが飲むかは結果しだいなので、めくった瞬間ではなく
// 「飲んだ！」を押したときに出す
const AFTER = /ペナルティ|たら|なら|なければ|ければ|えば|負けた|勝てなかった|勝ち抜けなかった|崩れた|笑った|詰まった|ずれた|かんだ|かぶった|違った|少数派|指された|ほめられた|遅かった|照れた|残った|見せたくない|思い出せない/;
export const drinkAfter = (text) => !!text && AFTER.test(text);

// 文面だけでは決められないカードの上書き（id → 'solo' | 'multi' | null）
export const DRINK_OVERRIDE = {
  // 「乾杯の音頭をとる」だけで、飲むのは決まっていない
  D10: null,
  // 次から効くだけのカードは、めくった時点ではだれも飲まない
  'KX-03': null, // 乾杯コール権（ルール）
  'KX-04': null, // 道連れ
  'K2-12': null, // 身代わり指名
  C3: null, // 効果2倍
  C8: null,
  // 「全員、飲ませたい人を指差す」→ 飲むのは指された1人
  D5: 'solo',
  // 指名した人と腕を組んで2人で飲む
  'K2-14': 'multi',
};

export function drinkKind(text) {
  if (!text || !DRINK.test(text)) return null;
  return MULTI.some((re) => re.test(text)) ? 'multi' : 'solo';
}

// 記憶：めくったカードの演出（当てはまり系はめくった時点では出さない）。
// card = cardView の結果 / pen = ペナルティの文面 / foot = GENRES の foot / pot = 貯金
export function kiokuDrink(card, { pen = '一口飲む', foot = null, pot = 0 } = {}) {
  if (!card) return null;
  if (card.rule) return null;
  const water = card.g === 'water' || /お水/.test(card.t);
  let kind;
  if (card.id in DRINK_OVERRIDE) kind = DRINK_OVERRIDE[card.id];
  else if (foot === 'hit') return null; // 当てはまり系は「いた！」を押したときに出す（kiokuHitDrink）
  else kind = drinkKind(card.t.replace(/ペナルティ/g, pen));
  if (!kind) return null;
  if (card.toast) kind = 'multi';
  const mult = pot > 0 && card.toast ? pot + 1 : 1;
  return { kind, water, mult, after: !card.toast && drinkAfter(card.t) };
}

// 記憶：当てはまり系で「いた！」を押したときの演出。mult = 貯金込みの倍率
export function kiokuHitDrink(pen = '一口飲む', mult = 1) {
  const kind = drinkKind(pen);
  return kind ? { kind, water: false, mult } : null;
}

// ババ酒：選ばれたお題の演出。def = odaiOf の結果
export function babaDrink(id, def, { double = false } = {}) {
  if (!def) return null;
  if (def.fx === 'rule' || def.fx === 'rulecustom') return null;
  const kind = id in DRINK_OVERRIDE ? DRINK_OVERRIDE[id] : drinkKind(def.t);
  if (!kind) return null;
  return { kind, water: /お水/.test(def.t), mult: double ? 2 : 1, after: drinkAfter(def.t) };
}
