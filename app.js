// 画面と操作。ルールは logic.js（ババ酒）と kioku.js（記憶）、通信は net.js。
import * as L from './logic.js';
import * as K from './kioku.js';
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
    kind: 'baba', title: '笑うババには酒来たる', titleHtml: '笑うババには<br>酒来たる', badge: '', img: 'hub-baba', tone: 'paper',
    desc: 'ペアがそろうたびにお題が出るババ抜き。表情の読み合いで盛り上がる', meta: '2〜10人', settings: {},
    steps: ['配って、そろったペアを捨てる', 'となりの人から1枚引く', 'ペアがそろったらお題を実行', '最後にJOKERを持っていた人の負け'],
    localLabel: '1人でCPUと遊ぶ',
  },
  kioku1: {
    kind: 'kioku', title: '記憶無くしちゃダメですか', titleHtml: '記憶無くしちゃ<br>ダメですか', badge: '第1弾', img: 'hub-kioku1', tone: 'pink',
    desc: '当てはまった人・直近◯◯した人・全員参加・遅刻ドジ。元祖の54枚', meta: '2人〜', settings: { deck: 'k1' },
    steps: ['順番にカードを引く（引いた人が「私」）', '書いてあることに従う', '次の人へ'],
    localLabel: 'このスマホ1台で遊ぶ',
  },
  kioku2: {
    kind: 'kioku', title: '記憶無くしちゃダメですか', titleHtml: '記憶無くしちゃ<br>ダメですか', badge: '第2弾', img: 'hub-kioku2', tone: 'blue',
    desc: '王様・指名・ミニゲーム・暴露。もっと攻めた54枚', meta: '2人〜', settings: { deck: 'k2' },
    steps: ['順番にカードを引く（引いた人が「私」）', '書いてあることに従う', '次の人へ'],
    localLabel: 'このスマホ1台で遊ぶ',
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
const nm = (pid) => esc(L.nameOf(S(), pid));
const kindOf = (s = S()) => s?.kind || 'baba';
const isKioku = (s = S()) => kindOf(s) === 'kioku';
const actorOf = (s) => (isKioku(s) ? K.actorOf(s) : L.actorOf(s));
const minPlayers = (s = S()) => (isKioku(s) ? K.MIN_PLAYERS : L.MIN_PLAYERS);
const isHost = () => ui.local || S()?.hostId === me.id;
const inRoom = () => ui.local || !!S()?.players.some((p) => p.id === me.id);
const actor = () => (S() ? actorOf(S()) : null);
const cpuOf = (pid) => S()?.players.find((p) => p.id === pid)?.cpu || null;
const isCpu = (pid) => !!cpuOf(pid);
const roomUrl = () => `${location.origin}${location.pathname}?r=${ui.code}&b=${ui.broker}`;
const gameMeta = (s = S()) => (isKioku(s) ? GAMES[s?.settings?.deck === 'k2' ? 'kioku2' : 'kioku1'] : GAMES.baba);
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
  if (ui.local && isKioku(s)) return true;
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
    <p class="bc-text">${esc(def.t)}</p>
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
    } else if (d.from === me.id) {
      toast(d.card === 'JK' ? 'JOKERを引かれた！ ババが移った' : `${label} を引かれた`);
    } else if (!d.matched) {
      toast(`${L.nameOf(s, d.by)}が${L.nameOf(s, d.from)}から引いた`, 1800);
    }
  }
  if (g?.chaser && !pg?.chaser) toast('チェイサータイム！ 全員お水を一口', 3500);
  if (isKioku(s) && g?.notice && pg && (!pg.notice || pg.notice.n !== g.notice.n || pg.notice.kind !== g.notice.kind)) {
    if (g.notice.kind === 'paid' || g.notice.kind === 'kanpai') vibrate([120, 60, 120]);
  }
  const drink = drinkOf(prev, s);
  if (drink) FX.playDrink(drink);
  if (s.phase === 'play' && actorOf(s) === me.id && (!prev || actorOf(prev) !== me.id || prev.phase !== 'play')) vibrate([70, 40, 70]);
  document.title = s.phase === 'play' && actorOf(s) === me.id && !ui.local ? '● あなたの番｜NOMIKAI CARDS' : 'NOMIKAI CARDS';
  keepAwake(s.phase === 'play' || s.phase === 'over');
  scheduleCpu();
  if (BOT) scheduleBot();
}

// 飲むことが確定した瞬間（全員の画面で同じ判定）。再接続や読み込み直後（prev なし）は出さない
function drinkOf(prev, s) {
  const g = s?.game;
  const pg = prev?.game;
  if (!g || !pg || prev.created !== s.created || prev.round !== s.round) return null;
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
    onStatus: (st) => { ui.net = st; render(); },
  });
}

function enterRoom(room) {
  ui.room = room;
  ui.code = room.code;
  ui.broker = room.broker;
  ui.net = 'online';
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
      <span class="tile-meta">${ICON.people}${m.meta}</span>
    </span>
    <span class="tile-art"><img src="img/${m.img}.webp" alt=""></span>
    <span class="tile-go">${ICON.arrow}</span>
  </button></li>`;
}

function viewHome() {
  return `<main class="hub">
    <header class="brand-row"><span class="brand">NOMIKAI<br>CARDS</span><span class="brand-sub">飲み会カードゲーム集<br>（非公式ファンメイド）</span></header>
    <h1 class="hub-title"><span>今夜なに</span><span>遊ぶ？</span></h1>
    <ul class="tiles">${tile('baba')}${tile('kioku1')}${tile('kioku2')}</ul>
    <section class="modes">
      <div class="mode-card"><img src="img/mode-duo.webp" alt=""><p><b>2人でもOK</b>2人だけになると、お題が2人用に切り替わる</p></div>
      <div class="mode-card"><img src="img/mode-hard.webp" alt=""><p><b>ゴリゴリ泥酔モード</b>ロビーでON。進むほど画面も酔っていく</p></div>
    </section>
    <section class="join-box">
      <h2>友だちの部屋に入る</h2>
      <div class="join-row">
        <input id="in-code" data-model="code" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="コード4文字" value="${esc(ui.code)}" aria-label="部屋コード">
        <button class="btn" data-act="join-code">参加</button>
      </div>
    </section>
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
    <button class="btn" data-act="local">${esc(m.localLabel)}</button>
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
  const settings = `
    <section class="settings">
      ${isKioku(s) ? `<div class="set-row"><span class="set-label">山札</span>
        <div class="seg">${['k1', 'k2', 'mix'].map((d) => `<button class="seg-btn ${st.deck === d ? 'on' : ''}" ${host ? `data-act="set-deck" data-d="${d}"` : 'disabled'}>${DECK_LABEL[d]}</button>`).join('')}</div></div>
        <div class="set-row"><span class="set-label">ペナルティ</span>
        <div class="chips-wrap">${pens.map((p) => `<button class="pick sm ${st.penalty === p ? 'on' : ''}" ${host ? `data-act="set-pen" data-t="${esc(p)}"` : 'disabled'}>${esc(p)}</button>`).join('')}</div></div>` : ''}
      <button class="hard-toggle ${st.hard ? 'on' : ''}" ${host ? 'data-act="toggle-hard"' : 'disabled'} aria-pressed="${!!st.hard}">
        <img src="img/mode-hard.webp" alt="">
        <span><b>ゴリゴリ泥酔モード</b><small>${st.hard ? 'ON：ペナルティ二口・縛りが重なる・画面も酔う。チェイサーは強制' : 'OFF'}</small></span>
        <span class="switch" aria-hidden="true"></span>
      </button>
      ${n === 2 ? '<div class="duo-note"><img src="img/mode-duo.webp" alt=""><p><b>2人モード</b>2人用のお題に切り替わります</p></div>' : ''}
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
      <p class="hint">${isKioku(s) ? '座っている順（時計回り）に並べると、引く順番がそのまま回ります。' : '座っている順（時計回り）に並べてね。となりの人から引くので大事です。'}</p>
      <ol>${rows}</ol>
      ${host ? `<div class="add-row">
        ${ui.local && isKioku(s) ? `<input id="in-add" data-model="addName" maxlength="10" placeholder="参加する人の名前" value="${esc(ui.addName)}"><button class="btn small" data-act="add-local">${ICON.plus}追加</button>` : ''}
        <button class="btn small cpu-btn" data-act="add-cpu">${ICON.bot}CPUを呼ぶ</button>
      </div>` : ''}
    </section>
    ${settings}
    <section class="lobby-actions">
      ${!inRoom() ? '<p class="hint">参加中…</p>' : host
        ? `<button class="btn primary big" data-act="start" ${canStart ? '' : 'disabled'}>${canStart ? 'ゲームを始める' : `あと${minPlayers(s) - n}人（CPUでもOK）`}</button>`
        : '<p class="waiting">ホストが始めるのを待っています</p>'}
      <button class="btn link" data-act="leave">${ui.local ? 'ホームに戻る' : '部屋を出る'}</button>
    </section>
  </main>`;
}

// ---------- 共通：上のバーと席 ----------
function drunkLevel(s) {
  const g = s?.game;
  if (!g?.hard || s.phase !== 'play') return 0;
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
    if (!isKioku(s)) chips.push(`<span class="chip">${ICON.dir}${g.dir === 1 ? '時計回り' : '反時計回り'}</span>`);
    const rules = isKioku(s) ? g.rules || [] : (g.hard ? g.rules || [] : (g.rule ? [g.rule] : []));
    for (const r of rules) chips.push(`<span class="chip rule">${isKioku(s) ? 'ルール' : '縛り'}：${esc(r.text)}</span>`);
    if (g.double) chips.push('<span class="chip x2c">次のお題 2倍</span>');
    if (g.skip) chips.push(`<span class="chip">スキップ待ち ${g.skip}</span>`);
    if (g.duo) chips.push('<span class="chip">2人モード</span>');
    if (g.hard) {
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
    <ol class="ranking">${ranking}</ol>
    ${body}
  </div>`;
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
  const text = esc(c.t).replace(/私/g, '<span class="me-word">私</span>');
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

function viewGame() {
  const s = S();
  const lv = drunkLevel(s);
  return `<main class="game ${isKioku(s) ? 'kioku' : 'baba'} ${lv > 0 ? 'drunk' : ''}" style="--drunk:${lv.toFixed(2)}">
    ${topBar()}
    ${isKioku(s) ? viewKioku() : viewBaba()}
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
  <tr><td>♠</td><td>勝負とルール</td><td>じゃんけん・対決・縛り</td></tr>
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
  <tr><td>1</td><td>第1弾</td><td>当てはまった人・直近◯◯した人・全員参加・遅刻ドジ</td></tr>
  <tr><td>2</td><td>第2弾</td><td>王様・指名・ミニゲーム・暴露</td></tr>
</table>
<h3>だれも当てはまらないとき</h3>
<p class="hint"><b>いなけりゃ貯金、いたら総取り、乾杯なら全員。</b>「だれもいない」を押すとペナルティが1つ貯金されます。貯金に上限はなく、だれも当てはまらないかぎりどんどん溜まります。次に当てはまった人が出たら、貯金ぶんもまとめて受けます（貯金1つで2倍、2つで3倍、5つで6倍…）。<br>
貯金があるときに「全員で乾杯」のカードが出たら、全員がひとりずつ、乾杯の一杯に貯金ぶんを足して受けます（当てはまった人と同じで、貯金2つなら全員が3倍＝三口ずつ）。分け合いはなし。<br>
どちらも、受けたら貯金は0に戻ります。</p>`;
const RULES_COMMON = `<h3>モード</h3>
<p class="hint"><b>2人モード</b>：参加者がちょうど2人のとき自動で切り替わり、お題が「相手と」「2人で」になります。<br>
<b>CPU</b>：ロビーの「CPUを呼ぶ」で追加。CPUは自分で引いて、選んで、指名もします。お題の実行は人間が「次へ」を押します。<br>
<b>ゴリゴリ泥酔モード</b>：ペナルティが二口、縛りが3つまで重なり、記憶には泥酔カードが混ざります。進むほど画面も酔います。一定枚数ごとにチェイサー（お水）が強制で入ります。</p>
<p class="hint">一気飲みはしない。苦手な人はソフトドリンクや水でOK。答えたくないお題はペナルティでパス。</p>`;

function viewSheet() {
  const sh = ui.sheet;
  if (!sh) return '';
  let body = '';
  if (sh.type === 'rules') {
    const kind = sh.kind || kindOf();
    body = (kind === 'kioku' ? RULES_KIOKU : RULES_BABA) + RULES_COMMON;
  }
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
// 足りないぶんだけ絵を縮め、それでもだめなら段階的に詰める（fit1 → 絵を消す fit2 → 文字を小さく fit3）
const ART_MIN = 72;
function fitStage() {
  const st = app.querySelector('.k-stage');
  if (!st) return;
  st.classList.remove('fit1', 'fit2', 'fit3');
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
  for (const lv of ['fit1', 'fit2', 'fit3']) {
    if (over() <= 0) return;
    st.classList.add(lv);
    squeeze();
  }
}
// 日本語の書体は文字ごとに後から読み込まれ（新しいカードの漢字など）、そのたびに文字の高さが変わるので合わせ直す
document.fonts?.ready.then(() => fitStage());
document.fonts?.addEventListener?.('loadingdone', () => fitStage());

// タイマーの数字だけを更新
setInterval(() => {
  document.querySelectorAll('.timer-num[data-end]').forEach((el) => {
    const left = Math.max(0, Math.ceil((Number(el.dataset.end) - Date.now()) / 1000));
    if (el.textContent !== String(left)) {
      el.textContent = left;
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
  if (m === 'penaltyText') {
    ui.penaltyText = e.target.value;
    const btn = app.querySelector('[data-act="penalty"]');
    if (btn) btn.disabled = !ui.penaltyText.trim();
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'in-code') handle('join-code', {});
  if (e.key === 'Enter' && e.target.id === 'in-add') handle('add-local', {});
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
    case 'start': commit((x) => (isKioku(x) ? K.startGame(x) : L.startGame(x))); break;
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
    case 'again': ui.penaltyText = ''; commit((x) => (isKioku(x) ? K.startGame(x) : L.startGame(x))); break;
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    ui.room?.nudge();
    if (S()?.phase === 'play') keepAwake(true);
    scheduleCpu();
  }
});
let resizeT = null;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 120); });
setInterval(() => { scheduleCpu(); if (BOT) scheduleBot(); }, 1500);

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
  if (isKioku(s) && g) Object.assign(base, { turn: g.turn, card: g.card, text: K.currentCard(s)?.t ?? null, remaining: K.remaining(s), n: g.n, rules: g.rules, committed: g.committed, pot: g.pot ?? 0, notice: g.notice ?? null, hit: K.isHitCard(K.currentCard(s)), toast: K.isToastCard(K.currentCard(s)) });
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
