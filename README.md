# えひめウォーククエスト

> 歩く楽しさが、健康と愛媛の未来をつくる。

AI × 健康増進 × 観光活性化 × ゲーミフィケーションのウォーキングアプリです。「えひめAI地域課題解決コンテスト」に向けて開発しています。

歩数でポイントを貯めてキャラクターを着せ替え、AI が提案する散策クエストで愛媛県内の観光スポットを訪れると、地域限定アイテムがもらえます。

## 現在の状態

フェーズ1（MVP）を開発中です。ホーム・歩数ポイント・ガチャ・着せ替え・データ保存が動きます。AWS には未接続で、ブラウザ内のモック API とデモ歩数データで動きます。進み具合は [tasks.md](.kiro/specs/ehime-walk-quest/tasks.md) を参照してください。

## ドキュメント

- [要件定義書](.kiro/specs/ehime-walk-quest/requirements.md)
- [設計書](.kiro/specs/ehime-walk-quest/design.md)
- [実装タスク](.kiro/specs/ehime-walk-quest/tasks.md)
- [根拠資料の記録](docs/evidence.md)

## 開発環境で動かす

Node.js 22.22 以上が必要です。

```powershell
cd frontend
npm install
npm run dev
```

表示された URL（通常は http://localhost:5173 ）をブラウザで開きます。スマートフォン表示を確認するときは、開発者ツールの端末表示を使ってください。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを起動 |
| `npm run build` | 型チェックと本番ビルド |
| `npm run lint` | oxlint による静的解析 |
| `npm test` | Vitest による単体テスト（コイン・ガチャ・着せ替え・デモ操作・保存データ） |

### フェーズ1で動く機能

画面上の通貨は「コイン」と表示します（仕様書・コード内の「ポイント（pt）」と同じものです）。

- ホーム：左右スワイプ（または下部のインジケーター）で 2 ページを切り替え
  - 1 ページ目：キャラクター、今日の歩数と目標・達成率、所持コイン、ガチャ・着せ替えへの移動
  - 2 ページ目：おすすめクエストと進行状況、週間・月間歩数、歩数グラフ、推定距離・カロリー
- ヘッダー：すべての画面に所持コインを表示（獲得・消費・変換のたびにすぐ更新）
- 歩数コイン：100 歩 = 1 コイン（1 日 100 コインまで）。同じ歩数を何度同期しても二重に付与しない
- ガチャ（`/gacha`）：1 回 50 コイン。排出確率 N60% / R30% / SR9% / SSR1%。持っているアイテムが出たら、レア度に応じたコイン（N 5・R 15・SR 30・SSR 50、仮設定）に変換。変換額は `src/data/items.ts` の `GACHA_DUPLICATE_COINS` で変更する
- 着せ替え（`/gacha/wardrobe`）：場所（頭・上の服など）ごとに所持アイテムを装備・解除。ホームとマイページに反映

### デモ操作（開発モードのみ）

`npm run dev` で起動したときだけ、ホーム 1 ページ目に「デモ操作」カードが出ます。`npm run build` の本番ビルドでは表示されず、API からも操作できません。

- コインを追加：+100 / +500 / +1,000（歩数は増えない）
- 今日の歩数を追加：+100 / +1,000 / +5,000 歩。通常の規則（100 歩 = 1 コイン、1 日 100 コインまで、二重付与なし）でコインを付与。追加した歩数は実際の歩数と分けて記録し、画面に「うちデモ操作で追加」と表示
- 操作の履歴は保存され、再読み込み後も残る（「最近のデモ操作」）

### AI 散策クエスト（backend）

冒険画面の「AIクエスト」タブは、`backend/`（Node.js）の API を通して Amazon Bedrock を呼びます。ブラウザからは Bedrock を直接呼ばず、API キーは backend だけが持ちます。

```powershell
# 1つ目のターミナル：AI サーバー（http://127.0.0.1:8787）
cd backend
npm install
copy .env.example .env   # 初回だけ。既定は AI_PROVIDER=mock（Bedrock を呼ばない）
npm run dev

# 2つ目のターミナル：画面（/api を AI サーバーへ中継する）
cd frontend
npm run dev
```

- Bedrock に接続するときは、`backend/.env` の `AI_PROVIDER=bedrock` と `AWS_BEARER_TOKEN_BEDROCK` を設定する。`frontend` の `.env` や `VITE_` で始まる変数には絶対に書かない
- モデルは `BEDROCK_MODEL_ID`（`jp.amazon.nova-2-lite-v1:0` / `jp.anthropic.claude-haiku-5-5`）で切り替える
- 利用制限：1 人 1 日 10 回（日本時間で日付が変わると戻る）、アプリ全体の 1 日の上限、同時実行数、タイムアウト、`maxTokens`、同じ条件の結果は 10 分キャッシュ
- ローカル開発では利用者を接続元（このPC）で数えるため、全員で 10 回を共有する。公開運用には、ログイン（Cognito）と共有ストレージでの回数管理が必須
- backend がない公開版（GitHub Pages など）では、従来のブラウザ内モックの画面を出す
- テスト：`cd backend` → `npm test`（Bedrock には接続せず、偽の応答で確かめる）

### モックについて

- データはブラウザの localStorage（キー `ewq.mock.v1`）に保存されます。消すと初期状態に戻ります。
- 保存データが壊れていても起動します。壊れた項目は初期値に戻し、JSON として読めないデータは `ewq.mock.v1.broken` に退避してから作り直します。
- localStorage が使えないブラウザでは、画面上部に「保存できません」と表示し、メモリ上で動きます。
- URL に `?mockError` を付けると、通信エラー時の表示を確認できます（例：`http://localhost:5173/?mockError`）。
- 歩数はデモデータです（日付とユーザー ID から決まる疑似乱数。今日の分は時刻とともに増えます）。正式なランキングには反映されません。初回起動時は直近 7 日分のデモ歩数がコインになります。
- 実際の歩数（HealthKit / Health Connect）に切り替えるときは、`src/api/stepProviders/types.ts` の `StepDataProvider` を実装したクラスを `MockGameApi` の `provider` に渡します。

## フォルダ構成

```
.kiro/specs/ehime-walk-quest/  要件・設計・タスク
docs/                          根拠資料
frontend/                      React + TypeScript + Vite + Tailwind CSS
  src/api/                     API インターフェースとモック実装（歩数の取得元は stepProviders/ に分離）
  src/domain/                  ゲーム規則（ポイント・日付・推定値）
  src/data/                    スポット・アイテムのマスタ
  src/features/                キャラクター・歩数・クエストの部品
  src/pages/                   画面
```

## セキュリティ

AWS の認証情報や秘密鍵はコミットしないでください。フロントエンドの設定は `frontend/.env.example` を参考に `.env` を作成します（`.env` は Git の管理対象外です）。
