# 笑うババには酒来たる（ブラウザ版・非公式）

ペアがそろうたびにお題が出る、飲み会用のババ抜き。各自のスマホで部屋コードを入れて参加する。

- 遊ぶ：https://baibai100100.github.io/babasake/
- 市販のカードゲーム「笑うババには酒来たる」（セッシュタグ）のルールをもとにした非公式のファンメイド。お題の文面はすべてオリジナル。
- 通信は公開MQTTブローカー（broker.emqx.io、予備に broker.hivemq.com）を使う。アカウント不要・動作保証なし。手札は技術的には覗ける。

## ファイル
| ファイル | 中身 |
|---|---|
| `index.html` / `style.css` | 画面 |
| `app.js` | 画面の組み立て・操作・同期 |
| `logic.js` | ルール（純粋関数。Node でテスト可能） |
| `odai.js` | お題52枚と罰ゲーム候補 |
| `net.js` | MQTT 通信 |
| `vendor/` | mqtt.js・qrcode-generator（どちらもMIT） |

## テスト
```
npm i
node --test test/logic.test.mjs          # ルール（ランダム1000ゲーム含む）
python3 -m http.server 8765 &            # 別ターミナル
node test/e2e.mjs http://localhost:8765/ # 4台ぶんのブラウザで1ゲーム通し
```
