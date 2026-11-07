# NOMIKAI CARDS（飲み会カードゲーム集・非公式）

- 笑うババには酒来たる（お題つきババ抜き）
- 記憶無くしちゃダメですか 第1弾・第2弾（引いて従うだけ）。ロビーで「マイお題」（部屋ごとのオリジナルカード、30枚まで）を足せる
- トークトライアル（全員に秘密のミッション。会話を誘導して達成するか、怪しい人を3択で見破る）
- NGワードゲーム（NEW。自分のNGワードだけ見えない。言ったら一口＆新しいワード。各自のスマホ専用）

各自のスマホで部屋コードを入れて参加。2人モード（自動）、CPU（トークトライアル以外）、ゴリゴリ泥酔モード、1台モードあり。画像は gpt-image-2 で生成（原本は design/raw、リポジトリ外）。

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
| `kioku.js` / `kioku-data.js` | 記憶のルールとお題119枚＋泥酔カード12枚、マイお題 |
| `ng.js` / `ng-data.js` | NGワードゲームのルールと、NGワード60（オリジナル）。トークテーマは talk-data.js を共用 |
| `talk.js` / `talk-data.js` | トークトライアルのルールと、トークテーマ50・ミッション80（オリジナル） |
| `cpus.js` | CPUキャラ6人 |
| `img/` | 生成画像（webp） |
| `games.js` | 飲みゲー（山手線・マジカルバナナ・どすこい・以心伝心…）のお題。引いた瞬間にアプリが決める |
| `drink.js` | 飲む演出の判定（ひとり／みんな／お水。純粋関数） |
| `fx.js` | 飲む演出の画面・効果音（Web Audio で合成）・振動 |
| `net.js` | MQTT 通信 |
| `vendor/` | mqtt.js・qrcode-generator（どちらもMIT） |
| `manifest.webmanifest` / `icons/` | ホーム画面に追加したときの名前・全画面表示・アイコン（PNG。iPhone は webp のアイコンを使えない） |

## テスト
```
npm i
node --test test/*.test.mjs              # ルール（ランダム1000ゲーム含む）・飲む判定・飲みゲーのお題
python3 -m http.server 8765 &            # 別ターミナル
node test/e2e.mjs http://localhost:8765/   # 複数台で通し（ババ酒3人＋CPU、記憶2人＋泥酔）
node test/smoke.mjs http://localhost:8765/ # 1台モードで全画面を撮影
node test/toast.mjs http://localhost:8765/ # 貯金があるときの「全員で乾杯」
node test/drink.mjs http://localhost:8765/ # 飲む演出（グラスひとつ／ふたつ・特大演出・効果音オフ）
node test/drink-timing.mjs http://localhost:8765/ # ポーズ勝負：確定前は出さない・飲んだ／セーフ・2端末同期・再読込・3画面サイズ
node test/fx-preview.mjs http://localhost:8765/ [--mega] # 飲む演出のコマ送り＋音つきプレビュー動画（ffmpeg。--mega は特大演出）
node test/fit.mjs http://localhost:8765/   # 記憶のカード画面が全カード・5画面サイズでスクロールなしに収まるか
node test/heart.mjs http://localhost:8765/ # ババ酒の♥（乾杯タイム）カードの表示
node test/talk-e2e.mjs http://localhost:8765/ # トークトライアル：3台（見破りハズレ・的中・達成・2ラウンド目）と1台モード
node test/custom-e2e.mjs http://localhost:8765/ # マイお題：追加・削除・当てはまり型（貯金）と実行型
node test/tally.mjs http://localhost:8765/ # 通算成績：ババ酒の通算負け数、トークトライアルのテーマ引き直し
node test/stamp.mjs http://localhost:8765/ # トークトライアルのハンコ演出（ハズレ・見破った・達成）と、そのあとの飲む演出
node test/ng-e2e.mjs http://localhost:8765/ # NGワード：3台（自分のワードだけ見えない・同時押しは1回・新ワードは本人に見えない・終了と2ラウンド目）
node test/reconnect.mjs http://localhost:8765/ # 通信が切れた・画面を消していた → 操作を止める → つながり直して追いつく（部屋の状態も巻き戻らない）
node test/roulette.mjs http://localhost:8765/ # ババ酒の罰ゲームルーレット：2台で同じ並び・同じ結果、飲む演出はそのあと
node test/kickmid.mjs http://localhost:8765/ # 途中で帰った人を外す：記憶（番の人なら次へ）・NGワード3台（ワードが消える・外された人は観戦）
node test/joker.mjs http://localhost:8765/ # ババ酒のJOKER演出（ドキッ／ホッ）と、ホーム画面に追加（manifest・PNGアイコン）
```
