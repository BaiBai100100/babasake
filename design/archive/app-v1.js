// 画面と操作。状態は logic.js、通信は net.js。
import * as L from './logic.js';
import { ODAI, SUIT_INFO, HEART_NOTE, PENALTY_PRESETS } from './odai.js';
import { Room, BROKERS, waitForState } from './net.js';
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

// ---------- 画面の状態 ----------
const ui = {
  screen: 'home', // home | connecting | room
  code: (params.get('r') || '').toUpperCase(),
  broker: params.has('b') ? Number(params.get('b')) : null,
  state: null,
  room: null,
  net: 'offline',
  sel: null,
  hover: null,
  raised: {},
  picks: [],
  text: '',
  penaltyText: '',
  sheet: null,
  toast: null,
  proxy: false,
  newCard: null,
  animKey: '',
  busy: '',
};
const app = document.getElementById('app');

// ---------- 小物 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = () => ui.state;
const G = () => ui.state?.game;
const nm = (pid) => esc(L.nameOf(S(), pid));
const isHost = () => S()?.hostId === me.id;
const inRoom = () => !!S()?.players.some((p) => p.id === me.id);
const actor = () => (S() ? L.actorOf(S()) : null);
const iAct = () => actor() === me.id || (ui.proxy && isHost());
const roomUrl = () => `${location.origin}${location.pathname}?r=${ui.code}&b=${ui.broker}`;
const suitClass = (id) => (id === 'JK' ? 'joker' : SUIT_INFO[L.suitOf(id)].color);

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

// ---------- お多福（JOKER）の絵 ----------
const OTAFUKU = `<svg viewBox="0 0 100 100" aria-hidden="true" class="otafuku">
<path d="M50 9C26 9 13 30 15 53c2 23 17 39 35 39s33-16 35-39C87 30 74 9 50 9Z" fill="#FFFDF6" stroke="#24262B" stroke-width="2.6"/>
<path d="M15 47C14 24 31 7 50 7s36 17 35 40c-6-15-19-22-35-19-16-3-29 4-35 19Z" fill="#24262B"/>
<ellipse cx="35" cy="37" rx="5.2" ry="2.7" fill="#24262B"/><ellipse cx="65" cy="37" rx="5.2" ry="2.7" fill="#24262B"/>
<path d="M29 54q6-6.5 12 0M59 54q6-6.5 12 0" fill="none" stroke="#24262B" stroke-width="2.6" stroke-linecap="round"/>
<circle cx="27" cy="66" r="7.5" fill="#F09C97" opacity=".75"/><circle cx="73" cy="66" r="7.5" fill="#F09C97" opacity=".75"/>
<path d="M42 72q8 9 16 0q-8 3.5-16 0Z" fill="#D8402F"/></svg>`;

// ---------- カード ----------
function cardFace(id, { size = 'm', extra = '', attrs = '' } = {}) {
  if (id === 'JK') {
    return `<div class="card face joker ${size} ${extra}" ${attrs}><span class="rk">JOKER</span>${OTAFUKU}<span class="jk-name">ババ</span></div>`;
  }
  const s = L.suitOf(id);
  const info = SUIT_INFO[s];
  const r = L.RANK_LABEL[L.rankOf(id)];
  return `<div class="card face ${info.color} ${size} ${extra}" ${attrs}>
    <span class="rk">${r}</span><span class="st">${info.mark}</span>
    <span class="pip">${info.mark}</span><span class="role">${info.short}</span></div>`;
}
const cardBack = ({ size = 'm', extra = '', attrs = '' } = {}) => `<div class="card back ${size} ${extra}" ${attrs}><span class="sake">酒</span></div>`;

// 再描画されても途中から続くアニメーション
const animStart = {};
function anim(key, dur = 700) {
  const t0 = (animStart[key] ??= Date.now());
  const el = Date.now() - t0;
  return el < dur ? { cls: 'flip', style: `animation-delay:-${el}ms` } : { cls: '', style: '' };
}

function bigCard(id, { extra = '', attrs = '', double = false, flip = null } = {}) {
  const fl = flip || { cls: '', style: '' };
  if (id === 'JK') return `<div class="bigcard joker ${fl.cls}" style="${fl.style}">${OTAFUKU}<div class="big-jk">JOKER</div></div>`;
  const s = L.suitOf(id);
  const info = SUIT_INFO[s];
  const def = ODAI[id];
  return `<div class="bigcard ${info.color} ${extra} ${fl.cls}" style="${fl.style}" ${attrs}>
    <div class="bc-top"><span class="bc-rk">${L.RANK_LABEL[L.rankOf(id)]}</span><span class="bc-st">${info.mark}</span><span class="bc-role">${info.name}｜${info.role}</span></div>
    <p class="bc-text">${esc(def.t)}</p>
    ${double ? '<div class="x2">効果2倍：飲むなら二口、やるなら2回</div>' : ''}
    ${s === 'H' ? `<div class="bc-note">${HEART_NOTE}</div>` : ''}
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
  if (!s || !s.v || !s.players) return;
  if (ui.state && !newer(s, ui.state)) {
    // 古い状態が保存されていたら、手元の新しい状態で上書きして直す
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
  if (!S()) return;
  try {
    const next = fn(S());
    next.v = S().v + 1;
    next.ts = Date.now();
    next.by = me.id;
    const prev = S();
    ui.state = next;
    ui.room?.publishState(next);
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
  // 参加し直し（ロビーで自分が消えていたら入り直す）
  if (s.phase === 'lobby' && ui.wantJoin && !s.players.some((p) => p.id === me.id)) scheduleJoin();
  // 手番・場面が変わったら一時的な選択を消す
  if (!g || !pg || g.seq !== pg.seq || g.step !== pg.step || prev.round !== s.round) {
    ui.sel = null;
    ui.picks = [];
    ui.text = '';
    ui.proxy = false;
  }
  if (g && pg && g.lastDraw && (!pg.lastDraw || pg.lastDraw.seq !== g.lastDraw.seq || prev.round !== s.round)) {
    const d = g.lastDraw;
    const label = L.cardLabel(d.card);
    if (d.by === me.id && !d.matched) {
      ui.newCard = d.card;
      setTimeout(() => { ui.newCard = null; render(); }, 2500);
      toast(d.card === 'JOKER' || d.card === 'JK' ? 'JOKERを引いた…顔に出さないで' : `${label} を引いた（そろわず）`);
    } else if (d.from === me.id) {
      toast(d.card === 'JK' ? 'JOKERを引かれた！ ババが移った' : `${label} を引かれた`);
    } else if (!d.matched) {
      toast(`${L.nameOf(s, d.by)}が${L.nameOf(s, d.from)}から引いた`, 1800);
    }
  }
  if (s.phase === 'play' && L.actorOf(s) === me.id && (!prev || L.actorOf(prev) !== me.id || prev.phase !== 'play')) vibrate([70, 40, 70]);
  document.title = s.phase === 'play' && L.actorOf(s) === me.id ? '● あなたの番｜笑うババには酒来たる' : '笑うババには酒来たる';
  keepAwake(s.phase === 'play' || s.phase === 'over');
  if (BOT) scheduleBot();
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

async function createRoom() {
  if (!needName()) return;
  ui.screen = 'connecting';
  ui.busy = '部屋を用意しています';
  render();
  for (let b = 0; b < BROKERS.length; b++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      const room = makeRoom(code, b);
      try {
        await room.connect();
      } catch {
        break; // このブローカーはダメ → 次へ
      }
      const existing = await waitForState(room, 1200);
      if (existing && Date.now() - (existing.ts || 0) < 24 * 3600 * 1000) { room.close(); continue; }
      const s = L.makeRoomState(code, me);
      s.created = Date.now();
      ui.state = null;
      ui.state = s;
      room.publishState(s);
      ui.wantJoin = true;
      enterRoom(room);
      afterStateChange(null, s);
      return;
    }
  }
  ui.screen = 'home';
  toast('通信サーバーにつながりませんでした。電波を確認してもう一度', 4000);
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
  ui.screen = 'home';
  toast(`部屋 ${code} が見つかりませんでした`, 3500);
}

function leaveToHome() {
  if (S()?.phase === 'lobby' && inRoom()) commit((s) => L.removePlayer(s, me.id));
  ui.wantJoin = false;
  setTimeout(() => {
    ui.room?.close();
    ui.room = null;
    ui.state = null;
    ui.screen = 'home';
    ui.sheet = null;
    store.del('room');
    history.replaceState(null, '', location.pathname);
    keepAwake(false);
    render();
  }, 300);
}

// ---------- 自動操作（テスト用 ?bot=1） ----------
let botTimer = null;
function scheduleBot() {
  if (botTimer) return;
  botTimer = setTimeout(() => {
    botTimer = null;
    const s = S();
    if (!s) return;
    if (s.phase === 'lobby' && isHost() && BOT_START && s.players.length >= BOT_START) { commit((x) => L.startGame(x)); return; }
    if (s.phase !== 'play' || L.actorOf(s) !== me.id) return;
    const a = L.autoAction(s);
    if (a?.type === 'draw') {
      ui.room?.publishLive({ k: 'hover', seq: s.game.seq, idx: a.index });
    }
    if (a) commit((x) => L.applyAction(x, a));
  }, 350 + Math.random() * 400);
}

// ---------- 画面：ホーム ----------
function viewHome() {
  const joining = !!ui.code;
  return `<main class="home">
    <section class="hero">
      <div class="hero-cards" aria-hidden="true">${cardBack({ size: 'l', extra: 'tilt-l' })}${cardFace('JK', { size: 'l', extra: 'tilt-r' })}</div>
      <h1 class="logo"><span>笑うババには</span><span>酒来たる</span></h1>
      <p class="lead">ペアがそろうたびにお題が出る、飲み会用のババ抜き。みんな自分のスマホで参加します。</p>
    </section>
    <section class="form">
      <label class="field"><span>あなたの名前</span>
        <input id="in-name" data-model="name" maxlength="10" autocomplete="nickname" placeholder="例：はるのり" value="${esc(me.name)}"></label>
      ${joining ? `
        <button class="btn primary" data-act="join">部屋 ${esc(ui.code)} に参加する</button>
        <button class="btn link" data-act="forget-code">自分で部屋を作る</button>
      ` : `
        <button class="btn primary" data-act="create">部屋を作る</button>
        <div class="or"><span>友だちの部屋に入るなら</span></div>
        <div class="join-row">
          <input id="in-code" data-model="code" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="コード4文字" value="${esc(ui.code)}" aria-label="部屋コード">
          <button class="btn" data-act="join">参加</button>
        </div>`}
    </section>
    <button class="btn link rules-link" data-act="rules">遊び方を見る</button>
    <footer class="fine">非公式のファンメイド。お題はオリジナルです。<br>お酒は20歳になってから。一気飲みはしない。苦手な人はソフトドリンクで。</footer>
  </main>`;
}

function viewConnecting() {
  return `<main class="connecting"><div class="spinner" aria-hidden="true">${cardBack({ size: 'm' })}</div><p>${esc(ui.busy || 'つないでいます')}</p></main>`;
}

// ---------- 画面：ロビー ----------
function viewLobby() {
  const s = S();
  const host = isHost();
  const n = s.players.length;
  let qr = '';
  try {
    const q = qrcode(0, 'M');
    q.addData(roomUrl());
    q.make();
    qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: '参加用QRコード' });
  } catch { /* noop */ }
  const rows = s.players.map((p, i) => `
    <li class="seat">
      <span class="seat-no">${i + 1}</span>
      <span class="seat-name">${esc(p.name)}${p.id === me.id ? '<em>あなた</em>' : ''}${p.id === s.hostId ? '<em class="host">ホスト</em>' : ''}</span>
      ${host ? `<span class="seat-ctl">
        <button class="icon" data-act="move" data-pid="${p.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="${esc(p.name)}を上へ">${ICON.up}</button>
        <button class="icon" data-act="move" data-pid="${p.id}" data-d="1" ${i === n - 1 ? 'disabled' : ''} aria-label="${esc(p.name)}を下へ">${ICON.down}</button>
        ${p.id !== me.id ? `<button class="icon" data-act="kick" data-pid="${p.id}" aria-label="${esc(p.name)}を外す">${ICON.x}</button>` : ''}
      </span>` : ''}
    </li>`).join('');
  return `<main class="lobby">
    ${topBar()}
    <section class="invite">
      <div class="code-block"><span class="code-label">部屋コード</span><span class="code">${esc(ui.code)}</span>
        <button class="btn small" data-act="share">${ICON.share}招待リンクを送る</button></div>
      <div class="qr">${qr}</div>
    </section>
    <section class="seats">
      <h2>席順 <small>${n}人</small></h2>
      <p class="hint">実際に座っている順（時計回り）に並べてね。となりの人から引くので大事です。</p>
      <ol>${rows}</ol>
    </section>
    <section class="lobby-actions">
      ${!inRoom() ? `<p class="hint">参加中…</p>` : host
        ? `<button class="btn primary" data-act="start" ${n < L.MIN_PLAYERS ? 'disabled' : ''}>${n < L.MIN_PLAYERS ? `あと${L.MIN_PLAYERS - n}人で始められます` : 'ゲームを始める'}</button>`
        : `<p class="waiting">ホストが始めるのを待っています</p>`}
      <button class="btn link" data-act="leave">部屋を出る</button>
    </section>
  </main>`;
}

// ---------- 画面：ゲーム ----------
function topBar() {
  const s = S();
  const g = s?.game;
  const netLabel = ui.net === 'online' ? '' : '<span class="net bad">再接続中…</span>';
  const chips = [];
  if (g && s.phase === 'play') {
    chips.push(`<span class="chip dir">${ICON.dir}${g.dir === 1 ? '時計回り' : '反時計回り'}</span>`);
    if (g.rule) chips.push(`<span class="chip rule">縛り：${esc(g.rule.text)}</span>`);
    if (g.double) chips.push('<span class="chip x2c">次のお題 2倍</span>');
    if (g.skip) chips.push(`<span class="chip">スキップ待ち ${g.skip}</span>`);
  }
  return `<header class="topbar">
    <span class="room-code" aria-label="部屋コード">${esc(ui.code)}</span>
    ${netLabel}
    <div class="chips">${chips.join('')}</div>
    <button class="icon" data-act="menu" aria-label="メニュー">${ICON.menu}</button>
  </header>`;
}

function seatStrip() {
  const s = S();
  const g = s.game;
  const target = L.drawTarget(s);
  const items = s.players.map((p) => {
    const cnt = g.hands[p.id]?.length ?? 0;
    const rank = g.finished.indexOf(p.id);
    const cls = [
      p.id === g.turn ? 'turn' : '',
      p.id === target ? 'target' : '',
      rank >= 0 ? 'done' : '',
      p.id === g.loser ? 'loser' : '',
      p.id === me.id ? 'me' : '',
    ].join(' ');
    const badge = rank >= 0 ? `<span class="pl-badge">${rank + 1}抜け</span>` : p.id === g.loser ? '<span class="pl-badge">負け</span>' : `<span class="pl-count">${ICON.cards}${cnt}</span>`;
    return `<li class="pl ${cls}"><span class="pl-name">${esc(p.name)}</span>${badge}</li>`;
  });
  const arrow = `<li class="pl-arrow" aria-hidden="true">${g.dir === 1 ? '›' : '‹'}</li>`;
  return `<ul class="strip" data-scroll="strip">${items.join(arrow)}</ul>`;
}

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
  const avail = Math.min(window.innerWidth - 40, 520);
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
  if (iDraw && drawer === me.id) head = `<b>あなたの番</b>　${nm(target)}さんから1枚引いて`;
  else if (iDraw) head = `<b>${nm(drawer)}さんの代わりに</b>　${nm(target)}さんから引く`;
  else if (iTarget) head = `<b>${nm(drawer)}さん</b>があなたのカードを狙っています`;
  else head = `<b>${nm(drawer)}さん</b>が${nm(target)}さんから引いています`;
  const sub = iTarget ? '<p class="zone-sub">手札をタップすると、1枚だけ浮かせてゆさぶれます</p>'
    : iDraw ? `<p class="zone-sub">${selIdx == null ? 'カードをタップして選ぶ（選んだカードは相手にも見えます）' : '相手の顔をよく見て…'}</p>` : '';
  return `<section class="zone">
    <p class="zone-head">${head}</p>${sub}
    <div class="fan-wrap"><div class="fan">${cards}</div></div>
    ${iDraw ? `<button class="btn primary draw-btn" data-act="draw" ${selIdx == null ? 'disabled' : ''}>このカードを引く</button>` : ''}
    ${!iDraw && isHost() && drawer !== me.id ? `<button class="btn link proxy" data-act="proxy">${nm(drawer)}さんの代わりに進める</button>` : ''}
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
  const head = `<div class="ov-head"><span class="ov-who">${nm(by)}さん、ペア成立！</span><span class="ov-sub">${L.RANK_LABEL[L.rankOf(pr.cards[0])]}がそろった（${L.cardLabel(pr.cards[0])}と${L.cardLabel(pr.cards[1])}）</span></div>`;
  if (g.step === 'choose') {
    const caps = [`${nm(pr.from)}さんから引いた`, '手札にあった'];
    const cards = pr.cards.map((c, i) => `<div class="choice"><span class="choice-cap">${caps[i]}</span>${bigCard(c, { flip, attrs: mine ? `data-act="choose" data-card="${c}" role="button" tabindex="0"` : '', extra: mine ? 'tappable' : '' })}</div>`).join('');
    return `<div class="overlay" role="dialog" aria-label="お題を選ぶ">${head}
      <p class="ov-ask">${mine ? 'やるお題を1つタップ' : `${nm(by)}さんがお題を選んでいます`}${g.double ? '<span class="x2-inline">次のお題は2倍</span>' : ''}</p>
      <div class="pair-row">${cards}</div>
      ${!mine && isHost() ? `<button class="btn link proxy" data-act="proxy">${nm(by)}さんの代わりに進める</button>` : ''}
    </div>`;
  }
  const id = pr.chosen;
  const def = ODAI[id];
  const need = def.need;
  const cands = L.pickCandidates(s, by);
  let controls = '';
  if (mine) {
    if (!pr.committed && typeof need === 'number' && need > 0) {
      const required = Math.min(need, cands.length);
      controls = cands.length ? `<p class="ov-ask">${required}人を指名</p>
        <div class="pick-row">${cands.map((pid) => `<button class="pick ${ui.picks.includes(pid) ? 'on' : ''}" data-act="pick" data-pid="${pid}" aria-pressed="${ui.picks.includes(pid)}">${nm(pid)}</button>`).join('')}</div>
        <button class="btn primary" data-act="commit" ${ui.picks.length !== required ? 'disabled' : ''}>決定</button>`
        : `<p class="ov-ask">対象になる人がいないので不発</p><button class="btn primary" data-act="commit">次へ</button>`;
    } else if (!pr.committed && need === 'text') {
      controls = `<label class="field"><span>みんなに守らせる縛り（40字まで）</span><input id="in-rule" data-model="text" maxlength="40" placeholder="例：敬語禁止" value="${esc(ui.text)}"></label>
        <button class="btn primary" data-act="commit">この縛りにする</button>`;
    } else {
      controls = `<button class="btn primary" data-act="finish">やった！ 次へ</button>`;
    }
  } else {
    controls = `<p class="waiting">${nm(by)}さんが進めるのを待っています</p>${isHost() ? `<button class="btn link proxy" data-act="proxy">${nm(by)}さんの代わりに進める</button>` : ''}`;
  }
  const targets = pr.picks?.length ? `<p class="ov-target">対象：${pr.picks.map((p) => `<b>${nm(p)}</b>`).join('、')}</p>` : '';
  const result = pr.result ? `<p class="ov-result">${esc(pr.result)}</p>` : '';
  const peek = pr.peek && (by === me.id) ? `<div class="peek"><span>こっそり見たカード</span>${pr.peek.map((c) => cardFace(c, { size: 's' })).join('')}</div>` : '';
  return `<div class="overlay" role="dialog" aria-label="お題">${head}
    <div class="one">${bigCard(id, { flip, double: pr.double })}</div>
    ${targets}${result}${peek}
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
      body = `<p class="ov-ask">1番に上がったあなたが、${nm(loser)}さんの罰ゲームを決める</p>
        <div class="preset">${PENALTY_PRESETS.map((t) => `<button class="pick ${ui.penaltyText === t ? 'on' : ''}" data-act="preset" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <label class="field"><span>自分で書く</span><input id="in-pen" data-model="penaltyText" maxlength="60" value="${esc(ui.penaltyText)}" placeholder="罰ゲームを入力"></label>
        <button class="btn primary" data-act="penalty" ${ui.penaltyText.trim() ? '' : 'disabled'}>これに決定</button>`;
    } else {
      body = `<p class="waiting">1番に上がった${nm(first)}さんが罰ゲームを考えています</p>${isHost() ? `<button class="btn link proxy" data-act="proxy">${nm(first)}さんの代わりに決める</button>` : ''}`;
    }
  } else {
    body = `<div class="penalty"><span>罰ゲーム</span><p>${esc(g.penalty)}</p></div>
      ${isHost() ? `<div class="end-actions"><button class="btn primary" data-act="again">同じメンバーでもう一回</button><button class="btn" data-act="lobby">メンバーを変える</button></div>` : '<p class="waiting">ホストが次のゲームを始めるのを待っています</p>'}`;
  }
  return `<div class="overlay end ${g.step === 'penalty' ? 'deciding' : ''}" role="dialog" aria-label="結果">
    <div class="loser-card">${bigCard('JK', { flip: anim(`${s.created}:${s.round}:end`, 900) })}</div>
    <h2 class="loser-name">${loser ? `${nm(loser)}さんの負け！` : '終了'}</h2>
    <ol class="ranking">${ranking}</ol>
    ${body}
  </div>`;
}

function viewGame() {
  const s = S();
  const out = `<main class="game">
    ${topBar()}
    ${seatStrip()}
    ${drawZone()}
    ${myHand()}
    ${odaiOverlay()}
    ${endOverlay()}
  </main>`;
  return out;
}

// ---------- シート（メニュー・ルール・カード詳細） ----------
function viewSheet() {
  const sh = ui.sheet;
  if (!sh) return '';
  let body = '';
  if (sh.type === 'rules') body = RULES_HTML;
  if (sh.type === 'menu') {
    const s = S();
    const logs = s?.game?.log?.slice(-12).reverse().map((l) => `<li>${esc(l.m)}</li>`).join('') || '';
    body = `<h2>メニュー</h2>
      <div class="menu-list">
        <button class="btn" data-act="rules">遊び方</button>
        ${s && inRoom() && !isHost() ? '<button class="btn" data-act="become-host">自分がホストになる</button>' : ''}
        ${s && isHost() && s.phase === 'play' ? '<button class="btn" data-act="lobby-confirm">ゲームを中断してロビーへ</button>' : ''}
        ${s?.game?.rule && isHost() ? '<button class="btn" data-act="clear-rule">縛りを解除する</button>' : ''}
        <button class="btn" data-act="leave">ホーム画面に戻る</button>
      </div>
      <p class="hint">接続：${ui.net === 'online' ? 'つながっています' : '再接続中'}（サーバー${(ui.broker ?? 0) + 1}）。ホストのスマホが止まったら、だれかが「自分がホストになる」を押すと代わりに進められます。</p>
      ${logs ? `<h3>最近の出来事</h3><ul class="log">${logs}</ul>` : ''}`;
  }
  if (sh.type === 'card') {
    const c = sh.card;
    const raised = ui.raised[me.id] === c;
    body = `<div class="one">${bigCard(c)}</div>
      ${c === 'JK' ? '<p class="hint">ババ。最後まで持っていたら負け。</p>' : '<p class="hint">このカードでペアがそろうと、このお題か相手のお題のどちらかを選んで実行します。</p>'}
      <button class="btn primary" data-act="raise" data-card="${c}">${raised ? '浮かせるのをやめる' : 'このカードを浮かせる（ゆさぶり）'}</button>
      <p class="hint">浮かせたカードは、あなたから引く人に飛び出して見えます。</p>`;
  }
  return `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet" role="dialog">${body}<button class="btn link" data-act="close-sheet">閉じる</button></div>`;
}

const RULES_HTML = `<h2>遊び方</h2>
<ol class="steps">
  <li><b>配ってペアを捨てる</b>最初にそろっているペアは、お題なしで捨てます（自動）。</li>
  <li><b>となりの人から1枚引く</b>選んだカードは相手の画面にも光ります。表情を読み合って。</li>
  <li><b>そろったらお題</b>引いたカードと手札のカード、どちらかのお題を選んで実行。上がった人もお題には参加します。</li>
  <li><b>最後にJOKERを持っていた人の負け</b>1番に上がった人が罰ゲームを決めます。</li>
</ol>
<table class="suits">
  <tr><td class="red">♦</td><td>だれがやる？</td><td>指名・全員を巻き込む</td></tr>
  <tr><td>♠</td><td>勝負とルール</td><td>じゃんけん・対決・縛り</td></tr>
  <tr><td class="red">♥</td><td>ドキドキ</td><td>恋バナ・打ち明け話</td></tr>
  <tr><td>♣</td><td>展開が動く</td><td>スキップ・リバース・交換・2倍</td></tr>
</table>
<p class="hint">ゆさぶり：自分の手札をタップすると、1枚だけ浮かせられます。引く人には飛び出して見えるので、ババを浮かせるか、逆にするかは自由。</p>
<p class="hint">一気飲みはしない。苦手な人はソフトドリンクや水でOK。答えたくないお題は一口でパス。</p>`;

// ---------- アイコン（線画） ----------
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  share: svg('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  dir: svg('<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>', 'width="14" height="14"'),
  cards: svg('<rect x="6" y="3" width="12" height="17" rx="2"/><path d="M3 7v11a3 3 0 0 0 3 3h9"/>', 'width="13" height="13"'),
};

// ---------- 描画 ----------
function render() {
  const active = document.activeElement;
  const focusId = active?.id;
  const selStart = active?.selectionStart;
  const scrolls = {};
  app.querySelectorAll('[data-scroll]').forEach((el) => { scrolls[el.dataset.scroll] = el.scrollLeft; });

  let html;
  if (ui.screen === 'connecting') html = viewConnecting();
  else if (ui.screen === 'room' && S()) html = S().phase === 'lobby' ? viewLobby() : viewGame();
  else if (ui.screen === 'room') html = viewConnecting();
  else html = viewHome();
  html += viewSheet();
  if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast.msg)}</div>`;
  app.innerHTML = html;

  app.querySelectorAll('[data-scroll]').forEach((el) => { if (scrolls[el.dataset.scroll] != null) el.scrollLeft = scrolls[el.dataset.scroll]; });
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch { /* noop */ } }
  }
}

// ---------- 操作 ----------
app.addEventListener('input', (e) => {
  const m = e.target.dataset?.model;
  if (!m) return;
  if (m === 'name') me.name = e.target.value;
  if (m === 'code') { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); ui.code = e.target.value; }
  if (m === 'text') ui.text = e.target.value;
  if (m === 'penaltyText') {
    ui.penaltyText = e.target.value;
    const btn = app.querySelector('[data-act="penalty"]');
    if (btn) btn.disabled = !ui.penaltyText.trim();
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'in-code') handle('join', {});
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
});

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  handle(el.dataset.act, el.dataset);
});

function handle(act, d) {
  const s = S();
  const g = s?.game;
  const who = actor();
  switch (act) {
    case 'create': createRoom(); break;
    case 'join': joinRoom(ui.code || document.getElementById('in-code')?.value, ui.broker); break;
    case 'forget-code': ui.code = ''; ui.broker = null; history.replaceState(null, '', location.pathname); render(); break;
    case 'rules': ui.sheet = { type: 'rules' }; render(); break;
    case 'menu': ui.sheet = { type: 'menu' }; render(); break;
    case 'close-sheet': ui.sheet = null; render(); break;
    case 'share': {
      const url = roomUrl();
      if (navigator.share) navigator.share({ title: '笑うババには酒来たる', text: `部屋コード ${ui.code}`, url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => toast('リンクをコピーしました'), () => toast(url, 5000));
      break;
    }
    case 'move': commit((x) => L.movePlayer(x, d.pid, Number(d.d))); break;
    case 'kick': commit((x) => L.removePlayer(x, d.pid)); break;
    case 'leave': ui.sheet = null; leaveToHome(); break;
    case 'start': commit((x) => L.startGame(x)); break;
    case 'become-host': ui.sheet = null; commit((x) => L.makeHost(x, me.id)); toast('あなたがホストになりました'); break;
    case 'lobby-confirm': ui.sheet = null; if (confirm('ゲームを中断してロビーに戻りますか？')) commit((x) => L.backToLobby(x)); break;
    case 'clear-rule': ui.sheet = null; commit((x) => { const y = JSON.parse(JSON.stringify(x)); y.game.rule = null; return y; }); break;
    case 'proxy': ui.proxy = true; render(); break;
    case 'pick-draw': {
      if (!g || g.step !== 'draw' || !iAct()) return;
      ui.sel = Number(d.i);
      ui.room?.publishLive({ k: 'hover', seq: g.seq, idx: ui.sel });
      render();
      break;
    }
    case 'draw':
      if (ui.sel == null) return;
      commit((x) => L.draw(x, who, ui.sel));
      break;
    case 'choose': if (iAct()) commit((x) => L.choose(x, who, d.card)); break;
    case 'pick': {
      const need = L.needCount(g.pair.chosen);
      if (ui.picks.includes(d.pid)) ui.picks = ui.picks.filter((p) => p !== d.pid);
      else if (need === 1) ui.picks = [d.pid];
      else if (ui.picks.length < need) ui.picks = [...ui.picks, d.pid];
      render();
      break;
    }
    case 'commit': if (iAct()) commit((x) => L.commitOdai(x, who, { picks: ui.picks, text: ui.text })); break;
    case 'finish': if (iAct()) commit((x) => L.finishOdai(x, who)); break;
    case 'preset': ui.penaltyText = d.t; render(); break;
    case 'penalty': if (iAct()) commit((x) => L.setPenalty(x, who, ui.penaltyText)); break;
    case 'again': ui.penaltyText = ''; commit((x) => L.startGame(x)); break;
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
    default: break;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    ui.room?.nudge();
    if (S()?.phase === 'play') keepAwake(true);
  }
});
window.addEventListener('resize', () => render());
if (BOT) setInterval(scheduleBot, 1500);

// ---------- テスト用の窓口 ----------
window.render_game_to_text = () => {
  const s = S();
  const g = s?.game;
  return JSON.stringify({
    screen: ui.screen, code: ui.code, broker: ui.broker, net: ui.net, me: me.id, name: me.name,
    phase: s?.phase ?? null, step: g?.step ?? null, actor: s ? L.actorOf(s) : null,
    players: s?.players.map((p) => ({ id: p.id, name: p.name, n: g?.hands[p.id]?.length ?? null })) ?? [],
    turn: g?.turn ?? null, target: s ? L.drawTarget(s) : null, myHand: g?.hands[me.id] ?? null,
    finished: g?.finished ?? [], loser: g?.loser ?? null, penalty: g?.penalty ?? null,
    pair: g?.pair ? { by: g.pair.by, cards: g.pair.cards, chosen: g.pair.chosen } : null,
    v: s?.v ?? null, round: s?.round ?? 0, overlay: !!document.querySelector('.overlay'),
  });
};
window.__bb = { ui, L, me };

// ---------- 起動 ----------
render();
(function boot() {
  const saved = store.get('room');
  if (ui.code && me.name && (params.has('autojoin') || saved === `${ui.code}:${ui.broker}`)) {
    joinRoom(ui.code, ui.broker, { silent: true });
  }
})();
