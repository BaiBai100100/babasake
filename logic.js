// ゲームの状態遷移（純粋関数）。ブラウザでも Node でも動く。
import { ODAI, hardText } from './odai.js';
import { CPUS } from './cpus.js';

export const SUITS = ['S', 'H', 'D', 'C'];
export const DECK = [...SUITS.flatMap((s) => Array.from({ length: 13 }, (_, i) => s + (i + 1))), 'JK'];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export const rankOf = (id) => (id === 'JK' ? 0 : parseInt(id.slice(1), 10));
export const suitOf = (id) => (id === 'JK' ? 'J' : id[0]);
export const RANK_LABEL = ['JOKER', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const cardLabel = (id) => (id === 'JK' ? 'JOKER' : { S: '♠', H: '♥', D: '♦', C: '♣' }[suitOf(id)] + RANK_LABEL[rankOf(id)]);

const clone = (o) => JSON.parse(JSON.stringify(o));
const fail = (msg) => { throw new Error(msg); };

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const nameOf = (s, pid) => s.players.find((p) => p.id === pid)?.name ?? '？';

// ---------- ロビー ----------
export function makeRoomState(code, host, now = Date.now(), kind = 'baba', settings = {}) {
  return { v: 1, ts: now, by: host.id, room: code, kind, settings, hostId: host.id, phase: 'lobby', players: [{ id: host.id, name: host.name }], game: null, round: 0 };
}

export function setSettings(s0, patch) {
  const s = clone(s0);
  if (s.phase !== 'lobby') fail('設定はロビーで変えられます');
  s.settings = { ...(s.settings || {}), ...patch };
  return s;
}

export function addPlayer(s0, p) {
  const s = clone(s0);
  const ex = s.players.find((x) => x.id === p.id);
  if (ex) { ex.name = p.name; return s; }
  if (s.phase !== 'lobby') fail('ゲーム中は参加できません');
  if (s.players.length >= MAX_PLAYERS) fail(`参加できるのは${MAX_PLAYERS}人までです`);
  s.players.push({ id: p.id, name: p.name });
  return s;
}

export function removePlayer(s0, pid) {
  const s = clone(s0);
  if (s.phase !== 'lobby') fail('ゲーム中は抜けられません');
  s.players = s.players.filter((p) => p.id !== pid);
  if (s.hostId === pid && s.players.length) s.hostId = s.players[0].id;
  return s;
}

export function movePlayer(s0, pid, delta) {
  const s = clone(s0);
  const i = s.players.findIndex((p) => p.id === pid);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= s.players.length) return s;
  [s.players[i], s.players[j]] = [s.players[j], s.players[i]];
  return s;
}

// CPUを1人呼ぶ（まだ来ていないキャラから順に）
export function addCpu(s0) {
  const s = clone(s0);
  if (s.phase !== 'lobby') fail('CPUはロビーで呼べます');
  if (s.players.length >= MAX_PLAYERS) fail(`参加できるのは${MAX_PLAYERS}人までです`);
  const used = new Set(s.players.filter((p) => p.cpu).map((p) => p.cpu));
  const c = CPUS.find((x) => !used.has(x.key));
  if (!c) fail('CPUはこれ以上呼べません');
  s.players.push({ id: `cpu-${c.key}`, name: c.name, cpu: c.key });
  return s;
}
export const isCpu = (s, pid) => !!s.players.find((p) => p.id === pid)?.cpu;

// 2人モード・泥酔モードを反映したお題
export function odaiOf(id, g) {
  const d = ODAI[id];
  if (!d) return null;
  let t = (g?.duo && d.t2) || d.t;
  if (g?.hard) t = hardText(t);
  const fx = g?.duo && 'fx2' in d ? d.fx2 : d.fx;
  return { ...d, t, fx };
}

export function makeHost(s0, pid) {
  const s = clone(s0);
  if (!s.players.some((p) => p.id === pid)) fail('参加者ではありません');
  s.hostId = pid;
  return s;
}

export function backToLobby(s0) {
  const s = clone(s0);
  s.phase = 'lobby';
  s.game = null;
  return s;
}

// ---------- ゲーム補助 ----------
export function discardPairs(hand) {
  const keep = [];
  const removed = [];
  const byRank = new Map();
  for (const c of hand) {
    if (c === 'JK') { keep.push(c); continue; }
    const r = rankOf(c);
    if (byRank.has(r)) {
      const other = byRank.get(r);
      byRank.delete(r);
      keep.splice(keep.indexOf(other), 1);
      removed.push([other, c]);
    } else {
      byRank.set(r, c);
      keep.push(c);
    }
  }
  return { hand: keep, removed };
}

export const isActive = (g, pid) => (g.hands[pid]?.length ?? 0) > 0;
export const activePlayers = (s) => s.players.map((p) => p.id).filter((id) => isActive(s.game, id));

export function nextActive(s, fromPid, dir) {
  const seats = s.players.map((p) => p.id);
  const n = seats.length;
  const i = seats.indexOf(fromPid);
  for (let k = 1; k <= n; k++) {
    const j = (((i + dir * k) % n) + n) % n;
    if (isActive(s.game, seats[j])) return seats[j];
  }
  return null;
}

export function neighborsOf(s, pid) {
  const seats = s.players.map((p) => p.id);
  const n = seats.length;
  const i = seats.indexOf(pid);
  const set = new Set([seats[(i + 1) % n], seats[(i - 1 + n) % n]]);
  set.delete(pid);
  return [...set];
}

export function actorOf(s) {
  if (s.phase === 'lobby' || s.phase === 'over') return s.hostId;
  const g = s.game;
  if (!g) return s.hostId;
  if (g.step === 'draw') return g.turn;
  if (g.step === 'choose' || g.step === 'odai') return g.pair?.by;
  if (g.step === 'penalty') return g.finished[0] ?? s.hostId;
  return s.hostId;
}

export const drawTarget = (s) => (s.game?.step === 'draw' ? nextActive(s, s.game.turn, s.game.dir) : null);

function log(s, msg) {
  const g = s.game;
  g.log.push({ n: g.seq, m: msg });
  if (g.log.length > 40) g.log.splice(0, g.log.length - 40);
}

function finishCheck(s, pids) {
  const g = s.game;
  for (const pid of pids) {
    if (g.hands[pid].length === 0 && !g.finished.includes(pid)) {
      g.finished.push(pid);
      log(s, `${nameOf(s, pid)}が${g.finished.length}番に上がり`);
    }
  }
}

function endCheck(s) {
  const g = s.game;
  const act = activePlayers(s);
  if (act.length > 1) return false;
  g.loser = act[0] ?? null;
  g.turn = null;
  g.pair = null;
  g.step = 'penalty';
  if (g.loser) log(s, `${nameOf(s, g.loser)}の手にJOKER。負け！`);
  return true;
}

function afterTurn(s, fromPid) {
  const g = s.game;
  if (endCheck(s)) return;
  let next = nextActive(s, fromPid, g.dir);
  while (g.skip > 0) {
    const skipped = next;
    next = nextActive(s, next, g.dir);
    g.skip--;
    log(s, `${nameOf(s, skipped)}の番はスキップ`);
  }
  g.turn = next;
  g.step = 'draw';
}

function seatOrderedDiscard(s, pids) {
  const g = s.game;
  for (const pid of pids) {
    const { hand, removed } = discardPairs(g.hands[pid]);
    g.hands[pid] = hand;
    for (const [a, b] of removed) log(s, `${nameOf(s, pid)}の手札で${cardLabel(a)}と${cardLabel(b)}がそろって捨て札に（お題なし）`);
  }
  finishCheck(s, pids);
}

// ---------- ゲーム本体 ----------
export function startGame(s0, rng = Math.random) {
  const s = clone(s0);
  if (s.players.length < MIN_PLAYERS) fail(`${MIN_PLAYERS}人以上で始められます`);
  const deck = shuffle(DECK, rng);
  const n = s.players.length;
  const start = Math.floor(rng() * n);
  const hands = {};
  s.players.forEach((p) => { hands[p.id] = []; });
  deck.forEach((c, i) => hands[s.players[(start + i) % n].id].push(c));
  for (const p of s.players) hands[p.id] = discardPairs(hands[p.id]).hand;
  s.phase = 'play';
  s.round = (s.round || 0) + 1;
  s.game = {
    hands, dir: 1, turn: null, step: 'draw', pair: null, finished: [], loser: null,
    skip: 0, double: false, rule: null, rules: [], penalty: null, log: [], seq: 0, lastDraw: null, pairs: 0,
    duo: s.players.length === 2, hard: !!s.settings?.hard, chaser: false,
  };
  log(s, `第${s.round}戦スタート。最初のペアは捨てた（お題なし）`);
  finishCheck(s, s.players.map((p) => p.id));
  if (endCheck(s)) return s;
  const act = activePlayers(s);
  s.game.turn = act[Math.floor(rng() * act.length)];
  return s;
}

export function draw(s0, pid, index, rng = Math.random) {
  const s = clone(s0);
  const g = s.game;
  if (s.phase !== 'play' || g.step !== 'draw') fail('いまは引く場面ではありません');
  if (g.turn !== pid) fail('あなたの番ではありません');
  const from = nextActive(s, pid, g.dir);
  if (!from || from === pid) fail('引く相手がいません');
  const fromHand = g.hands[from];
  const idx = Math.max(0, Math.min(fromHand.length - 1, index | 0));
  const card = fromHand.splice(idx, 1)[0];
  g.seq++;
  g.chaser = false;
  const mine = g.hands[pid];
  const m = card === 'JK' ? -1 : mine.findIndex((c) => c !== 'JK' && rankOf(c) === rankOf(card));
  if (m >= 0) {
    const own = mine.splice(m, 1)[0];
    g.pairs++;
    g.pair = { by: pid, from, cards: [card, own], chosen: null, picks: [], text: null, committed: false, double: false, result: null, peek: null };
    g.step = 'choose';
    g.lastDraw = { by: pid, from, card, matched: true, seq: g.seq };
    log(s, `${nameOf(s, pid)}が${nameOf(s, from)}から引いて、${RANK_LABEL[rankOf(card)]}のペア成立`);
    finishCheck(s, [from, pid]);
    return s;
  }
  mine.splice(Math.floor(rng() * (mine.length + 1)), 0, card);
  g.lastDraw = { by: pid, from, card, matched: false, seq: g.seq };
  log(s, `${nameOf(s, pid)}が${nameOf(s, from)}から1枚引いた`);
  finishCheck(s, [from]);
  afterTurn(s, pid);
  return s;
}

// その場で決まる対象（手札最多など）を計算
function computeTargets(s, fx, pid) {
  const g = s.game;
  if (fx === 'neighbors') return neighborsOf(s, pid);
  if (fx === 'remaining') return activePlayers(s);
  if (fx === 'most' || fx === 'least') {
    const act = activePlayers(s);
    if (!act.length) return [];
    const counts = act.map((id) => g.hands[id].length);
    const target = fx === 'most' ? Math.max(...counts) : Math.min(...counts);
    return act.filter((id) => g.hands[id].length === target);
  }
  return null;
}

export function choose(s0, pid, cardId) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'choose') fail('いまはお題を選ぶ場面ではありません');
  if (g.pair.by !== pid) fail('お題を選ぶのはペアを作った人です');
  if (!g.pair.cards.includes(cardId)) fail('そのカードは選べません');
  g.pair.chosen = cardId;
  g.pair.double = g.double;
  g.double = false;
  const def = odaiOf(cardId, g);
  const auto = computeTargets(s, def.fx, pid);
  if (auto) g.pair.picks = auto;
  g.step = 'odai';
  log(s, `${nameOf(s, pid)}のお題：${cardLabel(cardId)}`);
  return s;
}

// 指名などの入力が要るお題で、候補になる人
export function pickCandidates(s, pid) {
  const g = s.game;
  const def = odaiOf(g.pair?.chosen, g) || {};
  if (def.fx === 'swap' || def.fx === 'peek') {
    if ((def.fx === 'swap') && !isActive(g, pid)) return [];
    return activePlayers(s).filter((id) => id !== pid);
  }
  return s.players.map((p) => p.id).filter((id) => id !== pid);
}

export function needCount(cardId) {
  const need = ODAI[cardId]?.need;
  return typeof need === 'number' ? need : 0;
}

// CPUが持ち主のとき「浮かせる」カードを選ぶ（たまにJOKERを浮かせてゆさぶる）
export function cpuRaise(hand, rng = Math.random) {
  if (!hand.length || rng() < 0.45) return null;
  if (hand.includes('JK') && rng() < 0.5) return 'JK';
  return hand[Math.floor(rng() * hand.length)];
}

function randomTake(hand, rng) {
  return hand.splice(Math.floor(rng() * hand.length), 1)[0];
}
function randomInsert(hand, card, rng) {
  hand.splice(Math.floor(rng() * (hand.length + 1)), 0, card);
}

export function commitOdai(s0, pid, input = {}, rng = Math.random) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'odai') fail('いまはお題の場面ではありません');
  const pr = g.pair;
  if (pr.by !== pid) fail('お題を進めるのはペアを作った人です');
  if (pr.committed) return s;
  const id = pr.chosen;
  const def = odaiOf(id, g);
  const times = pr.double ? 2 : 1;
  const need = def.need;
  if (typeof need === 'number' && need > 0) {
    const cands = pickCandidates(s, pid);
    // 選ぶ余地がない（2人モードなど）ときは自動で決まる
    const raw = input.picks?.length ? input.picks : (cands.length <= need ? cands : []);
    const picks = raw.filter((x) => cands.includes(x));
    const uniq = [...new Set(picks)];
    const required = Math.min(need, cands.length);
    if (uniq.length !== required) fail(required ? `${required}人を選んでください` : '対象がいません');
    pr.picks = uniq;
  }
  if (need === 'text') {
    const text = String(input.text || '').trim().slice(0, 40);
    if (!text) fail('縛りの内容を入れてください');
    pr.text = text;
  }
  const P = (x) => nameOf(s, x);
  switch (def.fx) {
    case 'skip':
      g.skip += times;
      pr.result = times > 1 ? '次の2人の番をとばす' : '次の人の番をとばす';
      break;
    case 'reverse':
      g.dir *= -1;
      pr.result = '引く向きが逆になった';
      break;
    case 'double':
      g.double = true;
      pr.result = '次のお題が2倍に';
      break;
    case 'rule':
      g.rule = { text: def.rule, by: pid };
      g.rules = [...(g.hard ? g.rules || [] : []), g.rule].slice(-3);
      pr.result = g.hard && g.rules.length > 1 ? `縛り「${def.rule}」追加（いま${g.rules.length}つ）` : `縛り「${def.rule}」スタート`;
      break;
    case 'rulecustom':
      g.rule = { text: pr.text, by: pid };
      g.rules = [...(g.hard ? g.rules || [] : []), g.rule].slice(-3);
      pr.result = g.hard && g.rules.length > 1 ? `縛り「${pr.text}」追加（いま${g.rules.length}つ）` : `縛り「${pr.text}」スタート`;
      break;
    case 'swap': {
      const b = pr.picks[0];
      if (!b || !isActive(g, pid) || !isActive(g, b)) { pr.result = '交換できる相手がいないので不発'; break; }
      let n = 0;
      for (let t = 0; t < times; t++) {
        if (!g.hands[pid].length || !g.hands[b].length) break;
        const ca = randomTake(g.hands[pid], rng);
        const cb = randomTake(g.hands[b], rng);
        randomInsert(g.hands[pid], cb, rng);
        randomInsert(g.hands[b], ca, rng);
        n++;
      }
      pr.result = `${P(pid)}と${P(b)}が${n}枚交換した`;
      seatOrderedDiscard(s, s.players.map((p) => p.id).filter((x) => x === pid || x === b));
      break;
    }
    case 'peek': {
      const b = pr.picks[0];
      if (!b || !isActive(g, b)) { pr.result = 'のぞける相手がいないので不発'; break; }
      pr.peek = shuffle(g.hands[b], rng).slice(0, times);
      pr.result = `${P(pid)}が${P(b)}の手札をのぞき見`;
      break;
    }
    case 'pass1': {
      for (let t = 0; t < times; t++) {
        const act = activePlayers(s);
        if (act.length < 2) break;
        const gifts = act.map((x) => ({ from: x, to: nextActive(s, x, g.dir), card: null }));
        for (const gf of gifts) gf.card = randomTake(g.hands[gf.from], rng);
        for (const gf of gifts) randomInsert(g.hands[gf.to], gf.card, rng);
      }
      pr.result = '全員が1枚ずつ次の人に渡した';
      seatOrderedDiscard(s, s.players.map((p) => p.id));
      break;
    }
    default:
      break;
  }
  pr.committed = true;
  if (pr.result) log(s, pr.result);
  return s;
}

export function finishOdai(s0, pid, rng = Math.random) {
  let s = s0;
  if (s.game?.step !== 'odai') fail('いまはお題の場面ではありません');
  if (!s.game.pair.committed) s = commitOdai(s, pid, {}, rng);
  s = clone(s);
  const g = s.game;
  if (g.pair.by !== pid) fail('お題を進めるのはペアを作った人です');
  const by = g.pair.by;
  g.pair = null;
  // 泥酔モードは8ペアごとにチェイサータイム
  if (g.hard && g.pairs % 8 === 0) { g.chaser = true; log(s, 'チェイサータイム：全員お水を一口'); }
  afterTurn(s, by);
  return s;
}

export function setPenalty(s0, pid, text) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'penalty') fail('いまは罰ゲームを決める場面ではありません');
  if (pid !== actorOf(s)) fail('罰ゲームを決めるのは1番に上がった人です');
  const t = String(text || '').trim().slice(0, 60);
  if (!t) fail('罰ゲームを入れてください');
  g.penalty = t;
  g.step = 'over';
  s.phase = 'over';
  log(s, `罰ゲーム：${t}`);
  return s;
}

// テスト・自動進行用：いまの担当者が取りうる手を1つ返す
export function autoAction(s, rng = Math.random) {
  const actor = actorOf(s);
  const g = s.game;
  if (s.phase !== 'play' || !g) return null;
  if (g.step === 'draw') {
    const from = drawTarget(s);
    return { type: 'draw', pid: actor, index: Math.floor(rng() * g.hands[from].length) };
  }
  if (g.step === 'choose') return { type: 'choose', pid: actor, card: g.pair.cards[Math.floor(rng() * 2)] };
  if (g.step === 'odai') {
    if (!g.pair.committed) {
      const id = g.pair.chosen;
      const need = odaiOf(id, g).need;
      const input = {};
      if (typeof need === 'number' && need > 0) input.picks = shuffle(pickCandidates(s, actor), rng).slice(0, need);
      if (need === 'text') input.text = 'テストの縛り';
      return { type: 'commit', pid: actor, input };
    }
    return { type: 'finish', pid: actor };
  }
  if (g.step === 'penalty') return { type: 'penalty', pid: actor, text: 'モノマネを1つ全力で' };
  return null;
}

export function applyAction(s, a, rng = Math.random) {
  switch (a.type) {
    case 'draw': return draw(s, a.pid, a.index, rng);
    case 'choose': return choose(s, a.pid, a.card);
    case 'commit': return commitOdai(s, a.pid, a.input, rng);
    case 'finish': return finishOdai(s, a.pid, rng);
    case 'penalty': return setPenalty(s, a.pid, a.text);
    default: throw new Error('unknown action ' + a.type);
  }
}
