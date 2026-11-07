# NOMIKAI CARDS（飲み会カードゲーム集・非公式）

- 笑うババには酒来たる（お題つきババ抜き）
- 記憶無くしちゃダメですか 第1弾・第2弾（引いて従うだけ）

各自のスマホで部屋コードを入れて参加。2人モード（自動）、CPU、ゴリゴリ泥酔モード、1台モードあり。画像は gpt-image-2 で生成（原本は design/raw、リポジトリ外）。

- 遊ぶ：https://baibai100100.github.io/babasake/
- 市販のカードゲーム（セッシュタグ）のルールをもとにした非公式のファンメイド。お題の文面はすべてオリジナル。
- 通信は公開MQTTブローカー（broker.emqx.io、予備に broker.hivemq.com）を使う。アカウント不要・動作保証なし。手札は技術的には覗ける。

## ファイル
| ファイル | 中身 |
|---|---|
| `index.html` / `style.css` | 画面 |
| `app.js` | 画面の組み立て・操作・同期 |
| `logic.js` | ルール（純粋関数。Node でテスト可能） |
| `odai.js` | ババ酒のお題52枚（2人用文面つき）と罰ゲーム候補 |
| `kioku.js` / `kioku-data.js` | 記憶のルールとお題108枚＋泥酔カード12枚 |
| `cpus.js` | CPUキャラ6人 |
| `img/` | 生成画像（webp） |
| `drink.js` | 飲む演出の判定（ひとり／みんな／お水。純粋関数） |
| `fx.js` | 飲む演出の画面・効果音（Web Audio で合成）・振動 |
| `net.js` | MQTT 通信 |
| `vendor/` | mqtt.js・qrcode-generator（どちらもMIT） |

## テスト
```
npm i
node --test test/logic.test.mjs          # ルール（ランダム1000ゲーム含む）
python3 -m http.server 8765 &            # 別ターミナル
node test/e2e.mjs http://localhost:8765/   # 複数台で通し（ババ酒3人＋CPU、記憶2人＋泥酔）
node test/smoke.mjs http://localhost:8765/ # 1台モードで全画面を撮影
node test/toast.mjs http://localhost:8765/ # 貯金があるときの「全員で乾杯」
node test/drink.mjs http://localhost:8765/ # 飲む演出（グラスひとつ／ふたつ・特大演出・効果音オフ）
node test/drink-timing.mjs http://localhost:8765/ # ポーズ勝負：確定前は出さない・飲んだ／セーフ・2端末同期・再読込・3画面サイズ
node test/fx-preview.mjs http://localhost:8765/ [--mega] # 飲む演出のコマ送り＋音つきプレビュー動画（ffmpeg。--mega は特大演出）
node test/fit.mjs http://localhost:8765/   # 記憶のカード画面が全カード・5画面サイズでスクロールなしに収まるか
node test/heart.mjs http://localhost:8765/ # ババ酒の♥（乾杯タイム）カードの表示
```
