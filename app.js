// 画面と操作。ルールは logic.js（ババ酒）と kioku.js（記憶）、通信は net.js。
import * as L from './logic.js';
import * as K from './kioku.js';
import * as T from './talk.js';
import * as N from './ng.js';
import { SUIT_INFO, PENALTY_PRESETS } from './odai.js';
import { GENRES, PENALTY_CHOICES, PENALTY_CHOICES_HARD } from './kioku-data.js';
import { CPU_BY_KEY, cpuLine } from './cpus.js';
import { Room, BROKERS, waitForState } from './net.js';
import { kiokuDrink, kiokuHitDrink, babaDrink, drinkKind } from './drink.js';
import * as FX from './fx.js';
/* global qrcode */

const params = new URLSearchParams(location.search);
const BOT = params.has('bot');
const BOT_START = Number(params.get('start') || 0);
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ---------- 保存 ----------
const store = {
  get(k) { try { return localStorage.getItem('babasake:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('babasake:' + k, v); } catch { /* noop */ } },
  del(k) { try { localStorage.removeItem('babasake:' + k); } catch { /* noop */ } },
};
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
const me = { id: store.get('id') || newId(), name: params.get('name') || store.get('name') || '' };
store.set('id', me.id);

// ---------- ゲームの一覧 ----------
const GAMES = {
  baba: {
    kind: 'baba', tags: ['CPUと1人でも', '2人モード'], title: '笑うババには酒来たる', titleHtml: '笑うババには<br>酒来たる', badge: '', img: 'hub-baba', tone: 'paper',
    desc: 'ペアがそろうたびにお題が出るババ抜き。表情の読み合いで盛り上がる', meta: '2〜10人', settings: {},
    steps: ['配って、そろったペアを捨てる', 'となりの人から1枚引く', 'ペアがそろったらお題を実行', '最後にJOKERを持っていた人の負け'],
    localLabel: '1人でCPUと遊ぶ',
  },
  kioku1: {
    kind: 'kioku', tags: ['1台でもOK', 'CPU', '2人モード'], title: '記憶無くしちゃダメですか', titleHtml: '記憶無くしちゃ<br>ダメですか', badge: '第1弾', img: 'hub-kioku1', tone: 'pink',
    desc: '当てはまった人・直近◯◯した人・全員参加・遅刻ドジ・飲みゲー。元祖の60枚', meta: '2人〜', settings: { deck: 'k1' },
    steps: ['順番にカードを引く（引いた人が「私」）', '書いてあることに従う', '次の人へ'],
    localLabel: 'このスマホ1台で遊ぶ',
  },
  kioku2: {
    kind: 'kioku', tags: ['1台でもOK', 'CPU', '2人モード'], title: '記憶無くしちゃダメですか', titleHtml: '記憶無くしちゃ<br>ダメですか', badge: '第2弾', img: 'hub-kioku2', tone: 'blue',
    desc: '王様・指名・ミニゲーム・乾杯・飲みゲー。もっと攻めた59枚', meta: '2人〜', settings: { deck: 'k2' },
    steps: ['順番にカードを引く（引いた人が「私」）', '書いてあることに従う', '次の人へ'],
    localLabel: 'このスマホ1台で遊ぶ',
  },
  talk: {
    kind: 'talk', tags: ['1台でもOK'], title: 'トークトライアル', titleHtml: 'トーク<br>トライアル', badge: 'NEW', img: 'hub-talk', tone: 'ink',
    desc: '全員に秘密のミッション。会話をさりげなく誘導して、バレずに達成したら勝ち', meta: '2〜10人', settings: { minutes: 5 },
    steps: ['全員に同じトークテーマと、自分だけの秘密のミッションが届く', 'テーマに沿って自由に会話する', 'ミッションが起きたら「達成！」。怪しい人は「見破る」'],
    localLabel: 'このスマホ1台で遊ぶ（ミッションはこっそり確認）',
  },
  ng: {
    kind: 'ng', tags: ['各自のスマホ専用'], title: 'NGワードゲーム', titleHtml: 'NGワード<br>ゲーム', badge: 'NEW', img: 'hub-ng', tone: 'blue',
    desc: '自分のNGワードだけ見えない。みんなのスマホには見えている。言ったら一口＆新しいワード', meta: '2〜10人', settings: { minutes: 5 },
    steps: ['全員にNGワード。ほかの人のワードだけが自分のスマホに見える', 'テーマに沿って会話して、相手に言わせる', '言ったら「言った！」→ その人が一口、新しいワードに'],
    localLabel: null,
  },
};
const DECK_LABEL = { k1: '第1弾', k2: '第2弾', mix: '第1弾＋第2弾' };

// ---------- 画面の状態 ----------
const ui = {
  screen: 'home', // home | setup | join | connecting | room
  pick: null,
  code: (params.get('r') || '').toUpperCase(),
  broker: params.has('b') ? Number(params.get('b')) : null,
  state: null,
  room: null,
  local: false,
  net: 'offline',
  sel: null,
  hover: null,
  raised: {},
  picks: [],
  text: '',
  penaltyText: '',
  addName: '',
  sheet: null,
  toast: null,
  proxy: false,
  newCard: null,
  busy: '',
  cpuHover: null,
  cpuRaisedSeq: null,
};
const app = document.getElementById('app');
if (ui.code) ui.screen = 'join';

// ---------- 小物 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = () => ui.state;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const nm = (pid) => esc(L.nameOf(S(), pid));
const kindOf = (s = S()) => s?.kind || 'baba';
const isKioku = (s = S()) => kindOf(s) === 'kioku';
const isTalk = (s = S()) => kindOf(s) === 'talk';
const isNg = (s = S()) => kindOf(s) === 'ng';
// 順番のない会話ゲーム（トークトライアル・NGワード）
const isChat = (s = S()) => isTalk(s) || isNg(s);
const actorOf = (s) => (isKioku(s) ? K.actorOf(s) : isChat(s) ? s.hostId : L.actorOf(s));
const minPlayers = (s = S()) => (isKioku(s) ? K.MIN_PLAYERS : isTalk(s) ? T.MIN_PLAYERS : isNg(s) ? N.MIN_PLAYERS : L.MIN_PLAYERS);
const startFor = (x) => (isKioku(x) ? K.startGame(x) : isTalk(x) ? T.startGame(x) : isNg(x) ? N.startGame(x) : L.startGame(x));
const talkPen = (s = S()) => (s?.settings?.hard || s?.game?.hard ? '二口' : '一口');
const isHost = () => ui.local || S()?.hostId === me.id;
const inRoom = () => ui.local || !!S()?.players.some((p) => p.id === me.id);
const actor = () => (S() ? actorOf(S()) : null);
const cpuOf = (pid) => S()?.players.find((p) => p.id === pid)?.cpu || null;
const isCpu = (pid) => !!cpuOf(pid);
const roomUrl = () => `${location.origin}${location.pathname}?r=${ui.code}&b=${ui.broker}`;
const gameMeta = (s = S()) => (isKioku(s) ? GAMES[s?.settings?.deck === 'k2' ? 'kioku2' : 'kioku1'] : isTalk(s) ? GAMES.talk : isNg(s) ? GAMES.ng : GAMES.baba);
const gameBadge = (s = S()) => (isKioku(s) ? DECK_LABEL[s?.settings?.deck || 'k1'] : '');

// CPUの番で、人がやること（お題の実行→次へ）は、だれが押してもいい
function humanStepForCpu() {
  const s = S();
  const g = s?.game;
  if (!g || s.phase !== 'play') return false;
  if (isKioku(s)) return g.step === 'card' && g.committed;
  return g.step === 'odai' && !!g.pair?.committed;
}
function iAct() {
  const s = S();
  if (!s) return false;
  const a = actorOf(s);
  // 1台モードはだれの番でもこの端末で押す。ただし CPU が自分で引く・指名する間はボタンを出さない
  // （出すと、選んでいる途中で CPU が先に決めてボタンが消える）
  if (ui.local && isKioku(s)) return !(a && isCpu(a) && !humanStepForCpu());
  if (a === me.id) return true;
  if (isHost() && ui.proxy) return true;
  if (a && isCpu(a) && inRoom() && humanStepForCpu()) return true;
  return false;
}

function toast(msg, ms = 2600) {
  ui.toast = { msg, until: Date.now() + ms };
  render();
  setTimeout(() => { if (ui.toast && Date.now() >= ui.toast.until) { ui.toast = null; render(); } }, ms + 50);
}
function vibrate(p) { try { navigator.vibrate?.(p); } catch { /* noop */ } }

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* noop */ }
}

// 再描画されても途中から続くアニメーション
const animStart = {};
function anim(key, dur = 700) {
  const t0 = (animStart[key] ??= Date.now());
  const el = Date.now() - t0;
  return el < dur ? { cls: 'flip', style: `animation-delay:-${el}ms` } : { cls: '', style: '' };
}

// ---------- アイコン（線画） ----------
const svg = (d, w = 20) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  share: svg('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>', 18),
  dir: svg('<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>', 14),
  cards: svg('<rect x="6" y="3" width="12" height="17" rx="2"/><path d="M3 7v11a3 3 0 0 0 3 3h9"/>', 13),
  people: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.4 6-5.4s5.4 2 6 5.4"/><path d="M16 5.3a3 3 0 0 1 0 5.6M18 14.8c1.6.8 2.7 2.6 3 5.2"/>', 15),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 22),
  back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>', 18),
  timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>', 18),
  bot: svg('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5"/>', 18),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 18),
};

// ---------- 顔アイコン ----------
function avatar(p, size = 'm') {
  if (p?.cpu) return `<img class="av ${size}" src="img/${CPU_BY_KEY[p.cpu].img}.webp" alt="">`;
  const ch = esc((p?.name || '？').slice(0, 1));
  const tone = [...(p?.id || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % 2 ? 'blue' : 'pink';
  return `<span class="av ${size} txt ${tone}" aria-hidden="true">${ch}</span>`;
}

// 飲みゲーのお題（アプリが決めた言葉）を目立たせる。html はエスケープ済みの文面
// どすこいの頭文字のような1〜2文字のお題は、ほかの言葉の中の同じ文字まで光らないよう「」『』の中だけ
function markTopic(html, topic) {
  if (!topic) return html;
  const t = esc(topic);
  const wrap = `<span class="topic">${t}</span>`;
  if (t.length > 2) return html.split(t).join(wrap);
  return html.replace(/([「『])([^「」『』]{1,2})([」』])/g, (m, a, x, b) => (x === t ? a + wrap + b : m));
}

// ---------- トランプ ----------
function cardFace(id, { size = 'm', extra = '', attrs = '' } = {}) {
  if (id === 'JK') return `<div class="card face joker ${size} ${extra}" ${attrs}><img src="img/joker.webp" alt="JOKER"></div>`;
  const s = L.suitOf(id);
  const info = SUIT_INFO[s];
  const r = L.RANK_LABEL[L.rankOf(id)];
  return `<div class="card face ${info.color} ${size} ${extra}" ${attrs}>
    <span class="rk">${r}</span><span class="st">${info.mark}</span>
    <span class="pip">${info.mark}</span><span class="role">${info.short}</span></div>`;
}
const cardBack = ({ size = 'm', extra = '', attrs = '' } = {}) => `<div class="card back ${size} ${extra}" ${attrs}></div>`;

function bigCard(id, g, { extra = '', attrs = '', double = false, flip = null } = {}) {
  const fl = flip || { cls: '', style: '' };
  if (id === 'JK') return `<div class="bigcard joker ${fl.cls}" style="${fl.style}"><img src="img/joker.webp" alt="JOKER"></div>`;
  const s = L.suitOf(id);
  const info = SUIT_INFO[s];
  const def = L.odaiOf(id, g);
  return `<div class="bigcard ${info.color} ${extra} ${fl.cls}" style="${fl.style}" ${attrs}>
    <div class="bc-art"><img src="img/s-${s}.webp" alt=""></div>
    <div class="bc-top"><span class="bc-rk">${L.RANK_LABEL[L.rankOf(id)]}</span><span class="bc-st">${info.mark}</span><span class="bc-role">${info.role}</span></div>
    <p class="bc-text">${markTopic(esc(def.t), def.topic)}</p>
    ${double ? `<div class="x2">効果2倍：飲むなら${g?.hard ? '四口' : '二口'}、やるなら2回</div>` : ''}
  </div>`;
}

// ---------- 通信の入口 ----------
function newer(a, b) {
  if (!b) return true;
  if ((a.created || 0) !== (b.created || 0)) return (a.created || 0) > (b.created || 0);
  if (a.v !== b.v) return a.v > b.v;
  if (a.ts !== b.ts) return a.ts > b.ts;
  return String(a.by) > String(b.by);
}

let healAt = 0;
function onRemoteState(s, retained) {
  if (!s || !s.v || !s.players || ui.local) return;
  ui.syncUntil = 0; // 部屋の状態が1つでも届いたら、つながり直し後の待ちは終わり
  if (ui.state && !newer(s, ui.state)) {
    if (retained && newer(ui.state, s) && Date.now() - healAt > 1500) {
      healAt = Date.now();
      ui.room?.publishState(ui.state);
    }
    return;
  }
  const prev = ui.state;
  ui.state = s;
  afterStateChange(prev, s);
  render();
}

function commit(fn) {
  if (!S()) return false;
  // 切れている間・つながり直した直後（最新の状態を受け取るまで）は押せない。古い状態から作った手で、みんなの進行を巻き戻さないため
  if (!ui.local && ui.room && (ui.net !== 'online' || Date.now() < ui.syncUntil)) {
    // CPU・タイマーの自動の操作でも呼ばれるので、お知らせは3秒に1回まで
    if (Date.now() - (ui.blockedAt || 0) > 3000) {
      ui.blockedAt = Date.now();
      toast(ui.net === 'online' ? '最新の状態を受け取っています…もう一度押してね' : '再接続中です。つながったらもう一度押してね');
    }
    if (ui.net !== 'online') ui.room.nudge();
    return false;
  }
  try {
    const next = fn(S());
    next.v = S().v + 1;
    next.ts = Date.now();
    next.by = me.id;
    const prev = S();
    ui.state = next;
    if (ui.local) store.set('local', JSON.stringify(next));
    else ui.room?.publishState(next);
    afterStateChange(prev, next);
    render();
    return true;
  } catch (e) {
    toast(e.message || String(e));
    return false;
  }
}

function afterStateChange(prev, s) {
  let stampDelay = 0;
  const g = s.game;
  const pg = prev?.game;
  if (s.phase === 'lobby' && ui.wantJoin && !ui.local && !s.players.some((p) => p.id === me.id)) scheduleJoin();
  const turnKey = (x) => `${x?.round}:${x?.game?.seq ?? x?.game?.n}:${x?.game?.step}`;
  if (!prev || turnKey(prev) !== turnKey(s)) {
    ui.sel = null;
    ui.picks = [];
    ui.text = '';
    ui.proxy = false;
  }
  if (!isKioku(s) && g && pg && g.lastDraw && (!pg.lastDraw || pg.lastDraw.seq !== g.lastDraw.seq || prev.round !== s.round)) {
    const d = g.lastDraw;
    const label = L.cardLabel(d.card);
    if (d.by === me.id && !d.matched) {
      ui.newCard = d.card;
      setTimeout(() => { ui.newCard = null; render(); }, 2500);
      toast(d.card === 'JK' ? 'JOKERを引いた…顔に出さないで' : `${label} を引いた（そろわず）`);
      if (d.card === 'JK') FX.playJoker('got');
    } else if (d.from === me.id) {
      toast(d.card === 'JK' ? 'JOKERを引かれた！ ババが移った' : `${label} を引かれた`);
      if (d.card === 'JK') FX.playJoker('gone');
    } else if (!d.matched) {
      toast(`${L.nameOf(s, d.by)}が${L.nameOf(s, d.from)}から引いた`, 1800);
    }
  }
  if (g?.chaser && !pg?.chaser) toast('チェイサータイム！ 全員お水を一口', 3500);
  if (isChat(s) && g?.notice && pg && g.notice.n !== pg.notice?.n && prev.round === s.round) {
    // 文面は画面のお知らせに出るので、トーストは出さない（結果画面にかぶるため）。代わりにハンコを押す
    const st = talkStamp(s, g.notice);
    if (st) { FX.playStamp(st); stampDelay = FX.STAMP_MS - 250; }
  }
  if (isChat(s) && g && pg && prev.round === s.round && (g.rerolls || 0) !== (pg.rerolls || 0)) {
    toast(`テーマが変わった：「${T.themeText(g)}」`, 2600);
    FX.playSounds([['pop', 0], ['pop', 0.12]]);
  }
  if (isKioku(s) && g?.notice && pg && (!pg.notice || pg.notice.n !== g.notice.n || pg.notice.kind !== g.notice.kind)) {
    if (g.notice.kind === 'paid' || g.notice.kind === 'kanpai') vibrate([120, 60, 120]);
  }
  const drink = drinkOf(prev, s);
  if (drink && stampDelay) setTimeout(() => FX.playDrink(drink), stampDelay);
  else if (drink) FX.playDrink(drink);
  const myTurn = (x) => x?.phase === 'play' && !isTalk(x) && actorOf(x) === me.id;
  if (myTurn(s) && !myTurn(prev)) vibrate([70, 40, 70]);
  document.title = myTurn(s) && !ui.local ? '● あなたの番｜NOMIKAI CARDS' : 'NOMIKAI CARDS';
  keepAwake(s.phase === 'play' || s.phase === 'over');
  scheduleCpu();
  if (BOT) scheduleBot();
}

// 飲むことが確定した瞬間（全員の画面で同じ判定）。再接続や読み込み直後（prev なし）は出さない
function drinkOf(prev, s) {
  const g = s?.game;
  const pg = prev?.game;
  if (!g || !pg || prev.created !== s.created || prev.round !== s.round) return null;
  if (isNg(s)) {
    const nt = g.notice;
    return nt && nt.n !== pg.notice?.n && nt.kind === 'out' ? { kind: 'solo', water: false, mult: 1 } : null;
  }
  if (isTalk(s)) {
    const nt = g.notice;
    if (!nt || nt.n === pg.notice?.n) return null;
    if (nt.kind === 'busted' || nt.kind === 'miss') return { kind: 'solo', water: false, mult: 1 };
    return { kind: 'multi', water: false, mult: 1 };
  }
  if (isKioku(s)) {
    // 当てはまり系は「いた！」が押された瞬間（だれもいないときは出さない）
    if (g.lastHit && g.lastHit.n !== pg.lastHit?.n) return kiokuHitDrink(kPen(s), g.lastHit.mult);
    // 勝負・条件つきは「飲んだ！」が押された瞬間（セーフなら出さない）
    if (g.lastDrink && g.lastDrink.n !== pg.lastDrink?.n) {
      const c = K.cardView(g.lastDrink.card, g);
      const d = kiokuDrink(c, { pen: kPen(s), foot: GENRES[c.g]?.foot });
      return d?.after ? d : null;
    }
    if (g.step !== 'card' || !g.card || (pg.step === 'card' && pg.n === g.n)) return null;
    const c = K.currentCard(s);
    const d = kiokuDrink(c, { pen: kPen(s), foot: GENRES[c.g]?.foot, pot: g.pot || 0 });
    return d && !d.after ? d : null;
  }
  if (g.lastDrink && g.lastDrink.seq !== pg.lastDrink?.seq) {
    const d = babaDrink(g.lastDrink.id, L.odaiOf(g.lastDrink.id, g), { double: g.lastDrink.mult > 1 });
    if (d?.after) return d;
  }
  if (g.chaser && !pg.chaser) return { kind: 'multi', water: true, mult: 1 };
  const pr = g.pair;
  if (g.step === 'odai' && pr?.chosen && !(pg.step === 'odai' && pg.seq === g.seq)) {
    const d = babaDrink(pr.chosen, L.odaiOf(pr.chosen, g), { double: pr.double });
    return d && !d.after ? d : null;
  }
  // 負けた人の罰ゲームが「飲む」系に決まったとき
  if (g.step === 'over' && pg.step === 'penalty' && g.penalty && drinkKind(g.penalty)) return { kind: drinkKind(g.penalty), water: false, mult: 1 };
  return null;
}

let joinTimer = null;
function scheduleJoin() {
  if (joinTimer) return;
  joinTimer = setTimeout(() => {
    joinTimer = null;
    if (S()?.phase === 'lobby' && !inRoom()) commit((s) => L.addPlayer(s, me));
  }, 250 + Math.random() * 600);
}

function onLive(d) {
  if (d.k === 'hover' && d.from !== me.id) { ui.hover = d; render(); }
}
function onRaise(pid, d) {
  ui.raised[pid] = d?.card || null;
  render();
}

function makeRoom(code, broker) {
  return new Room({
    code, broker, me,
    onState: onRemoteState,
    onLive,
    onRaise,
    onStatus: (st) => {
      // つながり直したら、部屋の最新の状態（retained）が届くまで少しだけ操作を止める
      if (st === 'online' && ui.net !== 'online') ui.syncUntil = Date.now() + 2500;
      ui.net = st;
      render();
    },
  });
}

function enterRoom(room) {
  ui.room = room;
  ui.code = room.code;
  ui.broker = room.broker;
  ui.net = 'online';
  ui.syncUntil = 0; // 入った時点の状態は手元にある
  ui.screen = 'room';
  store.set('room', `${room.code}:${room.broker}`);
  if (me.name) store.set('name', me.name);
  history.replaceState(null, '', `?r=${room.code}&b=${room.broker}${BOT ? `&bot=1&name=${encodeURIComponent(me.name)}${BOT_START ? `&start=${BOT_START}` : ''}` : ''}`);
  render();
}

function needName() {
  me.name = (document.getElementById('in-name')?.value ?? me.name).trim().slice(0, 10);
  if (!me.name) { toast('名前を入れてね'); document.getElementById('in-name')?.focus(); return false; }
  store.set('name', me.name);
  return true;
}

async function createRoom(key) {
  if (!needName()) return;
  const meta = GAMES[key];
  ui.screen = 'connecting';
  ui.busy = '部屋を用意しています';
  render();
  for (let b = 0; b < BROKERS.length; b++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      const room = makeRoom(code, b);
      try { await room.connect(); } catch { break; }
      const existing = await waitForState(room, 1200);
      if (existing && Date.now() - (existing.ts || 0) < 24 * 3600 * 1000) { room.close(); continue; }
      const s = L.makeRoomState(code, me, Date.now(), meta.kind, { ...meta.settings, penalty: '一口飲む', hard: false });
      s.created = Date.now();
      ui.local = false;
      ui.state = s;
      room.publishState(s);
      ui.wantJoin = true;
      enterRoom(room);
      afterStateChange(null, s);
      return;
    }
  }
  ui.screen = 'setup';
  toast('通信サーバーにつながりませんでした。電波を確認してもう一度', 4000);
}

function createLocal(key) {
  if (!needName()) return;
  const meta = GAMES[key];
  const s = L.makeRoomState('1台', me, Date.now(), meta.kind, { ...meta.settings, penalty: '一口飲む', hard: false });
  s.created = Date.now();
  ui.local = true;
  ui.room = null;
  ui.code = '';
  ui.state = s;
  ui.screen = 'room';
  store.set('local', JSON.stringify(s));
  history.replaceState(null, '', '?local=1');
  // ババ酒は手札を隠す必要があるので、1台モードは「自分＋CPU」で遊ぶ
  if (meta.kind === 'baba') commit((x) => L.addCpu(L.addCpu(x)));
  else render();
}

async function joinRoom(code, broker = null, { silent = false } = {}) {
  if (!silent && !needName()) return;
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 4) { toast('部屋コードは4文字です'); return; }
  ui.screen = 'connecting';
  ui.busy = `部屋 ${code} を探しています`;
  render();
  const order = broker != null && BROKERS[broker] ? [broker, ...BROKERS.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...BROKERS.keys()];
  for (const b of order) {
    const room = makeRoom(code, b);
    try { await room.connect(); } catch { continue; }
    const st = await waitForState(room, 3000);
    if (!st) { room.close(); continue; }
    ui.local = false;
    ui.wantJoin = true;
    enterRoom(room);
    if (!st.players.some((p) => p.id === me.id)) {
      if (st.phase === 'lobby') scheduleJoin();
    } else if (st.players.find((p) => p.id === me.id).name !== me.name && st.phase === 'lobby') {
      commit((s) => L.addPlayer(s, me));
    }
    afterStateChange(null, S() || st);
    render();
    return;
  }
  ui.screen = ui.code ? 'join' : 'home';
  toast(`部屋 ${code} が見つかりませんでした`, 3500);
}

function leaveToHome() {
  if (!ui.local && S()?.phase === 'lobby' && inRoom()) commit((s) => L.removePlayer(s, me.id));
  ui.wantJoin = false;
  setTimeout(() => {
    ui.room?.close();
    ui.room = null;
    ui.state = null;
    ui.local = false;
    ui.screen = 'home';
    ui.sheet = null;
    ui.code = '';
    store.del('room');
    store.del('local');
    history.replaceState(null, '', location.pathname);
    keepAwake(false);
    render();
  }, ui.local ? 0 : 300);
}

// ---------- CPU（ホストの端末が動かす） ----------
let cpuTimer = null;
function scheduleCpu() {
  if (cpuTimer) return;
  const s = S();
  if (!s || s.phase !== 'play' || !isHost()) return;
  if (!ui.local && ui.net !== 'online') return;
  if (!isKioku(s)) maybeCpuRaise(s);
  const a = actorOf(s);
  if (!a || !isCpu(a) || humanStepForCpu()) return;
  cpuTimer = setTimeout(cpuAct, 900 + Math.random() * 700);
}

function maybeCpuRaise(s) {
  const g = s.game;
  if (g.step !== 'draw') return;
  const t = L.drawTarget(s);
  if (!t || !isCpu(t) || ui.cpuRaisedSeq === `${s.round}:${g.seq}`) return;
  ui.cpuRaisedSeq = `${s.round}:${g.seq}`;
  const card = L.cpuRaise(g.hands[t]);
  ui.raised[t] = card;
  ui.room?.publishRaise(card, t);
}

function cpuAct() {
  cpuTimer = null;
  const s = S();
  if (!s || s.phase !== 'play' || !isHost()) return;
  const a = actorOf(s);
  if (!a || !isCpu(a) || humanStepForCpu()) return;
  const g = s.game;
  if (!isKioku(s) && g.step === 'draw') {
    // 迷うそぶりを見せてから引く
    const from = L.drawTarget(s);
    const n = g.hands[from].length;
    const key = `${s.round}:${g.seq}`;
    if (!ui.cpuHover || ui.cpuHover.key !== key) ui.cpuHover = { key, moves: 0 };
    if (ui.cpuHover.moves < 2 && n > 1) {
      ui.cpuHover.moves++;
      const idx = Math.floor(Math.random() * n);
      ui.hover = { k: 'hover', seq: g.seq, idx };
      ui.room?.publishLive({ k: 'hover', seq: g.seq, idx });
      render();
      cpuTimer = setTimeout(cpuAct, 650 + Math.random() * 500);
      return;
    }
    const idx = ui.hover && ui.hover.seq === g.seq ? ui.hover.idx : 0;
    commit((x) => L.draw(x, a, idx));
    return;
  }
  const act = isKioku(s) ? K.autoAction(s) : L.autoAction(s);
  if (!act) return;
  if (act.type === 'commit' && act.input?.text) act.input.text = ['語尾に「ピヨ」', '乾杯は英語で', 'あだ名で呼び合う'][Math.floor(Math.random() * 3)];
  if (act.type === 'penalty') act.text = PENALTY_PRESETS[Math.floor(Math.random() * PENALTY_PRESETS.length)];
  commit((x) => (isKioku(x) ? K.applyAction(x, act) : L.applyAction(x, act)));
}

// ---------- 自動操作（テスト用 ?bot=1） ----------
let botTimer = null;
function scheduleBot() {
  if (botTimer) return;
  botTimer = setTimeout(() => {
    botTimer = null;
    const s = S();
    if (!s) return;
    if (s.phase === 'lobby' && isHost() && BOT_START && s.players.length >= BOT_START) { commit((x) => (isKioku(x) ? K.startGame(x) : L.startGame(x))); return; }
    if (s.phase !== 'play' || actorOf(s) !== me.id) return;
    const a = isKioku(s) ? K.autoAction(s) : L.autoAction(s);
    if (a) commit((x) => (isKioku(x) ? K.applyAction(x, a) : L.applyAction(x, a)));
  }, 350 + Math.random() * 400);
}

// ---------- 画面：ホーム（ゲームを選ぶ） ----------
function tile(key) {
  const m = GAMES[key];
  return `<li><button class="tile tone-${m.tone}" data-act="pick-game" data-g="${key}">
    <span class="tile-body">
      <span class="tile-name">${m.titleHtml}</span>
      ${m.badge ? `<span class="tile-badge">${m.badge}</span>` : ''}
      <span class="tile-desc">${esc(m.desc)}</span>
      <span class="tile-tags"><span class="tile-meta">${ICON.people}${m.meta}</span>${(m.tags || []).map((t) => `<span class="tile-meta tag">${t}</span>`).join('')}</span>
    </span>
    <span class="tile-art"><img src="img/${m.img}.webp" alt=""></span>
    <span class="tile-go">${ICON.arrow}</span>
  </button></li>`;
}

function viewHome() {
  return `<main class="hub">
    <header class="brand-row"><span class="brand">NOMIKAI<br>CARDS</span><span class="brand-sub">飲み会カードゲーム集<br>（非公式ファンメイド）</span></header>
    <h1 class="hub-title"><span>今夜なに</span><span>遊ぶ？</span></h1>
    <section class="join-box top">
      <h2>部屋コードをもらった？</h2>
      <div class="join-row">
        <input id="in-code" data-model="code" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="コード4文字" value="${esc(ui.code)}" aria-label="部屋コード">
        <button class="btn" data-act="join-code">参加</button>
      </div>
    </section>
    <ul class="tiles">${tile('ng')}${tile('talk')}${tile('baba')}${tile('kioku1')}${tile('kioku2')}</ul>
    <section class="modes">
      <div class="mode-card"><img src="img/mode-duo.webp" alt=""><p><b>2人でもOK</b>2人だけになると、お題が2人用に切り替わる</p></div>
      <div class="mode-card"><img src="img/mode-hard.webp" alt=""><p><b>ゴリゴリ泥酔モード</b>ロビーでON。進むほど画面も酔っていく</p></div>
    </section>
    ${isStandalone() ? '' : `<p class="a2hs">${ICON.share}ホーム画面に追加すると、アプリのように全画面で遊べます<small>${/iPhone|iPad|iPod/.test(navigator.userAgent) ? 'Safari の共有ボタン →「ホーム画面に追加」' : 'ブラウザのメニュー →「ホーム画面に追加」／「アプリをインストール」'}</small></p>`}
    <footer class="fine">市販のカードゲームをもとにした非公式のファンメイドです。お題はすべてオリジナル。<br>お酒は20歳になってから。一気飲みはしない。苦手な人はソフトドリンクで。</footer>
  </main>`;
}

function viewSetup() {
  const key = ui.pick;
  const m = GAMES[key];
  return `<main class="setup">
    <button class="btn link back" data-act="home">${ICON.back}もどる</button>
    <figure class="setup-art tone-${m.tone}"><img src="img/${m.img}.webp" alt=""></figure>
    <h1 class="setup-title">${m.titleHtml}${m.badge ? ` <span class="tile-badge">${m.badge}</span>` : ''}</h1>
    <p class="setup-desc">${esc(m.desc)}</p>
    <ol class="mini-steps">${m.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
    <label class="field"><span>あなたの名前</span>
      <input id="in-name" data-model="name" maxlength="10" autocomplete="nickname" placeholder="例：はるのり" value="${esc(me.name)}"></label>
    <button class="btn primary big" data-act="create">部屋を作る<small>みんな自分のスマホで参加</small></button>
    ${m.localLabel ? `<button class="btn" data-act="local">${esc(m.localLabel)}</button>` : '<p class="hint">自分のワードが見えないのが肝なので、1台モードはありません。みんな自分のスマホで。</p>'}
    <button class="btn link" data-act="rules">くわしい遊び方</button>
  </main>`;
}

function viewJoin() {
  return `<main class="setup join">
    <button class="btn link back" data-act="forget-code">${ICON.back}ホームへ</button>
    <figure class="setup-art tone-paper"><img src="img/lobby.webp" alt=""></figure>
    <h1 class="setup-title">部屋 <span class="code-inline">${esc(ui.code)}</span> に参加</h1>
    <label class="field"><span>あなたの名前</span>
      <input id="in-name" data-model="name" maxlength="10" autocomplete="nickname" placeholder="例：はるのり" value="${esc(me.name)}"></label>
    <button class="btn primary big" data-act="join">参加する</button>
  </main>`;
}

function viewConnecting() {
  return `<main class="connecting"><div class="spinner" aria-hidden="true">${cardBack({ size: 'l' })}</div><p>${esc(ui.busy || 'つないでいます')}</p></main>`;
}

// ---------- 画面：ロビー ----------
function viewLobby() {
  const s = S();
  const host = isHost();
  const n = s.players.length;
  const m = gameMeta(s);
  let qr = '';
  if (!ui.local) {
    try {
      const q = qrcode(0, 'M');
      q.addData(roomUrl());
      q.make();
      qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: '参加用QRコード' });
    } catch { /* noop */ }
  }
  const rows = s.players.map((p, i) => `
    <li class="seat">
      <span class="seat-no">${i + 1}</span>${avatar(p)}
      <span class="seat-name">${esc(p.name)}${p.id === me.id && !ui.local ? '<em>あなた</em>' : ''}${p.id === s.hostId && !ui.local ? '<em class="host">ホスト</em>' : ''}${p.cpu ? '<em class="cpu">CPU</em>' : ''}</span>
      ${host ? `<span class="seat-ctl">
        <button class="icon" data-act="move" data-pid="${p.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="${esc(p.name)}を上へ">${ICON.up}</button>
        <button class="icon" data-act="move" data-pid="${p.id}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="${esc(p.name)}を下へ">${ICON.down}</button>
        ${p.id !== me.id ? `<button class="icon" data-act="kick" data-pid="${p.id}" aria-label="${esc(p.name)}を外す">${ICON.x}</button>` : ''}
      </span>` : ''}
    </li>`).join('');
  const st = s.settings || {};
  const pens = st.hard ? PENALTY_CHOICES_HARD : PENALTY_CHOICES;
  const custom = st.custom || [];
  const customRow = isKioku(s) ? `<div class="set-row"><span class="set-label">マイお題 <small>${custom.length}/${K.CUSTOM_MAX}枚・山札に混ざる</small></span>
        ${host ? `<div class="custom-add"><input id="in-custom" data-model="customText" maxlength="50" placeholder="例：今日ハイボールを頼んだ人" value="${esc(ui.customText || '')}"><button class="btn small" data-act="custom-add">${ICON.plus}追加</button></div>` : ''}
        ${host ? '<p class="hint">「〜な人」で終わると、当てはまった人がペナルティのカードになります（だれもいなければ貯金）。それ以外はそのまま実行するお題に。</p>' : ''}
        ${custom.length ? `<ul class="custom-list">${custom.map((c) => `<li><span>${esc(c.t)}</span>${host ? `<button class="icon" data-act="custom-del" data-id="${c.id}" aria-label="消す">${ICON.x}</button>` : ''}</li>`).join('')}</ul>` : (host ? '' : '<p class="hint">まだありません</p>')}
      </div>` : '';
  const talkRow = isChat(s) ? `<div class="set-row"><span class="set-label">制限時間</span>
        <div class="seg four">${[0, 3, 5, 10].map((mm) => `<button class="seg-btn ${Number(st.minutes || 0) === mm ? 'on' : ''}" ${host ? `data-act="set-min" data-m="${mm}"` : 'disabled'}>${mm ? `${mm}分` : 'なし'}</button>`).join('')}</div></div>
        <p class="hint">${isNg(s) ? `NGワードを言ったら${talkPen(s)}＆新しいワード。時間になったら、いちばん言った人がもう${talkPen(s)}。` : `バレたら${talkPen(s)}＆脱落、見破りハズレも${talkPen(s)}。だれかが達成したら、ほかの全員で${talkPen(s)}。`}</p>` : '';
  const settings = `
    <section class="settings">
      ${talkRow}
      ${isKioku(s) ? `<div class="set-row"><span class="set-label">山札</span>
        <div class="seg">${['k1', 'k2', 'mix'].map((d) => `<button class="seg-btn ${st.deck === d ? 'on' : ''}" ${host ? `data-act="set-deck" data-d="${d}"` : 'disabled'}>${DECK_LABEL[d]}</button>`).join('')}</div></div>
        <div class="set-row"><span class="set-label">ペナルティ</span>
        <div class="chips-wrap">${pens.map((p) => `<button class="pick sm ${st.penalty === p ? 'on' : ''}" ${host ? `data-act="set-pen" data-t="${esc(p)}"` : 'disabled'}>${esc(p)}</button>`).join('')}</div></div>` : ''}
      <button class="hard-toggle ${st.hard ? 'on' : ''}" ${host ? 'data-act="toggle-hard"' : 'disabled'} aria-pressed="${!!st.hard}">
        <img src="img/mode-hard.webp" alt="">
        <span><b>ゴリゴリ泥酔モード</b><small>${!st.hard ? 'OFF' : isChat(s) ? 'ON：ペナルティが全部二口' : 'ON：ペナルティ二口・縛りが重なる・画面も酔う。チェイサーは強制'}</small></span>
        <span class="switch" aria-hidden="true"></span>
      </button>
      ${customRow}
      ${n === 2 && !isChat(s) ? '<div class="duo-note"><img src="img/mode-duo.webp" alt=""><p><b>2人モード</b>2人用のお題に切り替わります</p></div>' : ''}
    </section>`;
  const canStart = n >= minPlayers(s);
  return `<main class="lobby">
    ${topBar()}
    <section class="lobby-title"><span class="game-name">${esc(m.title)}</span>${gameBadge(s) ? `<span class="tile-badge">${gameBadge(s)}</span>` : ''}</section>
    ${ui.local ? '' : `<section class="invite">
      <div class="code-block"><span class="code-label">部屋コード</span><span class="code">${esc(ui.code)}</span>
        <button class="btn small" data-act="share">${ICON.share}招待リンクを送る</button></div>
      <div class="qr">${qr}</div>
    </section>`}
    <section class="seats">
      <h2>席順 <small>${n}人</small></h2>
      <p class="hint">${isChat(s) ? `${isNg(s) ? 'NGワードゲーム' : 'トークトライアル'}は順番なし。CPUは会話できないので呼べません。` : isKioku(s) ? '座っている順（時計回り）に並べると、引く順番がそのまま回ります。' : '座っている順（時計回り）に並べてね。となりの人から引くので大事です。'}</p>
      <ol>${rows}</ol>
      ${host ? `<div class="add-row">
        ${ui.local && (isKioku(s) || isTalk(s)) ? `<input id="in-add" data-model="addName" maxlength="10" placeholder="参加する人の名前" value="${esc(ui.addName)}"><button class="btn small" data-act="add-local">${ICON.plus}追加</button>` : ''}
        ${isChat(s) ? '' : `<button class="btn small cpu-btn" data-act="add-cpu">${ICON.bot}CPUを呼ぶ</button>`}
      </div>` : ''}
    </section>
    ${settings}
    <section class="lobby-actions">
      ${!inRoom() ? '<p class="hint">参加中…</p>' : host
        ? `<button class="btn primary big" data-act="start" ${canStart ? '' : 'disabled'}>${canStart ? 'ゲームを始める' : `あと${minPlayers(s) - n}人${isChat(s) ? '' : '（CPUでもOK）'}`}</button>`
        : '<p class="waiting">ホストが始めるのを待っています</p>'}
      <button class="btn link" data-act="leave">${ui.local ? 'ホームに戻る' : '部屋を出る'}</button>
    </section>
  </main>`;
}

// ---------- 共通：上のバーと席 ----------
function drunkLevel(s) {
  const g = s?.game;
  if (!g?.hard || s.phase !== 'play' || isChat(s)) return 0;
  const steps = isKioku(s) ? g.n : g.seq;
  return Math.min(1, steps / 36);
}

function topBar() {
  const s = S();
  const g = s?.game;
  const netLabel = ui.local || ui.net === 'online' ? '' : '<span class="net bad">再接続中…</span>';
  const chips = [];
  if (g && s.phase === 'play') {
    // 貯金は上限なしで増えるので、ルールの長いチップに押し出されないよう先頭に出す
    if (isKioku(s) && g.pot) chips.push(`<span class="chip pot">貯金 ${potDots(g.pot)}</span>`);
    if (!isKioku(s) && !isChat(s)) chips.push(`<span class="chip">${ICON.dir}${g.dir === 1 ? '時計回り' : '反時計回り'}</span>`);
    if (isTalk(s)) chips.push(`<span class="chip">残り ${T.alive(s).length}人</span>`);
    const rules = isKioku(s) ? g.rules || [] : (g.hard ? g.rules || [] : (g.rule ? [g.rule] : []));
    for (const r of rules) chips.push(`<span class="chip rule">${isKioku(s) ? 'ルール' : '縛り'}：${esc(r.text)}</span>`);
    if (g.double) chips.push('<span class="chip x2c">次のお題 2倍</span>');
    if (g.skip) chips.push(`<span class="chip">スキップ待ち ${g.skip}</span>`);
    if (g.duo) chips.push('<span class="chip">2人モード</span>');
    if (g.hard && isChat(s)) chips.push('<span class="chip hard">泥酔：ペナルティ二口</span>');
    else if (g.hard) {
      const lv = Math.round(drunkLevel(s) * 5);
      chips.push(`<span class="chip hard">泥酔 ${'●'.repeat(lv)}${'○'.repeat(5 - lv)}</span>`);
    }
  }
  return `<header class="topbar">
    <span class="room-code" aria-label="部屋コード">${ui.local ? '1台' : esc(ui.code)}</span>
    ${netLabel}
    <div class="chips">${chips.join('')}</div>
    <button class="icon" data-act="menu" aria-label="メニュー">${ICON.menu}</button>
  </header>`;
}

function seatStrip() {
  const s = S();
  const g = s.game;
  if (isNg(s)) {
    const items = s.players.map((p) => `<li class="pl ${p.id === me.id ? 'me' : ''}">${avatar(p, 's')}<span class="pl-name">${esc(p.name)}</span><span class="pl-count">${N.outsOf(g, p.id)}回</span></li>`);
    return `<ul class="strip" data-scroll="strip">${items.join('')}</ul>`;
  }
  if (isTalk(s)) {
    const items = s.players.map((p) => {
      const stt = g.status[p.id];
      const badge = stt === 'out' ? '<span class="pl-badge">バレた</span>' : stt === 'won' ? '<span class="pl-badge">勝ち</span>' : g.used[p.id] ? '<span class="pl-badge">見破り済</span>' : '';
      const w = T.winsOf(s, p.id);
      const wins = w ? `<span class="pl-count">${w}勝</span>` : '';
      return `<li class="pl ${stt === 'out' ? 'done' : ''} ${stt === 'won' ? 'turn' : ''} ${p.id === me.id && !ui.local ? 'me' : ''}">${avatar(p, 's')}<span class="pl-name">${esc(p.name)}</span>${badge || wins}</li>`;
    });
    return `<ul class="strip" data-scroll="strip">${items.join('')}</ul>`;
  }
  const kioku = isKioku(s);
  const target = kioku ? null : L.drawTarget(s);
  const items = s.players.map((p) => {
    const rank = kioku ? -1 : g.finished.indexOf(p.id);
    const cls = [
      p.id === g.turn ? 'turn' : '',
      p.id === target ? 'target' : '',
      rank >= 0 ? 'done' : '',
      !kioku && p.id === g.loser ? 'loser' : '',
      p.id === me.id && !ui.local ? 'me' : '',
    ].join(' ');
    let badge = '';
    if (!kioku) {
      const cnt = g.hands[p.id]?.length ?? 0;
      badge = rank >= 0 ? `<span class="pl-badge">${rank + 1}抜け</span>` : p.id === g.loser ? '<span class="pl-badge">負け</span>' : `<span class="pl-count">${ICON.cards}${cnt}</span>`;
    }
    return `<li class="pl ${cls}">${avatar(p, 's')}<span class="pl-name">${esc(p.name)}</span>${badge}</li>`;
  });
  const arrow = kioku ? '' : `<li class="pl-arrow" aria-hidden="true">${g.dir === 1 ? '›' : '‹'}</li>`;
  return `<ul class="strip" data-scroll="strip">${items.join(arrow)}</ul>`;
}

// CPUが対象になったときのひとこと
function cpuQuotes(pids, n) {
  const qs = (pids || []).filter((pid) => isCpu(pid)).map((pid) => `<p class="cpu-say">${avatar(S().players.find((p) => p.id === pid), 's')}<span><b>${nm(pid)}</b>「${esc(cpuLine(cpuOf(pid), n))}」</span></p>`);
  return qs.join('');
}

// ---------- 画面：ババ酒 ----------
function drawZone() {
  const s = S();
  const g = s.game;
  if (g.step !== 'draw') return '<section class="zone"></section>';
  const drawer = g.turn;
  const target = L.drawTarget(s);
  const hand = g.hands[target] || [];
  const iDraw = drawer === me.id || (ui.proxy && isHost());
  const iTarget = target === me.id;
  const selIdx = iDraw ? ui.sel : (ui.hover && ui.hover.seq === g.seq ? ui.hover.idx : null);
  const raisedCard = ui.raised[target];
  const n = hand.length;
  const size = n > 7 ? 's' : 'm';
  const cw = size === 's' ? 52 : 72;
  const avail = Math.min(window.innerWidth - 40, 480);
  const ov = n > 1 ? Math.max(0, (n * cw - avail) / (n - 1)) : 0;
  const cards = hand.map((c, i) => {
    const mid = (n - 1) / 2;
    const rot = (i - mid) * Math.min(4, 26 / Math.max(n, 1));
    const lift = Math.abs(i - mid) * Math.min(3, 18 / Math.max(n, 1));
    const cls = [i === selIdx ? 'sel' : '', c === raisedCard ? 'raised' : ''].join(' ');
    const style = `style="--rot:${rot}deg;--dy:${lift}px;margin-left:${i ? -ov : 0}px"`;
    const attrs = `${style} ${iDraw ? `data-act="pick-draw" data-i="${i}" role="button" tabindex="0" aria-label="${i + 1}枚目"` : ''}`;
    return iTarget ? cardFace(c, { size, extra: `fan ${cls}`, attrs }) : cardBack({ size, extra: `fan ${cls}`, attrs });
  }).join('');
  let head;
  if (iDraw && drawer === me.id) head = `<b>あなたの番</b>${nm(target)}から1枚引いて`;
  else if (iDraw) head = `<b>${nm(drawer)}の代わりに</b>${nm(target)}から引く`;
  else if (iTarget) head = `<b>${nm(drawer)}</b>があなたのカードを狙っています`;
  else if (isCpu(drawer)) head = `<b>${nm(drawer)}</b>が${nm(target)}のカードを選んでいます…`;
  else head = `<b>${nm(drawer)}</b>が${nm(target)}から引いています`;
  const sub = iTarget ? '<p class="zone-sub">手札をタップすると、1枚だけ浮かせてゆさぶれます</p>'
    : iDraw ? `<p class="zone-sub">${selIdx == null ? 'カードをタップして選ぶ（選んだカードは相手にも見えます）' : '相手の顔をよく見て…'}</p>` : '';
  return `<section class="zone">
    ${g.chaser ? '<div class="chaser"><img src="img/g-water.webp" alt=""><p><b>チェイサータイム</b>全員お水を一口</p></div>' : ''}
    <p class="zone-head">${head}</p>${sub}
    <div class="fan-wrap"><div class="fan">${cards}</div></div>
    ${iDraw ? `<button class="btn primary draw-btn" data-act="draw" ${selIdx == null ? 'disabled' : ''}>このカードを引く</button>` : ''}
    ${!iDraw && isHost() && drawer !== me.id && !isCpu(drawer) ? `<button class="btn link proxy" data-act="proxy">${nm(drawer)}の代わりに進める</button>` : ''}
  </section>`;
}

function myHand() {
  const s = S();
  const g = s.game;
  if (!inRoom()) return '<section class="hand"><p class="hint">観戦中です。次のゲームから参加できます。</p></section>';
  const hand = g.hands[me.id] || [];
  const rank = g.finished.indexOf(me.id);
  if (!hand.length) return `<section class="hand"><p class="hand-done">${rank >= 0 ? `${rank + 1}番に上がり！ お題には引き続き参加してね` : ''}</p></section>`;
  const cards = hand.map((c) => cardFace(c, {
    size: 's',
    extra: `${c === ui.newCard ? 'new' : ''} ${c === ui.raised[me.id] ? 'raised' : ''}`,
    attrs: `data-act="card" data-card="${c}" role="button" tabindex="0" aria-label="${L.cardLabel(c)}"`,
  })).join('');
  return `<section class="hand"><div class="hand-head"><span>あなたの手札</span><span class="hand-n">${hand.length}枚</span></div>
    <div class="hand-row" data-scroll="hand">${cards}</div></section>`;
}

function odaiOverlay() {
  const s = S();
  const g = s.game;
  const pr = g.pair;
  if (!pr || (g.step !== 'choose' && g.step !== 'odai')) return '';
  const by = pr.by;
  const mine = iAct();
  const flip = anim(`${s.created}:${s.round}:${g.seq}:${g.step}`);
  const head = `<div class="ov-head">${avatar(S().players.find((p) => p.id === by), 'm')}<span class="ov-who">${nm(by)}、ペア成立！</span><span class="ov-sub">${L.RANK_LABEL[L.rankOf(pr.cards[0])]}がそろった</span></div>`;
  if (g.step === 'choose') {
    const caps = [`${nm(pr.from)}から引いた`, '手札にあった'];
    const cards = pr.cards.map((c, i) => `<div class="choice"><span class="choice-cap">${caps[i]}</span>${bigCard(c, g, { flip, attrs: mine ? `data-act="choose" data-card="${c}" role="button" tabindex="0"` : '', extra: mine ? 'tappable' : '' })}</div>`).join('');
    return `<div class="overlay" role="dialog" aria-label="お題を選ぶ">${head}
      <p class="ov-ask">${mine ? 'やるお題を1つタップ' : `${nm(by)}がお題を選んでいます`}${g.double ? '<span class="x2-inline">次のお題は2倍</span>' : ''}</p>
      <div class="pair-row">${cards}</div>
      ${!mine && isHost() && !isCpu(by) ? `<button class="btn link proxy" data-act="proxy">${nm(by)}の代わりに進める</button>` : ''}
    </div>`;
  }
  const id = pr.chosen;
  const def = L.odaiOf(id, g);
  const need = def.need;
  const cands = L.pickCandidates(s, by);
  let controls = '';
  if (mine) {
    if (!pr.committed && typeof need === 'number' && need > 0 && cands.length > need) {
      const required = Math.min(need, cands.length);
      controls = `<p class="ov-ask">${required}人を指名</p>
        <div class="pick-row">${cands.map((pid) => `<button class="pick ${ui.picks.includes(pid) ? 'on' : ''}" data-act="pick" data-pid="${pid}" aria-pressed="${ui.picks.includes(pid)}">${nm(pid)}</button>`).join('')}</div>
        <button class="btn primary" data-act="commit" ${ui.picks.length !== required ? 'disabled' : ''}>決定</button>`;
    } else if (!pr.committed && typeof need === 'number' && need > 0 && !cands.length) {
      controls = '<p class="ov-ask">対象になる人がいないので不発</p><button class="btn primary" data-act="commit">次へ</button>';
    } else if (!pr.committed && need === 'text') {
      controls = `<label class="field"><span>みんなに守らせる縛り（40字まで）</span><input id="in-rule" data-model="text" maxlength="40" placeholder="例：敬語禁止" value="${esc(ui.text)}"></label>
        <button class="btn primary" data-act="commit">この縛りにする</button>`;
    } else {
      controls = babaDrink(id, def, { double: pr.double })?.after
        // 勝負・条件つき：結果が出てから「飲んだ！」で演出
        ? '<button class="btn primary big" data-act="finish-drank">飲んだ！ 次へ</button><button class="btn stack" data-act="finish">セーフ<small>だれも飲まずに次へ</small></button>'
        : '<button class="btn primary big" data-act="finish">やった！ 次へ</button>';
    }
  } else {
    controls = `<p class="waiting">${nm(by)}が進めるのを待っています</p>${isHost() && !isCpu(by) ? `<button class="btn link proxy" data-act="proxy">${nm(by)}の代わりに進める</button>` : ''}`;
  }
  const autoPicks = !pr.committed && typeof need === 'number' && need > 0 && cands.length && cands.length <= need ? cands : null;
  const shown = pr.picks?.length ? pr.picks : autoPicks;
  const targets = shown?.length ? `<p class="ov-target">対象：${shown.map((p) => `<b>${nm(p)}</b>`).join('、')}</p>` : '';
  const result = pr.result ? `<p class="ov-result">${esc(pr.result)}</p>` : '';
  const peek = pr.peek && (by === me.id) ? `<div class="peek"><span>こっそり見たカード</span>${pr.peek.map((c) => cardFace(c, { size: 's' })).join('')}</div>` : '';
  return `<div class="overlay" role="dialog" aria-label="お題">${head}
    <div class="one">${bigCard(id, g, { flip, double: pr.double })}</div>
    ${targets}${cpuQuotes(shown, g.seq)}${result}${peek}
    <div class="ov-ctl">${controls}</div>
  </div>`;
}

function endOverlay() {
  const s = S();
  const g = s.game;
  if (g.step !== 'penalty' && g.step !== 'over') return '';
  const loser = g.loser;
  const first = g.finished[0];
  const ranking = g.finished.map((pid, i) => `<li><span>${i + 1}</span>${nm(pid)}</li>`).join('') + (loser ? `<li class="lose"><span>負け</span>${nm(loser)}</li>` : '');
  let body;
  if (g.step === 'penalty') {
    if (iAct()) {
      body = `<p class="ov-ask">1番に上がったあなたが、${nm(loser)}の罰ゲームを決める</p>
        <div class="preset">${PENALTY_PRESETS.map((t) => `<button class="pick sm ${ui.penaltyText === t ? 'on' : ''}" data-act="preset" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <label class="field"><span>自分で書く</span><input id="in-pen" data-model="penaltyText" maxlength="60" value="${esc(ui.penaltyText)}" placeholder="罰ゲームを入力"></label>
        <button class="btn primary" data-act="penalty" ${ui.penaltyText.trim() ? '' : 'disabled'}>これに決定</button>`;
    } else {
      body = `<p class="waiting">1番に上がった${nm(first)}が罰ゲームを考えています</p>${isHost() && !isCpu(first) ? `<button class="btn link proxy" data-act="proxy">${nm(first)}の代わりに決める</button>` : ''}`;
    }
  } else {
    body = `<div class="penalty"><span>罰ゲーム</span><p>${esc(g.penalty)}</p></div>
      ${loser && isCpu(loser) ? cpuQuotes([loser], g.seq + 1) : ''}
      ${isHost() ? '<div class="end-actions"><button class="btn primary big" data-act="again">同じメンバーでもう一回</button><button class="btn" data-act="lobby">メンバーを変える</button></div>' : '<p class="waiting">ホストが次のゲームを始めるのを待っています</p>'}`;
  }
  const fl = anim(`${s.created}:${s.round}:end`, 900);
  return `<div class="overlay end ${g.step === 'penalty' ? 'deciding' : ''}" role="dialog" aria-label="結果">
    <figure class="result-art ${fl.cls}" style="${fl.style}"><img src="img/result.webp" alt=""></figure>
    <h2 class="loser-name">${loser ? `${nm(loser)}の負け！` : '終了'}</h2>
    ${lossTally(s)}
    <ol class="ranking">${ranking}</ol>
    ${body}
  </div>`;
}

// 通算の負け数（2回目のゲームから出す）
function lossTally(s) {
  const rows = s.players.map((p) => [p, L.lossesOf(s, p.id)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length || (s.round || 1) < 2) return '';
  const top = rows[0][1];
  return `<p class="loss-tally"><span>通算</span>${rows.map(([p, n]) => `<b class="${n === top && n > 1 ? 'worst' : ''}">${esc(p.name)} ${n}敗</b>`).join('')}</p>`;
}

function viewBaba() {
  return `${seatStrip()}${drawZone()}${myHand()}${odaiOverlay()}${endOverlay()}`;
}

// ---------- 画面：記憶無くしちゃダメですか ----------
function kCard(s) {
  const g = s.game;
  const c = K.currentCard(s);
  const genre = GENRES[c.g];
  const pen = s.settings?.penalty || (g.hard ? '二口飲む' : '一口飲む');
  const text = markTopic(esc(c.t).replace(/私/g, '<span class="me-word">私</span>'), c.topic);
  let foot = '';
  if (K.isToastCard(c) && g.pot) foot = `乾杯して${everyone(g)} → ${esc(K.penaltyText(pen, g.pot + 1))}<span class="pot-note">貯金${g.pot}つぶん込み</span>`;
  else if (genre.foot === 'hit') foot = `当てはまった人 → ${esc(K.penaltyText(pen, (g.pot || 0) + 1))}${g.pot ? `<span class="pot-note">貯金${g.pot}つぶん込み</span>` : ''}`;
  else if (genre.foot === 'pass') foot = `言えなければ → ${esc(pen)}`;
  else if (c.t.includes('ペナルティ')) foot = `ペナルティ ＝ ${esc(pen)}`;
  const fl = anim(`${s.created}:${s.round}:${g.n}`, 650);
  return `<article class="k-card g-${c.g} ${fl.cls}" style="${fl.style}">
    <div class="k-art"><img src="img/${genre.img}.webp" alt=""></div>
    <div class="k-body">
      <span class="k-genre">${genre.label}</span>
      <p class="k-text">${text}</p>
      <p class="k-me">私 ＝ ${nm(g.turn)}</p>
      ${foot ? `<p class="k-foot">${foot}</p>` : ''}
    </div>
  </article>`;
}

function kControls(s) {
  const g = s.game;
  const c = K.currentCard(s);
  const mine = iAct();
  let out = '';
  const cands = K.candidates(s, g.turn);
  if (!g.committed && typeof c.need === 'number' && cands.length > c.need) {
    if (mine) {
      const required = Math.min(c.need, cands.length);
      out += `<div class="k-pick"><p class="ov-ask">${required}人を指名</p>
        <div class="pick-row">${cands.map((pid) => `<button class="pick ${ui.picks.includes(pid) ? 'on' : ''}" data-act="kpick" data-pid="${pid}" aria-pressed="${ui.picks.includes(pid)}">${nm(pid)}</button>`).join('')}</div>
        <button class="btn" data-act="kcommit" ${ui.picks.length !== required ? 'disabled' : ''}>決定</button></div>`;
    } else out += `<p class="waiting">${nm(g.turn)}が指名しています</p>`;
  } else if (!g.committed && c.need === 'text') {
    if (mine) {
      out += `<div class="k-pick"><label class="field"><span>追加するルール（40字まで）</span><input id="in-rule" data-model="text" maxlength="40" placeholder="例：左手で飲む" value="${esc(ui.text)}"></label>
        <button class="btn" data-act="kcommit">このルールにする</button></div>`;
    } else out += `<p class="waiting">${nm(g.turn)}がルールを考えています</p>`;
  }
  const shown = g.picks?.length ? g.picks : (typeof c.need === 'number' && cands.length <= c.need ? cands : []);
  if (shown.length) out += `<p class="ov-target">指名：${shown.map((p) => `<b>${nm(p)}</b>`).join('、')}</p>${cpuQuotes(shown, g.n)}`;
  if (g.text) out += `<p class="ov-target">ルール：<b>${esc(g.text)}</b></p>`;
  if (c.timer) {
    out += g.timer
      ? `<p class="k-timer">${ICON.timer}<span class="timer-num" data-end="${g.timer.end}">${Math.max(0, Math.ceil((g.timer.end - Date.now()) / 1000))}</span>秒</p>`
      : (mine || isHost() ? `<button class="btn small timer-btn" data-act="ktimer">${ICON.timer}${c.timer}秒タイマー</button>` : '');
  }
  return out;
}

function kPen(s) {
  return s.settings?.penalty || (s.game.hard ? '二口飲む' : '一口飲む');
}
// 乾杯で貯金を受けるのは全員（分け合わず、ひとりずつ同じ量）
const everyone = (g) => (g?.duo ? '2人それぞれ' : '全員ひとりずつ');
// 貯金は上限なし：5つまでは●で並べ、それ以上は「●×12」
const potDots = (n) => (n <= 5 ? '●'.repeat(n) : `●×${n}`);

// だれも当てはまらなかった／貯金を精算したときのお知らせ
function noticeText(s, nt, html = true) {
  const pen = kPen(s);
  const b = (t) => (html ? `<b>${t}</b>` : `${t}：`);
  if (nt.kind === 'stock') return `${b('だれも当てはまらず')}ペナルティを貯金（${potDots(nt.pot)}）。次に当てはまった人は${K.penaltyText(pen, nt.pot + 1)}`;
  if (nt.kind === 'paid') return `${b('貯金ぶんまとめて')}当てはまった人が${K.penaltyText(pen, nt.mult)}`;
  if (nt.kind === 'kanpai') return `${b('貯金で乾杯')}${everyone(s.game)}${K.penaltyText(pen, nt.mult)}`;
  return '';
}
function kNotice(s) {
  const nt = s.game.notice;
  return nt ? `<div class="k-notice ${nt.kind}" role="status">${esc(noticeText(s, nt, false)).replace(/^(.+?)：/, '<b>$1</b>')}</div>` : '';
}

function viewKioku() {
  const s = S();
  const g = s.game;
  const mine = iAct();
  const turnP = s.players.find((p) => p.id === g.turn);
  const who = ui.local ? `${nm(g.turn)}の番` : g.turn === me.id ? 'あなたの番' : `${nm(g.turn)}の番`;
  let stage;
  let action;
  if (g.step === 'end') {
    stage = `${kNotice(s)}<div class="k-end"><img src="img/result.webp" alt=""><h2>山札がなくなった！</h2><p class="hint">${g.n}枚ぶん遊びました</p></div>`;
    action = isHost() ? '<button class="btn primary big" data-act="kreshuffle">シャッフルしてもう一周</button><button class="btn" data-act="lobby">設定を変える（ロビーへ）</button>' : '<p class="waiting">ホストの操作を待っています</p>';
  } else if (g.step === 'draw') {
    stage = `${kNotice(s)}<div class="k-deck" aria-label="山札">${cardBack({ size: 'l', extra: 'd3' })}${cardBack({ size: 'l', extra: 'd2' })}${cardBack({ size: 'l', extra: 'd1' })}</div>
      ${g.hard && g.n > 0 && g.n % 12 === 0 && g.lastWater !== g.n ? '<p class="k-next-water">次はチェイサータイム</p>' : ''}`;
    action = mine ? '<button class="btn primary big" data-act="kdraw">カードを引く</button>'
      : `<p class="waiting">${isCpu(g.turn) ? `${nm(g.turn)}が引いています…` : `${nm(g.turn)}が引きます`}</p>`;
  } else {
    stage = `${kCard(s)}<div class="k-ctl">${kControls(s)}</div>`;
    const c = K.currentCard(s);
    const need = !g.committed && (c.need === 'text' || (typeof c.need === 'number' && K.candidates(s, g.turn).length > c.need));
    if (mine && K.isHitCard(c)) {
      const pen = kPen(s);
      const sub = `貯金して次へ → 次に当てはまった人は${esc(K.penaltyText(pen, (g.pot || 0) + 2))}`;
      action = `<button class="btn primary big" data-act="knext">いた！ 次の人へ</button>
        <button class="btn stack" data-act="knone">だれもいない<small>${sub}</small></button>`;
    } else if (mine && kiokuDrink(c, { pen: kPen(s), foot: GENRES[c.g]?.foot })?.after) {
      // 勝負・条件つき：結果が出てから「飲んだ！」で演出
      action = `<button class="btn primary big" data-act="kdrank" ${need ? 'disabled' : ''}>飲んだ！ 次の人へ</button>
        <button class="btn stack" data-act="knext" ${need ? 'disabled' : ''}>セーフ<small>だれも飲まずに次へ</small></button>`;
    } else {
      action = mine ? `<button class="btn primary big" data-act="knext" ${need ? 'disabled' : ''}>次の人へ</button>`
        : `<p class="waiting">${nm(g.turn)}が進めます</p>`;
    }
  }
  return `${seatStrip()}
    <section class="k-stage">
      <p class="ribbon">${avatar(turnP, 's')}<span>${who}</span></p>
      ${stage}
    </section>
    <section class="k-actions">
      <div class="k-act-main">${action}</div>
      ${g.step !== 'end' ? `<div class="burst" aria-label="残り${K.remaining(s)}枚"><span>残り</span><b>${K.remaining(s)}</b><span>枚</span></div>` : ''}
    </section>`;
}

// ---------- 画面：トークトライアル ----------
function talkNoticeText(s, nt, html = true) {
  const n = (pid) => (html ? nm(pid) : L.nameOf(s, pid));
  const pen = talkPen(s);
  const b = (t) => (html ? `<b>${t}</b>` : `${t} `);
  if (nt.kind === 'busted') return `${b('見破った！')}${n(nt.by)}が${n(nt.target)}のミッション「${esc(T.missionText(nt.mission))}」を当てた → ${n(nt.target)}は脱落して${pen}`;
  if (nt.kind === 'miss') return `${b('ハズレ！')}${n(nt.by)}の見破りは外れ → ${n(nt.by)}が${pen}`;
  return '';
}

// 通知ごとのハンコ。名前はエスケープして入れる（ハンコは innerHTML で描く）
function talkStamp(s, nt) {
  const n = (pid) => esc(L.nameOf(s, pid));
  if (nt.kind === 'out') return { text: 'NGワード！', sub: `${n(nt.target)}「${esc(N.wordText(nt.word))}」`, tone: 'pink', sounds: [['buzz', 0], ['pop', 0.6]] };
  if (nt.kind === 'busted') return { text: '見破った！', sub: `${n(nt.by)} → ${n(nt.target)}`, tone: 'pink', sounds: [['pop', 0], ['clink', 0.08], ['fanfare', 0.12]] };
  if (nt.kind === 'miss') return { text: 'ハズレ！', sub: `${n(nt.by)}が${talkPen(s)}`, tone: 'ink', sounds: [['buzz', 0]] };
  if (nt.kind === 'won') return { text: 'ミッション<br>達成！', sub: n(nt.who), tone: 'pink', sounds: [['pop', 0], ['fanfare', 0.08], ['cheer', 0.1]] };
  if (nt.kind === 'last') return { text: '逃げ切り！', sub: n(nt.who), tone: 'blue', sounds: [['fanfare', 0], ['cheer', 0.05]] };
  if (nt.kind === 'timeup') return { text: '時間切れ！', sub: `全員で${talkPen(s)}`, tone: 'ink', sounds: [['buzz', 0]] };
  return null;
}

function viewTalk() {
  const s = S();
  const g = s.game;
  const my = g.status[me.id];
  const timer = g.endsAt && g.step === 'talk' ? `<p class="k-timer t-timer">${ICON.timer}<span class="timer-num" data-end="${g.endsAt}" data-fmt="ms">${fmtLeft(g.endsAt)}</span></p>` : '';
  const nt = g.notice && (g.notice.kind === 'busted' || g.notice.kind === 'miss') ? `<div class="k-notice ${g.notice.kind === 'busted' ? 'drawer' : 'stock'}" role="status">${talkNoticeText(s, g.notice)}</div>` : '';
  let mission;
  if (ui.local) {
    mission = `<div class="t-local"><p>ミッションは、名前をタップして本人だけがこっそり確認</p>
      <div class="pick-row">${s.players.map((p) => `<button class="pick ${g.status[p.id] === 'out' ? 'off' : ''}" data-act="tpeek-who" data-pid="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>`;
  } else if (!inRoom()) {
    mission = '<p class="hint">観戦中です。次のラウンドから参加できます。</p>';
  } else if (my === 'out') {
    mission = `<div class="t-mission out"><img src="img/t-busted.webp" alt=""><p><b>バレてしまった…</b>ミッション：${esc(T.missionText(g.missions[me.id]))}<br>あとはみんなの会話を見守ろう</p></div>`;
  } else if (ui.showMission) {
    mission = `<button class="t-mission open" data-act="tpeek"><span class="k-genre">ひみつのミッション</span>
      <span class="t-mission-text">${esc(T.missionText(g.missions[me.id]))}</span>
      <small>これが起きたら「達成！」。自分で言ったりやったりしても無効。タップで隠す</small></button>`;
  } else {
    mission = `<button class="t-mission closed" data-act="tpeek"><img src="img/t-mission.webp" alt=""><span><b>ひみつのミッション</b><small>タップで表示（まわりに見られないように）</small></span></button>`;
  }
  let action;
  if (ui.local) {
    action = `<button class="btn primary big" data-act="tachieve">だれかが達成した！</button>
      <button class="btn stack" data-act="taccuse">見破る<small>怪しい人のミッションを3択で当てる（1人1回）</small></button>`;
  } else if (inRoom() && my === 'play') {
    action = `<button class="btn primary big" data-act="tachieve">達成した！<small>ミッションがみんなに公開されます</small></button>
      <button class="btn stack" data-act="taccuse" ${g.used[me.id] ? 'disabled' : ''}>見破る<small>${g.used[me.id] ? '見破りチャンスはもう使った' : `怪しい人のミッションを3択で当てる（1回だけ・ハズレは${talkPen(s)}）`}</small></button>`;
  } else {
    action = '<p class="waiting">会話を続けて、だれかの達成を待とう</p>';
  }
  return `${seatStrip()}
    <section class="k-stage t-stage">
      <article class="t-theme"><img src="img/t-theme.webp" alt=""><div><span class="k-genre">トークテーマ</span><p class="t-theme-text">${esc(T.themeText(g))}</p>
        ${isHost() && g.step === 'talk' && !g.n ? '<button class="t-reroll" data-act="treroll">別のテーマにする</button>' : ''}</div></article>
      ${timer}${nt}${mission}
    </section>
    <section class="k-actions"><div class="k-act-main">${action}</div></section>
    ${talkEnd()}`;
}

function fmtLeft(end) {
  const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

function talkEnd() {
  const s = S();
  const g = s.game;
  if (g.step !== 'over') return '';
  const pen = talkPen(s);
  const nt = g.notice || {};
  const title = g.winner ? `${nm(g.winner)}の勝ち！` : nt.kind === 'timeup' ? '時間切れ！' : 'ラウンド終了';
  const sub = g.winner ? `${nt.kind === 'last' ? '最後まで逃げ切り' : 'ミッション達成'} → ほかの全員で${pen}` : `だれも達成できず → 全員で${pen}`;
  const fl = anim(`${s.created}:${s.round}:talk-end`, 900);
  const rows = s.players.map((p) => {
    const stt = g.status[p.id];
    const label = stt === 'won' ? '勝ち' : stt === 'out' ? 'バレた' : '';
    const w = T.winsOf(s, p.id);
    return `<li class="t-row ${stt}">${avatar(p, 's')}<div><b>${esc(p.name)}</b>${label ? `<span class="t-st">${label}</span>` : ''}${w ? `<span class="t-wins">通算${w}勝</span>` : ''}<p>${esc(T.missionText(g.missions[p.id]))}</p></div></li>`;
  }).join('');
  return `<div class="overlay end talk-end" role="dialog" aria-label="結果">
    <figure class="result-art ${fl.cls}" style="${fl.style}"><img src="img/${g.winner ? 't-win' : 't-busted'}.webp" alt=""></figure>
    <h2 class="loser-name">${title}</h2>
    <p class="ov-ask">${sub}</p>
    <h3 class="t-reveal-h">みんなのミッション</h3>
    <ul class="t-reveal">${rows}</ul>
    ${isHost() ? '<div class="end-actions"><button class="btn primary big" data-act="again">もう一回（テーマもミッションも新しく）</button><button class="btn" data-act="lobby">メンバーや時間を変える</button></div>' : '<p class="waiting">ホストが次のラウンドを始めるのを待っています</p>'}
  </div>`;
}

// ---------- 画面：NGワードゲーム ----------
function viewNg() {
  const s = S();
  const g = s.game;
  const pen = talkPen(s);
  const timer = g.endsAt && g.step === 'talk' ? `<p class="k-timer t-timer">${ICON.timer}<span class="timer-num" data-end="${g.endsAt}" data-fmt="ms">${fmtLeft(g.endsAt)}</span></p>` : '';
  const nt = g.notice?.kind === 'out' ? `<div class="k-notice drawer" role="status"><b>NGワード！</b>${nm(g.notice.target)}が「${esc(N.wordText(g.notice.word))}」と言った → ${pen}（${nm(g.notice.by)}が指摘）。新しいワードに替わりました</div>` : '';
  const mine = inRoom() ? `<div class="ng-me"><span>あなたのNGワード</span><b>？？？</b><small>みんなには見えています。言ったら${pen}</small><em>${N.outsOf(g, me.id)}回</em></div>` : '';
  const others = s.players.filter((p) => !inRoom() || p.id !== me.id).map((p) => `<li class="ng-row">
      <span class="ng-who">${avatar(p, 's')}<span><b>${esc(p.name)}</b><small>${N.outsOf(g, p.id)}回</small></span></span>
      <b class="ng-word">${esc(N.wordText(g.words[p.id]))}</b>
      ${inRoom() && g.step === 'talk' ? `<button class="btn small ng-out" data-act="ngout" data-pid="${p.id}" data-w="${g.words[p.id]}">言った！</button>` : ''}
    </li>`).join('');
  return `${seatStrip()}
    <section class="ng-stage">
      <article class="t-theme"><img src="img/t-theme.webp" alt=""><div><span class="k-genre">トークテーマ</span><p class="t-theme-text">${esc(N.themeText(g))}</p>
        ${isHost() && g.step === 'talk' ? '<button class="t-reroll" data-act="treroll">別のテーマにする</button>' : ''}</div></article>
      ${timer}${nt}${mine}
      <h3 class="ng-h">みんなのNGワード<small>本人には見えていません。言ったらすぐ「言った！」</small></h3>
      <ul class="ng-list">${others}</ul>
    </section>
    ${ngEnd()}`;
}

function ngEnd() {
  const s = S();
  const g = s.game;
  if (g.step !== 'over') return '';
  const pen = talkPen(s);
  const max = g.worst?.length ? N.outsOf(g, g.worst[0]) : 0;
  const title = max ? `${g.worst.map((pid) => nm(pid)).join('・')}がいちばん言った！` : 'だれも言わなかった！';
  const sub = max ? `${max}回 → もう${pen}` : '全員の勝ち。乾杯！';
  const fl = anim(`${s.created}:${s.round}:ng-end`, 900);
  const rows = [...s.players].sort((a, b) => N.outsOf(g, a.id) - N.outsOf(g, b.id)).map((p) => {
    const said = g.said.filter((x) => x.pid === p.id).map((x) => `「${esc(N.wordText(x.word))}」`).join('');
    return `<li class="t-row ${g.worst?.includes(p.id) ? 'won' : ''}">${avatar(p, 's')}<div><b>${esc(p.name)}</b><span class="t-st">${N.outsOf(g, p.id)}回</span>
      <p>最後のNGワード：「${esc(N.wordText(g.words[p.id]))}」${said ? `<br>言ってしまった：${said}` : ''}</p></div></li>`;
  }).join('');
  return `<div class="overlay end talk-end" role="dialog" aria-label="結果">
    <figure class="result-art ${fl.cls}" style="${fl.style}"><img src="img/ng-out.webp" alt=""></figure>
    <h2 class="loser-name">${title}</h2>
    <p class="ov-ask">${sub}</p>
    <h3 class="t-reveal-h">みんなのNGワード（言った回数の少ない順）</h3>
    <ul class="t-reveal">${rows}</ul>
    ${isHost() ? '<div class="end-actions"><button class="btn primary big" data-act="again">もう一回（ワードもテーマも新しく）</button><button class="btn" data-act="lobby">メンバーや時間を変える</button></div>' : '<p class="waiting">ホストが次のラウンドを始めるのを待っています</p>'}
  </div>`;
}

function viewGame() {
  const s = S();
  const lv = drunkLevel(s);
  return `<main class="game ${isKioku(s) ? 'kioku' : isTalk(s) ? 'kioku talk' : isNg(s) ? 'kioku ng' : 'baba'} ${lv > 0 ? 'drunk' : ''}" style="--drunk:${lv.toFixed(2)}">
    ${topBar()}
    ${isKioku(s) ? viewKioku() : isTalk(s) ? viewTalk() : isNg(s) ? viewNg() : viewBaba()}
  </main>`;
}

// ---------- シート（メニュー・ルール・カード詳細） ----------
const RULES_BABA = `<h2>笑うババには酒来たる</h2>
<ol class="steps">
  <li><b>配ってペアを捨てる</b>最初にそろっているペアは、お題なしで捨てます（自動）。</li>
  <li><b>となりの人から1枚引く</b>選んだカードは相手の画面にも光ります。表情を読み合って。</li>
  <li><b>そろったらお題</b>引いたカードと手札のカード、どちらかのお題を選んで実行。上がった人もお題には参加します。</li>
  <li><b>最後にJOKERを持っていた人の負け</b>1番に上がった人が罰ゲームを決めます。</li>
</ol>
<table class="suits">
  <tr><td class="red">♦</td><td>だれがやる？</td><td>指名・全員を巻き込む</td></tr>
  <tr><td>♠</td><td>勝負と飲みゲー</td><td>じゃんけん・にらめっこ・古今東西・どすこい（お題はアプリが決める）</td></tr>
  <tr><td class="red">♥</td><td>乾杯タイム</td><td>とにかく飲む・乾杯</td></tr>
  <tr><td>♣</td><td>展開が動く</td><td>スキップ・リバース・交換・2倍</td></tr>
</table>
<p class="hint">ゆさぶり：自分の手札をタップすると、1枚だけ浮かせられます。CPUもときどき浮かせてきます。</p>`;
const RULES_KIOKU = `<h2>記憶無くしちゃダメですか</h2>
<ol class="steps">
  <li><b>順番にカードを引く</b>引いた人が、カードの中の「私」になります。</li>
  <li><b>書いてあることに従う</b>当てはまった人はペナルティ。中身はロビーで決めておけます。</li>
  <li><b>次の人へ</b>盛り上がったら次の人へ。山札がなくなったらもう一周も。</li>
</ol>
<table class="suits">
  <tr><td>1</td><td>第1弾</td><td>当てはまった人・直近◯◯した人・全員参加・遅刻ドジ・飲みゲー</td></tr>
  <tr><td>2</td><td>第2弾</td><td>王様・指名・ミニゲーム・乾杯・飲みゲー</td></tr>
</table>
<p class="hint"><b>飲みゲーのお題はアプリが決める</b>：山手線ゲーム・マジカルバナナ・どすこいゲーム・以心伝心ゲームなどは、カードを引いた瞬間にお題（頭文字・最初の言葉）が決まって、全員のスマホに同じものが出ます。</p>
<h3>だれも当てはまらないとき</h3>
<p class="hint"><b>いなけりゃ貯金、いたら総取り、乾杯なら全員。</b>「だれもいない」を押すとペナルティが1つ貯金されます。貯金に上限はなく、だれも当てはまらないかぎりどんどん溜まります。次に当てはまった人が出たら、貯金ぶんもまとめて受けます（貯金1つで2倍、2つで3倍、5つで6倍…）。<br>
貯金があるときに「全員で乾杯」のカードが出たら、全員がひとりずつ、乾杯の一杯に貯金ぶんを足して受けます（当てはまった人と同じで、貯金2つなら全員が3倍＝三口ずつ）。分け合いはなし。<br>
どちらも、受けたら貯金は0に戻ります。</p>`;
const RULES_TALK = `<h2>トークトライアル</h2>
<ol class="steps">
  <li><b>テーマとミッションが届く</b>トークテーマは全員同じ。ひみつのミッション（「誰かが〇〇した時」）は自分だけに届きます。</li>
  <li><b>テーマに沿って会話</b>さりげなく話を誘導して、だれかにミッションの言葉や動きをさせます。自分でやっても無効。</li>
  <li><b>起きたら「達成！」</b>ミッションが公開されて勝ち。ほかの全員で一口。</li>
</ol>
<p class="hint"><b>見破る</b>：怪しい人のミッションを3択で当てます（1人1ラウンド1回）。当たればその人は脱落して一口、外れたら自分が一口。最後の1人になったら逃げ切りで勝ち。制限時間を過ぎたら全員で一口。</p>`;
const RULES_NG = `<h2>NGワードゲーム</h2>
<ol class="steps">
  <li><b>全員にNGワードが配られる</b>自分のスマホには、ほかの人のNGワードだけが出ます。自分のワードは見えません。</li>
  <li><b>テーマに沿って会話</b>相手のNGワードを言わせるように、さりげなく話を振ります。</li>
  <li><b>言ったら「言った！」</b>その人が一口。すぐ新しいNGワードに替わって、会話は続きます。</li>
</ol>
<p class="hint">制限時間になったら、いちばん多く言った人がもう一口。2人でも遊べます。同時に押しても1回しか数えません。</p>`;
const RULES_COMMON = `<h3>モード</h3>
<p class="hint"><b>2人モード</b>：参加者がちょうど2人のとき自動で切り替わり、お題が「相手と」「2人で」になります。<br>
<b>CPU</b>：ロビーの「CPUを呼ぶ」で追加。CPUは自分で引いて、選んで、指名もします。お題の実行は人間が「次へ」を押します。<br>
<b>ゴリゴリ泥酔モード</b>：ペナルティが二口、縛りが3つまで重なり、記憶には泥酔カードが混ざります。進むほど画面も酔います。一定枚数ごとにチェイサー（お水）が強制で入ります。</p>
<p class="hint">一気飲みはしない。苦手な人はソフトドリンクや水でOK。答えたくないお題はペナルティでパス。</p>`;

function accuseSheet() {
  const s = S();
  const g = s.game;
  const a = ui.acc || {};
  const alive = T.alive(s);
  const by = ui.local ? a.by : me.id;
  if (!by) {
    const can = alive.filter((pid) => !g.used[pid]);
    return `<h2>だれが見破る？</h2><div class="pick-row">${can.map((pid) => `<button class="pick" data-act="tacc-by" data-pid="${pid}">${nm(pid)}</button>`).join('')}</div>${can.length ? '' : '<p class="hint">見破りチャンスが残っている人はいません</p>'}`;
  }
  if (!a.target) {
    const cands = alive.filter((pid) => pid !== by);
    return `<h2>だれのミッションを見破る？</h2><p class="hint">${ui.local ? `${nm(by)}の見破り。` : ''}チャンスは1回。外れたら${talkPen(s)}。</p>
      <div class="pick-row">${cands.map((pid) => `<button class="pick" data-act="tacc-target" data-pid="${pid}">${nm(pid)}</button>`).join('')}</div>`;
  }
  return `<h2>${nm(a.target)}のミッションはどれ？</h2>
    <div class="t-opts">${g.options[a.target].map((m) => `<button class="t-opt" data-act="tacc-pick" data-m="${m}">${esc(T.missionText(m))}</button>`).join('')}</div>
    <button class="btn link" data-act="tacc-back">選び直す</button>`;
}

function achieveSheet() {
  const s = S();
  return `<h2>だれが達成した？</h2><p class="hint">選んだ人のミッションが公開されます。</p>
    <div class="pick-row">${T.alive(s).map((pid) => `<button class="pick" data-act="tach-who" data-pid="${pid}">${nm(pid)}</button>`).join('')}</div>`;
}

function peekSheet(pid) {
  const s = S();
  const g = s.game;
  return `<h2>${nm(pid)}だけが見てね</h2>
    ${ui.peekShow ? `<div class="t-mission open static"><span class="k-genre">ひみつのミッション</span><span class="t-mission-text">${esc(T.missionText(g.missions[pid]))}</span>${g.status[pid] === 'out' ? '<small>（もうバレています）</small>' : ''}</div>
      <button class="btn primary" data-act="close-sheet">覚えた！ 閉じる</button>`
      : `<button class="btn primary big" data-act="tpeek-show">${nm(pid)}のミッションを見る</button>`}`;
}

function viewSheet() {
  const sh = ui.sheet;
  if (!sh) return '';
  let body = '';
  if (sh.type === 'rules') {
    const kind = sh.kind || kindOf();
    body = kind === 'ng' ? RULES_NG : kind === 'talk' ? RULES_TALK : (kind === 'kioku' ? RULES_KIOKU : RULES_BABA) + RULES_COMMON;
  }
  if (sh.type === 'accuse') body = accuseSheet();
  if (sh.type === 'achieve') body = achieveSheet();
  if (sh.type === 'peek') body = peekSheet(sh.pid);
  if (sh.type === 'menu') {
    const s = S();
    const logs = (isKioku(s) ? s?.game?.log?.slice(-10).reverse().map((l) => `<li>${esc(l)}</li>`) : s?.game?.log?.slice(-12).reverse().map((l) => `<li>${esc(l.m)}</li>`))?.join('') || '';
    body = `<h2>メニュー</h2>
      <div class="menu-list">
        <button class="btn" data-act="rules">遊び方</button>
        <button class="btn" data-act="sound" aria-pressed="${FX.fxState.sound}">効果音：${FX.fxState.sound ? 'オン' : 'オフ'}</button>
        ${s && inRoom() && !isHost() ? '<button class="btn" data-act="become-host">自分がホストになる</button>' : ''}
        ${s && isHost() && s.phase === 'play' ? '<button class="btn" data-act="lobby-confirm">ゲームを中断してロビーへ</button>' : ''}
        ${s?.game && isHost() && (s.game.rule || s.game.rules?.length) ? '<button class="btn" data-act="clear-rule">縛り・ルールを全部解除</button>' : ''}
        ${s && isChat(s) && isHost() && s.game?.step === 'talk' ? `<button class="btn" data-act="tend">このラウンドを終える${isTalk(s) ? '（勝者なし）' : ''}</button>` : ''}
        <button class="btn" data-act="leave">ホーム画面に戻る</button>
      </div>
      ${ui.local ? '' : `<p class="hint">接続：${ui.net === 'online' ? 'つながっています' : '再接続中'}（サーバー${(ui.broker ?? 0) + 1}）。ホストのスマホが止まったら、だれかが「自分がホストになる」を押すと代わりに進められます（CPUもその人のスマホが動かします）。</p>`}
      ${logs ? `<h3>最近の出来事</h3><ul class="log">${logs}</ul>` : ''}`;
  }
  if (sh.type === 'card') {
    const c = sh.card;
    const raised = ui.raised[me.id] === c;
    body = `<div class="one">${bigCard(c, S()?.game)}</div>
      ${c === 'JK' ? '<p class="hint">ババ。最後まで持っていたら負け。</p>' : '<p class="hint">このカードでペアがそろうと、このお題か相手のお題のどちらかを選んで実行します。</p>'}
      <button class="btn primary" data-act="raise" data-card="${c}">${raised ? '浮かせるのをやめる' : 'このカードを浮かせる（ゆさぶり）'}</button>
      <p class="hint">浮かせたカードは、あなたから引く人に飛び出して見えます。</p>`;
  }
  return `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet" role="dialog">${body}<button class="btn link" data-act="close-sheet">閉じる</button></div>`;
}

// ---------- 描画 ----------
function render() {
  const active = document.activeElement;
  const focusId = active?.id;
  const selStart = active?.selectionStart;
  const scrolls = {};
  app.querySelectorAll('[data-scroll]').forEach((el) => { scrolls[el.dataset.scroll] = el.scrollLeft; });
  const winScroll = window.scrollY;

  let html;
  if (ui.screen === 'connecting') html = viewConnecting();
  else if (ui.screen === 'room' && S()) html = S().phase === 'lobby' ? viewLobby() : viewGame();
  else if (ui.screen === 'room') html = viewConnecting();
  else if (ui.screen === 'setup' && ui.pick) html = viewSetup();
  else if (ui.screen === 'join') html = viewJoin();
  else html = viewHome();
  html += viewSheet();
  if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast.msg)}</div>`;
  app.innerHTML = html;

  app.querySelectorAll('[data-scroll]').forEach((el) => { if (scrolls[el.dataset.scroll] != null) el.scrollLeft = scrolls[el.dataset.scroll]; });
  if (Math.abs(window.scrollY - winScroll) > 1) window.scrollTo(0, winScroll);
  fitStage();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus({ preventScroll: true }); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch { /* noop */ } }
  }
}

// 記憶のカード画面を、スクロールなしで1画面に収める。
// 足りないぶんだけ絵を縮め、それでもだめなら段階的に詰める（fit1 詰める → fit2 文字を少し小さく → fit3 絵を消す → fit4 さらに小さく）
const ART_MIN = 72;
function fitStage() {
  const st = app.querySelector('.k-stage');
  if (!st) return;
  st.classList.remove('fit1', 'fit2', 'fit3', 'fit4');
  const art = st.querySelector('.k-art');
  if (art) { art.classList.remove('squeezed'); art.style.height = ''; }
  // 中身の高さはレイアウト上の値（offsetHeight）で足し算する。
  // scrollHeight や getBoundingClientRect は、めくりアニメ・泥酔ゆれの transform で大きく／小さく見えて、絵を縮めすぎる
  const over = () => {
    const cs = getComputedStyle(st);
    const kids = [...st.children].filter((e) => getComputedStyle(e).display !== 'none');
    let h = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + (parseFloat(cs.rowGap) || 0) * Math.max(0, kids.length - 1);
    for (const e of kids) {
      const ks = getComputedStyle(e);
      h += e.offsetHeight + parseFloat(ks.marginTop) + parseFloat(ks.marginBottom);
    }
    return Math.ceil(h - st.clientHeight);
  };
  // 元の高さは squeezed を付ける前に読む（付けると絵が画像本来の縦横比に戻って高さが変わる）
  const natural = art?.offsetHeight || 0;
  // 足りなければ縮め、詰めて余ったら元の高さまで戻す
  const squeeze = () => {
    const cur = art?.offsetHeight;
    if (!cur) return;
    const h = Math.min(natural, Math.max(ART_MIN, cur - over()));
    if (h === cur) return;
    art.classList.add('squeezed');
    art.style.height = `${h}px`;
  };
  squeeze();
  for (const lv of ['fit1', 'fit2', 'fit3', 'fit4']) {
    if (over() <= 0) return;
    st.classList.add(lv);
    squeeze();
  }
  // fit4 は一気に縮む（リボン・見出しが消え、指名ボタンも小さくなる）ので、下が空いたら絵を戻して埋める
  if (art && over() < -(ART_MIN + 8)) {
    st.classList.remove('fit3');
    squeeze();
    if (over() > 0) st.classList.add('fit3');
  }
}
// 日本語の書体は文字ごとに後から読み込まれ（新しいカードの漢字など）、そのたびに文字の高さが変わるので合わせ直す
document.fonts?.ready.then(() => fitStage());
document.fonts?.addEventListener?.('loadingdone', () => fitStage());

// タイマーの数字だけを更新
setInterval(() => {
  document.querySelectorAll('.timer-num[data-end]').forEach((el) => {
    const left = Math.max(0, Math.ceil((Number(el.dataset.end) - Date.now()) / 1000));
    const txt = el.dataset.fmt === 'ms' ? fmtLeft(Number(el.dataset.end)) : String(left);
    if (el.textContent !== txt) {
      el.textContent = txt;
      if (left === 0) { el.closest('.k-timer')?.classList.add('done'); vibrate(200); }
    }
  });
}, 250);

// ---------- 操作 ----------
app.addEventListener('input', (e) => {
  const m = e.target.dataset?.model;
  if (!m) return;
  if (m === 'name') me.name = e.target.value;
  if (m === 'code') { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); ui.code = e.target.value; }
  if (m === 'text') ui.text = e.target.value;
  if (m === 'addName') ui.addName = e.target.value;
  if (m === 'customText') ui.customText = e.target.value;
  if (m === 'penaltyText') {
    ui.penaltyText = e.target.value;
    const btn = app.querySelector('[data-act="penalty"]');
    if (btn) btn.disabled = !ui.penaltyText.trim();
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'in-code') handle('join-code', {});
  if (e.key === 'Enter' && e.target.id === 'in-add') handle('add-local', {});
  if (e.key === 'Enter' && e.target.id === 'in-custom') handle('custom-add', {});
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
});

// 音の解禁（iOS はタップの中でしか鳴らし始められない）。ほかの人がめくったときにも鳴るよう、最初のタップで済ませる
document.addEventListener('pointerdown', () => { if (FX.fxState.sound) FX.unlockAudio(); }, { passive: true });

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  handle(el.dataset.act, el.dataset);
});

function togglePick(list, pid, need) {
  if (list.includes(pid)) return list.filter((p) => p !== pid);
  if (need === 1) return [pid];
  if (list.length < need) return [...list, pid];
  return list;
}

function handle(act, d) {
  const s = S();
  const g = s?.game;
  const who = actor();
  switch (act) {
    case 'home': ui.screen = 'home'; ui.pick = null; render(); window.scrollTo(0, 0); break;
    case 'pick-game': ui.pick = d.g; ui.screen = 'setup'; render(); window.scrollTo(0, 0); break;
    case 'create': createRoom(ui.pick); break;
    case 'local': createLocal(ui.pick); break;
    case 'join-code': {
      ui.code = (document.getElementById('in-code')?.value || ui.code || '').toUpperCase();
      if (ui.code.length !== 4) { toast('部屋コードは4文字です'); return; }
      if (me.name) joinRoom(ui.code, null, { silent: true });
      else { ui.screen = 'join'; render(); }
      break;
    }
    case 'join': joinRoom(ui.code, ui.broker); break;
    case 'forget-code': ui.code = ''; ui.broker = null; ui.screen = 'home'; history.replaceState(null, '', location.pathname); render(); break;
    case 'rules': ui.sheet = { type: 'rules', kind: ui.screen === 'setup' ? GAMES[ui.pick]?.kind : kindOf() }; render(); break;
    case 'menu': ui.sheet = { type: 'menu' }; render(); break;
    case 'sound': FX.setSound(!FX.fxState.sound); render(); break;
    case 'close-sheet': ui.sheet = null; render(); break;
    case 'share': {
      const url = roomUrl();
      if (navigator.share) navigator.share({ title: 'NOMIKAI CARDS', text: `部屋コード ${ui.code}`, url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => toast('リンクをコピーしました'), () => toast(url, 5000));
      break;
    }
    case 'move': commit((x) => L.movePlayer(x, d.pid, Number(d.d))); break;
    case 'kick': commit((x) => L.removePlayer(x, d.pid)); break;
    case 'add-cpu': commit((x) => L.addCpu(x)); break;
    case 'add-local': {
      const name = (ui.addName || '').trim().slice(0, 10);
      if (!name) { toast('名前を入れてね'); return; }
      ui.addName = '';
      commit((x) => L.addPlayer(x, { id: 'L-' + newId().slice(0, 6), name }));
      document.getElementById('in-add')?.focus();
      break;
    }
    case 'set-deck': commit((x) => L.setSettings(x, { deck: d.d })); break;
    case 'set-pen': commit((x) => L.setSettings(x, { penalty: d.t })); break;
    case 'toggle-hard': {
      const hard = !s.settings?.hard;
      const pen = s.settings?.penalty;
      const from = hard ? PENALTY_CHOICES : PENALTY_CHOICES_HARD;
      const to = hard ? PENALTY_CHOICES_HARD : PENALTY_CHOICES;
      const penalty = from.includes(pen) ? to[from.indexOf(pen)] : pen;
      commit((x) => L.setSettings(x, { hard, penalty }));
      if (hard) toast('ゴリゴリ泥酔モード ON。チェイサーは強制で入ります', 3000);
      break;
    }
    case 'leave': ui.sheet = null; leaveToHome(); break;
    case 'start': ui.showMission = false; commit((x) => startFor(x)); break;
    case 'set-min': commit((x) => L.setSettings(x, { minutes: Number(d.m) })); break;
    case 'custom-add': {
      const t = (ui.customText || document.getElementById('in-custom')?.value || '').trim();
      if (commit((x) => K.addCustom(x, t))) { ui.customText = ''; render(); document.getElementById('in-custom')?.focus(); }
      break;
    }
    case 'custom-del': commit((x) => K.removeCustom(x, d.id)); break;
    case 'tpeek': ui.showMission = !ui.showMission; render(); break;
    case 'tpeek-who': ui.peekShow = false; ui.sheet = { type: 'peek', pid: d.pid }; render(); break;
    case 'tpeek-show': ui.peekShow = true; render(); break;
    case 'tachieve':
      if (ui.local) { ui.sheet = { type: 'achieve' }; render(); }
      else if (confirm('ミッション達成を宣言しますか？（全員に公開されます）')) commit((x) => T.achieve(x, me.id));
      break;
    case 'tach-who': ui.sheet = null; commit((x) => T.achieve(x, d.pid)); break;
    case 'taccuse': ui.acc = {}; ui.sheet = { type: 'accuse' }; render(); break;
    case 'tacc-by': ui.acc = { by: d.pid }; render(); break;
    case 'tacc-target': ui.acc = { ...ui.acc, target: d.pid }; render(); break;
    case 'tacc-back': ui.acc = { by: ui.acc?.by }; render(); break;
    case 'tacc-pick': {
      const by = ui.local ? ui.acc?.by : me.id;
      const target = ui.acc?.target;
      ui.sheet = null;
      ui.acc = null;
      commit((x) => T.accuse(x, by, target, Number(d.m)));
      break;
    }
    case 'treroll': commit((x) => (isNg(x) ? N.rerollTheme(x) : T.rerollTheme(x))); break;
    case 'tend': ui.sheet = null; if (confirm('このラウンドを終えますか？')) commit((x) => (isNg(x) ? N.endRound(x) : T.endRound(x))); break;
    case 'ngout': {
      const w = Number(d.w);
      if (confirm(`${L.nameOf(s, d.pid)}が「${N.wordText(w)}」と言った？`)) commit((x) => N.callOut(x, me.id, d.pid, w));
      break;
    }
    case 'become-host': ui.sheet = null; commit((x) => L.makeHost(x, me.id)); toast('あなたがホストになりました'); break;
    case 'lobby-confirm': ui.sheet = null; if (confirm('ゲームを中断してロビーに戻りますか？')) commit((x) => L.backToLobby(x)); break;
    case 'clear-rule': ui.sheet = null; commit((x) => { const y = JSON.parse(JSON.stringify(x)); y.game.rule = null; y.game.rules = []; return y; }); break;
    case 'proxy': ui.proxy = true; render(); break;
    // ババ酒
    case 'pick-draw': {
      if (!g || g.step !== 'draw' || !iAct()) return;
      ui.sel = Number(d.i);
      ui.room?.publishLive({ k: 'hover', seq: g.seq, idx: ui.sel });
      render();
      break;
    }
    case 'draw': if (ui.sel != null) commit((x) => L.draw(x, who, ui.sel)); break;
    case 'choose': if (iAct()) commit((x) => L.choose(x, who, d.card)); break;
    case 'pick': ui.picks = togglePick(ui.picks, d.pid, L.needCount(g.pair.chosen)); render(); break;
    case 'commit': if (iAct()) commit((x) => L.commitOdai(x, who, { picks: ui.picks, text: ui.text })); break;
    case 'finish': if (iAct()) commit((x) => L.finishOdai(x, who)); break;
    case 'finish-drank': if (iAct()) commit((x) => L.finishOdai(x, who, Math.random, { drank: true })); break;
    case 'preset': ui.penaltyText = d.t; render(); break;
    case 'penalty': if (iAct()) commit((x) => L.setPenalty(x, who, ui.penaltyText)); break;
    case 'again': ui.penaltyText = ''; ui.showMission = false; commit((x) => startFor(x)); break;
    case 'lobby': commit((x) => L.backToLobby(x)); break;
    case 'card': ui.sheet = { type: 'card', card: d.card }; render(); break;
    case 'raise': {
      const next = ui.raised[me.id] === d.card ? null : d.card;
      ui.raised[me.id] = next;
      ui.room?.publishRaise(next);
      ui.sheet = null;
      render();
      break;
    }
    // 記憶
    case 'kdraw': if (iAct()) commit((x) => K.draw(x, x.game.turn)); break;
    case 'kpick': ui.picks = togglePick(ui.picks, d.pid, K.currentCard(s).need); render(); break;
    case 'kcommit': if (iAct()) commit((x) => K.commit(x, x.game.turn, { picks: ui.picks, text: ui.text })); break;
    case 'ktimer': commit((x) => K.startTimer(x, x.game.turn)); break;
    case 'knext': if (iAct()) commit((x) => K.next(x, x.game.turn)); break;
    case 'kdrank': if (iAct()) commit((x) => K.next(x, x.game.turn, { drank: true })); break;
    case 'knone': if (iAct()) commit((x) => K.none(x, x.game.turn)); break;
    case 'kreshuffle': commit((x) => K.reshuffle(x)); break;
    default: break;
  }
}

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  if (document.visibilityState === 'visible') {
    // 5秒以上消えていたら、つながって見えても作り直す（iPhone はスリープ中に通信が止まり、気づくまで20秒以上かかる）
    ui.room?.nudge(hiddenAt > 0 && Date.now() - hiddenAt > 5000);
    hiddenAt = 0;
    if (S()?.phase === 'play') keepAwake(true);
    scheduleCpu();
  }
});
let resizeT = null;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 120); });
setInterval(() => {
  scheduleCpu();
  if (BOT) scheduleBot();
  const s = S();
  if (s && isChat(s) && isHost() && s.game?.step === 'talk' && s.game.endsAt && Date.now() >= s.game.endsAt) commit((x) => (isNg(x) ? N.timeUp(x) : T.timeUp(x)));
}, 1000);

// ---------- テスト用の窓口 ----------
window.render_game_to_text = () => {
  const s = S();
  const g = s?.game;
  const base = {
    screen: ui.screen, local: ui.local, code: ui.code, broker: ui.broker, net: ui.net, me: me.id, name: me.name,
    kind: s?.kind ?? null, phase: s?.phase ?? null, step: g?.step ?? null, actor: s ? actorOf(s) : null, iAct: iAct(),
    players: s?.players.map((p) => ({ id: p.id, name: p.name, cpu: p.cpu || null, n: g?.hands?.[p.id]?.length ?? null })) ?? [],
    v: s?.v ?? null, round: s?.round ?? 0, overlay: !!document.querySelector('.overlay'), settings: s?.settings ?? null,
    duo: g?.duo ?? null, hard: g?.hard ?? null,
    fx: { count: FX.fxState.count, last: FX.fxState.last, sound: FX.fxState.sound },
  };
  if (isNg(s) && g) Object.assign(base, { theme: N.themeText(g), words: g.words, outs: g.outs, notice: g.notice, endsAt: g.endsAt, worst: g.worst ?? null, visibleWords: [...document.querySelectorAll('.ng-word')].map((e) => e.textContent) });
  else if (isTalk(s) && g) Object.assign(base, { theme: T.themeText(g), myMission: g.missions[me.id] ?? null, status: g.status, used: g.used, winner: g.winner, notice: g.notice, endsAt: g.endsAt, showMission: !!ui.showMission });
  else if (isKioku(s) && g) Object.assign(base, { turn: g.turn, card: g.card, text: K.currentCard(s)?.t ?? null, remaining: K.remaining(s), n: g.n, rules: g.rules, committed: g.committed, pot: g.pot ?? 0, notice: g.notice ?? null, hit: K.isHitCard(K.currentCard(s)), toast: K.isToastCard(K.currentCard(s)) });
  else if (g) Object.assign(base, { turn: g.turn, target: L.drawTarget(s), myHand: g.hands[me.id] ?? null, finished: g.finished, loser: g.loser, penalty: g.penalty, pair: g.pair ? { by: g.pair.by, cards: g.pair.cards, chosen: g.pair.chosen, committed: g.pair.committed } : null });
  return JSON.stringify(base);
};
window.__bb = { ui, L, K, me, commit, FX }; // commit はテストで山札を仕込むため

// ---------- 起動 ----------
render();
(function boot() {
  if (params.has('local')) {
    try {
      const saved = JSON.parse(store.get('local') || 'null');
      if (saved?.players) { ui.local = true; ui.state = saved; ui.screen = 'room'; render(); scheduleCpu(); return; }
    } catch { /* noop */ }
    history.replaceState(null, '', location.pathname);
    return;
  }
  const saved = store.get('room');
  if (ui.code && me.name && (params.has('autojoin') || saved === `${ui.code}:${ui.broker}`)) {
    joinRoom(ui.code, ui.broker, { silent: true });
  }
})();
