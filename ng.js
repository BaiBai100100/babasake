// NGワードゲーム：自分のNGワードだけ見えない。言ったら、ほかの人が「言った！」→ 一口＆新しいNGワード
import { NG_WORDS } from './ng-data.js';
import { THEMES } from './talk-data.js';
import { shuffle, nameOf } from './logic.js';

export const MIN_PLAYERS = 2;
const clone = (o) => JSON.parse(JSON.stringify(o));
const fail = (m) => { throw new Error(m); };

export const wordText = (i) => NG_WORDS[i];
export const themeText = (g) => THEMES[g.theme];
export const outsOf = (g, pid) => g?.outs?.[pid] || 0;

function log(s, m) {
  s.game.log.push(m);
  if (s.game.log.length > 30) s.game.log.shift();
}

// 次のNGワード：いまだれかが持っている言葉と、最近言われた言葉は避ける
function nextWord(g, rng) {
  const all = NG_WORDS.map((_, i) => i);
  const now = new Set(Object.values(g.words));
  const recent = new Set(g.recent);
  let pool = all.filter((i) => !now.has(i) && !recent.has(i));
  if (!pool.length) pool = all.filter((i) => !now.has(i));
  return pool[Math.floor(rng() * pool.length)];
}

export function startGame(s0, rng = Math.random, now = Date.now()) {
  const s = clone(s0);
  if (s.players.length < MIN_PLAYERS) fail(`${MIN_PLAYERS}人以上で始められます`);
  const ids = s.players.map((p) => p.id);
  const pool = shuffle(NG_WORDS.map((_, i) => i), rng);
  const prevTheme = s.game?.theme;
  let theme = Math.floor(rng() * THEMES.length);
  if (theme === prevTheme) theme = (theme + 1) % THEMES.length;
  const minutes = Number(s.settings?.minutes ?? 5);
  s.phase = 'play';
  s.round = (s.round || 0) + 1;
  s.game = {
    kind: 'ng', step: 'talk', theme,
    words: Object.fromEntries(ids.map((pid, i) => [pid, pool[i]])),
    outs: Object.fromEntries(ids.map((pid) => [pid, 0])),
    said: [], recent: [], endsAt: minutes ? now + minutes * 60000 : null,
    notice: null, n: 0, log: [], hard: !!s.settings?.hard,
  };
  log(s, `第${s.round}ラウンド：テーマ「${THEMES[theme]}」`);
  return s;
}

// seen = 押した人の画面に出ていた言葉。同時に2人が押しても、2回目は「もう変わっています」で弾く
export function callOut(s0, by, target, seen, rng = Math.random, now = Date.now()) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'talk') fail('いまは会話中ではありません');
  if (g.endsAt && now >= g.endsAt) fail('時間切れです');
  if (by === target) fail('自分のNGワードは見えません');
  if (!(target in g.words)) fail('その人は参加していません');
  if (g.words[target] !== seen) fail('もう新しいNGワードに変わっています');
  const word = g.words[target];
  g.outs[target] = outsOf(g, target) + 1;
  g.said.push({ pid: target, word, by });
  g.recent = [...g.recent, word].slice(-15);
  g.words[target] = nextWord(g, rng);
  g.notice = { kind: 'out', by, target, word, n: ++g.n };
  log(s, `${nameOf(s, target)}がNGワード「${NG_WORDS[word]}」を言った（${nameOf(s, by)}が指摘）`);
  return s;
}

export function rerollTheme(s0, rng = Math.random) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'talk') fail('いまは会話中ではありません');
  let t = Math.floor(rng() * THEMES.length);
  if (t === g.theme) t = (t + 1) % THEMES.length;
  g.theme = t;
  g.rerolls = (g.rerolls || 0) + 1;
  log(s, `テーマを変更：「${THEMES[t]}」`);
  return s;
}

// 途中で帰った人を外す。その人のワードと回数も消す（結果に出さない）
export function removeMid(s0, pid) {
  const s = clone(s0);
  const g = s.game;
  if (!g || !s.players.some((p) => p.id === pid)) fail('その人はいません');
  if (s.players.length - 1 < MIN_PLAYERS) fail(`${MIN_PLAYERS}人より少なくなるので外せません`);
  log(s, `${nameOf(s, pid)}が途中で抜けた`);
  s.players = s.players.filter((p) => p.id !== pid);
  if (s.hostId === pid) s.hostId = s.players.find((p) => !p.cpu)?.id ?? s.players[0].id;
  delete g.words[pid];
  delete g.outs[pid];
  if (g.worst) g.worst = g.worst.filter((x) => x !== pid);
  return s;
}

function finish(s, kind) {
  const g = s.game;
  g.step = 'over';
  s.phase = 'over';
  g.notice = { kind, n: ++g.n };
  const max = Math.max(0, ...Object.values(g.outs));
  g.worst = max > 0 ? Object.keys(g.outs).filter((pid) => g.outs[pid] === max) : [];
}

export function timeUp(s0, now = Date.now()) {
  const s = clone(s0);
  const g = s.game;
  if (g?.step !== 'talk' || !g.endsAt || now < g.endsAt) fail('まだ時間があります');
  log(s, '時間切れ');
  finish(s, 'timeup');
  return s;
}

export function endRound(s0) {
  const s = clone(s0);
  if (s.game?.step !== 'talk') fail('いまは会話中ではありません');
  log(s, 'ラウンド終了');
  finish(s, 'ended');
  return s;
}
