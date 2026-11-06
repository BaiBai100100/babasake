// 記憶無くしちゃダメですか：山札から1枚引いて、書いてあることに従う
import { KIOKU_CARDS, KIOKU_BY_ID, HARD_CARDS, WATER_CARD, WATER_EVERY } from './kioku-data.js';
import { shuffle, nameOf } from './logic.js';

export const MIN_PLAYERS = 2;
const MAX_RULES_HARD = 3;
const clone = (o) => JSON.parse(JSON.stringify(o));
const fail = (m) => { throw new Error(m); };

export function deckFor(deck, { hard = false } = {}) {
  const sets = deck === 'k1' ? [1] : deck === 'k2' ? [2] : [1, 2];
  const ids = KIOKU_CARDS.filter((c) => sets.includes(c.set)).map((c) => c.id);
  return hard ? [...ids, ...HARD_CARDS.map((c) => c.id)] : ids;
}

// 2人モード・泥酔モードを反映したカードの中身
export function cardView(id, g) {
  const c = KIOKU_BY_ID[id];
  if (!c) return null;
  let t = (g?.duo && c.t2) || c.t;
  if (g?.hard) t = t.replace(/一口/g, '二口');
  const rule = c.rule ? ((g?.duo && c.rule2) || c.rule) : null;
  return { ...c, t, rule };
}

export function actorOf(s) {
  const g = s.game;
  if (s.phase !== 'play' || !g) return s.hostId;
  if (g.step === 'draw' || g.step === 'card') return g.turn;
  return s.hostId;
}

function log(s, m) {
  s.game.log.push(m);
  if (s.game.log.length > 30) s.game.log.shift();
}

function addRule(g, rule) {
  const max = g.hard ? MAX_RULES_HARD : 1;
  g.rules = [...(g.rules || []), rule].slice(-max);
}

export function startGame(s0, rng = Math.random) {
  const s = clone(s0);
  if (s.players.length < MIN_PLAYERS) fail(`${MIN_PLAYERS}人以上で始められます`);
  const hard = !!s.settings?.hard;
  const deck = shuffle(deckFor(s.settings?.deck || 'k1', { hard }), rng);
  s.phase = 'play';
  s.round = (s.round || 0) + 1;
  s.game = {
    deck, pos: 0, step: 'draw', card: null, picks: [], text: null, committed: false,
    turn: s.players[Math.floor(rng() * s.players.length)].id,
    rules: [], timer: null, n: 0, log: [], history: [],
    duo: s.players.length === 2, hard,
  };
  log(s, `第${s.round}ゲーム開始（${deck.length}枚${s.game.duo ? '・2人モード' : ''}${hard ? '・泥酔モード' : ''}）`);
  return s;
}

export const remaining = (s) => s.game.deck.length - s.game.pos;
export const currentCard = (s) => (s.game?.card ? cardView(s.game.card, s.game) : null);
export const candidates = (s, pid) => s.players.map((p) => p.id).filter((x) => x !== pid);

export function draw(s0, pid) {
  const s = clone(s0);
  const g = s.game;
  if (s.phase !== 'play' || g.step !== 'draw') fail('いまは引く場面ではありません');
  if (g.turn !== pid) fail('あなたの番ではありません');
  if (g.pos >= g.deck.length) fail('山札がもうありません');
  // 「次の私の番まで」の縛りは、その人の番が来たら終わり
  const ended = (g.rules || []).filter((r) => r.until === pid);
  if (ended.length) {
    g.rules = g.rules.filter((r) => r.until !== pid);
    for (const r of ended) log(s, `ルール「${r.text}」おしまい`);
  }
  // 泥酔モードは一定枚数ごとにチェイサーを強制で挟む（山札は減らない）
  if (g.hard && g.n > 0 && g.n % WATER_EVERY === 0 && g.lastWater !== g.n) {
    g.card = WATER_CARD.id;
    g.lastWater = g.n;
  } else {
    g.card = g.deck[g.pos++];
  }
  g.n++;
  g.step = 'card';
  g.picks = [];
  g.text = null;
  g.timer = null;
  g.history = [...(g.history || []), g.card].slice(-6);
  const c = cardView(g.card, g);
  g.committed = !c.need;
  if (c.rule) addRule(g, { text: c.rule, by: pid, until: pid });
  log(s, `${nameOf(s, pid)}が引いた：${c.t}`);
  return s;
}

export function commit(s0, pid, input = {}) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'card') fail('いまはカードの場面ではありません');
  if (g.turn !== pid) fail('進めるのはカードを引いた人です');
  const c = cardView(g.card, g);
  if (typeof c.need === 'number') {
    const cands = candidates(s, pid);
    const required = Math.min(c.need, cands.length);
    // 選ぶ余地がない（2人モードなど）ときは自動で決まる
    const raw = input.picks?.length ? input.picks : (cands.length <= c.need ? cands : []);
    const picks = [...new Set(raw.filter((x) => cands.includes(x)))];
    if (picks.length !== required) fail(`${required}人を選んでください`);
    g.picks = picks;
  } else if (c.need === 'text') {
    const t = String(input.text || '').trim().slice(0, 40);
    if (!t) fail('ルールを入れてください');
    g.text = t;
    addRule(g, { text: t, by: pid, until: pid });
  }
  g.committed = true;
  return s;
}

export function startTimer(s0, pid, now = Date.now()) {
  const s = clone(s0);
  const g = s.game;
  const c = currentCard(s);
  if (g?.step !== 'card' || !c?.timer) fail('タイマーはありません');
  if (g.turn !== pid) fail('タイマーを押せるのはカードを引いた人です');
  g.timer = { end: now + c.timer * 1000, secs: c.timer };
  return s;
}

export function next(s0, pid) {
  let s = s0;
  if (s.game?.step === 'card' && !s.game.committed && typeof cardView(s.game.card, s.game).need === 'number') {
    try { s = commit(s, pid, {}); } catch { /* 選ぶ必要がある */ }
  }
  s = clone(s);
  const g = s.game;
  if (g?.step !== 'card') fail('いまはカードの場面ではありません');
  if (g.turn !== pid) fail('進めるのはカードを引いた人です');
  if (!g.committed) fail('先に指名・入力を終わらせてください');
  const seats = s.players.map((p) => p.id);
  g.turn = seats[(seats.indexOf(pid) + 1) % seats.length];
  g.card = null;
  g.picks = [];
  g.text = null;
  g.timer = null;
  g.step = g.pos >= g.deck.length ? 'end' : 'draw';
  if (g.step === 'end') log(s, '山札がなくなった');
  return s;
}

export function reshuffle(s0, rng = Math.random) {
  const s = clone(s0);
  const g = s.game;
  g.deck = shuffle(deckFor(s.settings?.deck || 'k1', { hard: g.hard }), rng);
  g.pos = 0;
  g.step = 'draw';
  g.card = null;
  log(s, 'シャッフルしてもう一周');
  return s;
}

// 担当者（またはCPU）がとれる手
export function autoAction(s, rng = Math.random) {
  const g = s.game;
  if (s.phase !== 'play' || !g) return null;
  const pid = actorOf(s);
  if (g.step === 'draw') return { type: 'draw', pid };
  if (g.step === 'card') {
    if (!g.committed) {
      const c = currentCard(s);
      if (c.need === 'text') return { type: 'commit', pid, input: { text: 'テストのルール' } };
      const cands = shuffle(candidates(s, pid), rng);
      return { type: 'commit', pid, input: { picks: cands.slice(0, c.need) } };
    }
    return { type: 'next', pid };
  }
  return null;
}

export function applyAction(s, a, rng = Math.random) {
  if (a.type === 'draw') return draw(s, a.pid);
  if (a.type === 'commit') return commit(s, a.pid, a.input);
  if (a.type === 'next') return next(s, a.pid);
  if (a.type === 'timer') return startTimer(s, a.pid);
  if (a.type === 'reshuffle') return reshuffle(s, rng);
  throw new Error('unknown ' + a.type);
}
