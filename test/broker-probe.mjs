// 公開MQTTブローカーの疎通・retained・遅延を確認する
import mqtt from 'mqtt';

const brokers = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

async function probe(url) {
  const topic = `babasake-probe/${Math.random().toString(36).slice(2)}`;
  const t0 = Date.now();
  const res = { url };
  try {
    const a = await connect(url);
    res.connectMs = Date.now() - t0;
    // retained publish
    await new Promise((r, j) => a.publish(topic + '/state', JSON.stringify({ hello: 1, pad: 'x'.repeat(6000) }), { retain: true, qos: 1 }, e => e ? j(e) : r()));
    // 別クライアントが後から入って retained を受け取れるか
    const b = await connect(url);
    const t1 = Date.now();
    const got = await new Promise((r) => {
      const to = setTimeout(() => r(null), 5000);
      b.on('message', (t, m) => { clearTimeout(to); r(m.toString().length); });
      b.subscribe(topic + '/state', { qos: 1 });
    });
    res.retainedBytes = got; res.retainedMs = Date.now() - t1;
    // 往復遅延
    const t2 = Date.now();
    const rt = await new Promise((r) => {
      const to = setTimeout(() => r(null), 5000);
      a.subscribe(topic + '/ping', { qos: 0 }, () => {
        a.on('message', (t) => { if (t.endsWith('/ping')) { clearTimeout(to); r(Date.now() - t2); } });
        b.publish(topic + '/ping', 'p');
      });
    });
    res.pingMs = rt;
    // 掃除（retained消去）
    a.publish(topic + '/state', '', { retain: true });
    setTimeout(() => { a.end(true); b.end(true); }, 300);
  } catch (e) { res.error = String(e.message || e); }
  return res;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(url, { connectTimeout: 8000, reconnectPeriod: 0, clientId: 'probe_' + Math.random().toString(16).slice(2, 10) });
    c.once('connect', () => resolve(c));
    c.once('error', reject);
    setTimeout(() => reject(new Error('timeout')), 9000);
  });
}

for (const u of brokers) console.log(JSON.stringify(await probe(u)));
setTimeout(() => process.exit(0), 800);
