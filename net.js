// 通信：公開MQTTブローカー経由で、部屋ごとに状態を共有する
// state  : 部屋の全状態（retained）。担当者のスマホが更新して配る
// live   : 一時的な合図（引く人が指を置いたカードなど）
// raise/<id> : 各自が「浮かせた」カード（retained）
/* global mqtt */

export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];
const PREFIX = 'warababa-sake-bb100/v1';

export class Room {
  constructor({ code, broker, me, onState, onLive, onRaise, onStatus }) {
    this.code = code;
    this.broker = broker;
    this.me = me;
    this.onState = onState || (() => {});
    this.onLive = onLive || (() => {});
    this.onRaise = onRaise || (() => {});
    this.onStatus = onStatus || (() => {});
    this.client = null;
    this.status = 'connecting';
  }

  topic(x) {
    return `${PREFIX}/${this.code}/${x}`;
  }

  connect(timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { this.client?.end(true); } catch { /* noop */ }
        reject(new Error('つながりませんでした'));
      }, timeoutMs);
      const c = mqtt.connect(BROKERS[this.broker], {
        clientId: `bb_${this.me.id.slice(0, 8)}_${Math.random().toString(16).slice(2, 8)}`,
        keepalive: 20,
        reconnectPeriod: 1500,
        connectTimeout: 8000,
        clean: true,
        resubscribe: true,
      });
      this.client = c;
      c.on('connect', () => {
        c.subscribe([this.topic('state'), this.topic('live'), this.topic('raise/+')], { qos: 1 }, () => {
          this.setStatus('online');
          if (!settled) { settled = true; clearTimeout(timer); resolve(this); }
        });
      });
      c.on('reconnect', () => this.setStatus('reconnecting'));
      c.on('offline', () => this.setStatus('reconnecting'));
      c.on('close', () => { if (this.status === 'online') this.setStatus('reconnecting'); });
      c.on('error', () => {});
      c.on('message', (topic, payload, packet) => {
        const text = payload.toString();
        if (!text) return;
        let data;
        try { data = JSON.parse(text); } catch { return; }
        if (topic === this.topic('state')) { this.lastState = data; this.onState(data, !!packet.retain); }
        else if (topic === this.topic('live')) this.onLive(data);
        else if (topic.startsWith(this.topic('raise/'))) this.onRaise(topic.split('/').pop(), data);
      });
    });
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }

  // つながっていないときは送らない（mqtt.js は切れている間の送信をためておき、つながった瞬間に古い状態を送ってしまう）
  publishState(state) {
    if (!this.client?.connected) return false;
    this.client.publish(this.topic('state'), JSON.stringify(state), { qos: 1, retain: true });
    return true;
  }

  publishLive(data) {
    this.client?.publish(this.topic('live'), JSON.stringify({ ...data, from: this.me.id }), { qos: 0 });
  }

  publishRaise(card, pid = this.me.id) {
    this.client?.publish(this.topic(`raise/${pid}`), JSON.stringify({ card: card || null }), { qos: 1, retain: true });
  }

  // 接続が切れていたら作り直す（スマホのスリープ復帰用）。
  // force: 長く画面を消していたあとは、つながって見えても実は切れていることがあるので作り直す
  nudge(force = false) {
    const c = this.client;
    if (!c) return;
    if (force && c.connected) {
      this.setStatus('reconnecting');
      try { c.end(true, {}, () => { try { c.reconnect(); } catch { /* noop */ } }); } catch { /* noop */ }
      return;
    }
    if (!c.connected) {
      try { c.reconnect(); } catch { /* noop */ }
    }
  }

  close() {
    try { this.client?.end(true); } catch { /* noop */ }
    this.client = null;
  }
}

// 部屋の状態が届くまで待つ（届かなければ null）
export function waitForState(room, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (room.lastState) return resolve(room.lastState);
      if (Date.now() - t0 > ms) return resolve(null);
      setTimeout(tick, 80);
    };
    tick();
  });
}
