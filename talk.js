// トークトライアル風：全員に秘密のミッション。会話を誘導して「達成！」、怪しい人は「見破る」
import { THEMES, MISSIONS } from './talk-data.js';
import { shuffle, nameOf } from './logic.js';

export const MIN_PLAYERS = 2;
const clone = (o) => JSON.parse(JSON.stringify(o));
const fail = (m) => { throw new Error(m); };

export const themeText = (g) => THEMES[g.theme];
export const missionText = (i) => MISSIONS[i];
export const alive = (s) => s.players.map((p) => p.id).filter((pid) => s.game.status[pid] === 'play');

function log(s, m) {
  s.game.log.push(m);
  if (s.game.log.length > 30) s.game.log.shift();
}

export function startGame(s0, rng = Math.random, now = Date.now()) {
  const s = clone(s0);
  if (s.players.length < MIN_PLAYERS) fail(`${MIN_PLAYERS}人以上で始められます`);
  const ids = s.players.map((p) => p.id);
  const pool = shuffle(MISSIONS.map((_, i) => i), rng);
  const missions = {};
  const options = {};
  ids.forEach((pid, i) => { missions[pid] = pool[i]; });
  const rest = pool.slice(ids.length);
  // 見破るときの3択（本物＋ダミー2つ）。全員の画面で同じ並びになるよう最初に決めておく
  ids.forEach((pid, i) => { options[pid] = shuffle([missions[pid], rest[2 * i], rest[2 * i + 1]], rng); });
  const prevTheme = s.game?.theme;
  let theme = Math.floor(rng() * THEMES.length);
  if (theme === prevTheme) theme = (theme + 1) % THEMES.length;
  const minutes = Number(s.settings?.minutes || 0);
  s.phase = 'play';
  s.round = (s.round || 0) + 1;
  s.game = {
    kind: 'talk', step: 'talk', theme, missions, options,
    status: Object.fromEntries(ids.map((pid) => [pid, 'play'])),
    used: {}, winner: null, endsAt: minutes ? now + minutes * 60000 : null,
    notice: null, n: 0, log: [], hard: !!s.settings?.hard,
  };
  log(s, `第${s.round}ラウンド：テーマ「${THEMES[theme]}」`);
  return s;
}

// 通算の勝ち数（ラウンドをまたいで残る）
export const winsOf = (s, pid) => s.score?.[pid] || 0;

function finish(s, winner, kind) {
  const g = s.game;
  g.winner = winner;
  if (winner) {
    g.status[winner] = 'won';
    s.score = { ...(s.score || {}), [winner]: winsOf(s, winner) + 1 };
  }
  g.step = 'over';
  s.phase = 'over';
  g.notice = { kind, who: winner, n: ++g.n };
}

export function achieve(s0, pid) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'talk') fail('いまは会話中ではありません');
  if (g.status[pid] !== 'play') fail('バレた人は達成できません');
  log(s, `${nameOf(s, pid)}がミッション達成：${MISSIONS[g.missions[pid]]}`);
  finish(s, pid, 'won');
  return s;
}

export function accuse(s0, by, target, mission) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'talk') fail('いまは会話中ではありません');
  if (g.status[by] !== 'play') fail('バレた人は見破れません');
  if (g.used[by]) fail('見破りチャンスは1ラウンド1回です');
  if (by === target) fail('自分は見破れません');
  if (g.status[target] !== 'play') fail('その人はもうバレています');
  if (!g.options[target]?.includes(mission)) fail('その選択肢はありません');
  g.used[by] = true;
  g.n++;
  if (g.missions[target] === mission) {
    g.status[target] = 'out';
    g.notice = { kind: 'busted', by, target, mission, n: g.n };
    log(s, `${nameOf(s, by)}が${nameOf(s, target)}のミッションを見破った：${MISSIONS[mission]}`);
    const left = alive(s);
    if (left.length === 1) finish(s, left[0], 'last');
  } else {
    g.notice = { kind: 'miss', by, target, n: g.n };
    log(s, `${nameOf(s, by)}の見破りはハズレ`);
  }
  return s;
}

// テーマの引き直し：だれも達成・見破りをしていない間だけ
export function rerollTheme(s0, rng = Math.random) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'talk') fail('いまは会話中ではありません');
  if (g.n > 0) fail('見破りや達成のあとはテーマを変えられません');
  let t = Math.floor(rng() * THEMES.length);
  if (t === g.theme) t = (t + 1) % THEMES.length;
  g.theme = t;
  g.rerolls = (g.rerolls || 0) + 1;
  log(s, `テーマを変更：「${THEMES[t]}」`);
  return s;
}

// 途中で帰った人を外す。残りが1人になったら、その人の逃げ切り
export function removeMid(s0, pid) {
  const s = clone(s0);
  const g = s.game;
  if (!g || !s.players.some((p) => p.id === pid)) fail('その人はいません');
  if (s.players.length - 1 < MIN_PLAYERS) fail(`${MIN_PLAYERS}人より少なくなるので外せません`);
  log(s, `${nameOf(s, pid)}が途中で抜けた`);
  s.players = s.players.filter((p) => p.id !== pid);
  if (s.hostId === pid) s.hostId = s.players.find((p) => !p.cpu)?.id ?? s.players[0].id;
  if (g.step === 'talk') {
    const left = alive(s);
    if (left.length === 1) finish(s, left[0], 'last');
  }
  return s;
}

export function timeUp(s0, now = Date.now()) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'talk' || !g.endsAt || now < g.endsAt) fail('まだ時間があります');
  log(s, '時間切れ');
  finish(s, null, 'timeup');
  return s;
}

export function endRound(s0) {
  const s = clone(s0);
  if (s.game?.step !== 'talk') fail('いまは会話中ではありません');
  log(s, 'ラウンド終了（勝者なし）');
  finish(s, null, 'ended');
  return s;
}
