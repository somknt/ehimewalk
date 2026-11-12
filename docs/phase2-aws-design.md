# Phase 2 AWS 連携 設計・準備書（Step 1）

- 状態：**提案（承認待ち）**。この文書の内容で AWS リソースを作成したり、既存コードを変更したりはしていない
- 作成日：2026-11-12／作業ブランチ：`feature/phase2-aws`（`sugiyama1` の `ae8fed2` から作成）
- 前提：AWS アカウントは学校が用意し、認証情報は後日配布される。**リージョン・使えるサービス・IAM 権限は学校の指定を優先する**
- 既存の設計：[design.md](../.kiro/specs/ehime-walk-quest/design.md) 2 章・6 章・7 章、[requirements.md](../.kiro/specs/ehime-walk-quest/requirements.md) 3.3〜3.4。この文書はそれを Phase 1 の実装に合わせて具体化したもの

---

## 1. 方針

1. **Phase 1 のゲームを壊さない。** 画面は `GameApi` インターフェース越しにデータを扱っている。AWS 用の実装（`HttpGameApi`）を追加するだけで、画面のコードは原則変えない。`VITE_API_MODE=mock`（既定）なら今までどおり localStorage で動く
2. **AWS に接続しなくても全部試せる。** Lambda の処理は「普通の関数 + データ保存の差し替え口」として書き、ローカルではメモリまたは DynamoDB Local で動かす。認証もローカル用の仮トークンで試せるようにする
3. **サーバーが唯一の正しい値を持つ。** コイン残高・所持アイテム・ガチャ結果はサーバーで計算する。クライアントが送る残高や歩数をそのまま信用しない
4. **デモと本番を混ぜない。** 開発用（`dev`）と本番用（`prod`）でユーザープール・テーブルを丸ごと分ける。デモ操作の API は `dev` にしか作らない
5. **AWS 固有の値は設定で切り替える。** リージョン・テーブル名・ユーザープール ID・API の URL は環境変数で渡し、ソースコードに書かない

## 2. 推奨技術構成

```mermaid
flowchart LR
  subgraph Client[ブラウザ（React）]
    UI[画面] --> GA[GameApi]
    GA -->|VITE_API_MODE=mock| Mock[MockGameApi<br/>localStorage（Phase 1 のまま）]
    GA -->|local / aws| Http[HttpGameApi]
    Auth[認証（Cognito）] --> Http
  end
  Http -->|HTTPS + JWT| APIGW[API Gateway HTTP API<br/>JWT オーソライザー・スロットリング]
  APIGW --> L[Lambda（Node.js / TypeScript）]
  L --> DDB[(DynamoDB<br/>ewq-{stage}-main)]
  L -.Step 6.-> Bedrock[Amazon Bedrock]
  Auth --> Cognito[Cognito ユーザープール]
  APIGW -->|JWT 検証| Cognito
  CW[CloudWatch Logs / Budgets] -.-> L
```

| 区分 | 採用 | 理由 |
|---|---|---|
| 認証 | Amazon Cognito ユーザープール（メール + パスワード） | API Gateway の JWT オーソライザーでそのまま検証できる。少人数なら無料枠内（7 章） |
| API | API Gateway **HTTP API** | REST API より安く（[料金](https://aws.amazon.com/api-gateway/pricing/)）、JWT 認可とルート単位のスロットリングを持つ |
| 処理 | AWS Lambda（Node.js 22 以上、TypeScript） | 既存の TypeScript のゲーム規則（`domain/`）を共有できる |
| DB | DynamoDB（オンデマンド） | 条件付き書き込みとトランザクションで二重付与・二重消費を防げる。使わない時間の費用がほぼ 0 |
| IaC | AWS CDK（TypeScript）を第一候補。学校の権限で CloudFormation が使えなければ SAM または手動 | 環境（dev / prod）を同じ定義から作れる |
| 監視・費用 | CloudWatch Logs（保存期間 14 日）、AWS Budgets | ログの溜めすぎを防ぎ、予算超過を通知する |
| AI（Step 6） | Amazon Bedrock（Lambda からのみ呼ぶ） | 秘密情報をブラウザに置かない。利用可否は学校の環境で確認 |
| 配信 | 未決定（GitHub Pages、または S3 + CloudFront） | 共同開発者の `origin/shiomi` に GitHub Pages の自動公開がある。チームで決める（9 章） |

**使わないもの**：VPC・NAT ゲートウェイ（月額の固定費がかかるため）、Secrets Manager（Step 6 まで秘密情報がない。必要になれば SSM パラメータストアの標準パラメータを先に検討）、API キー方式の認証（ブラウザに置くと漏れる）。

### 2.1 リポジトリ構成（追加予定）

```
shared/      ゲーム規則（frontend/src/domain/ と、アイテムの「規則部分」）を移し、フロントと Lambda で共有
backend/
  src/handlers/    API ごとの Lambda 関数（薄い入口。検証して services を呼ぶ）
  src/services/    ゲーム処理（歩数同期・ガチャ・着せ替え）。保存先に依存しない
  src/repository/  保存先の差し替え口：memory（テスト）/ dynamodb（DynamoDB Local・AWS）
  src/local/       ローカル開発用の HTTP サーバー（AWS なしで API を動かす）
  test/            単体・結合テスト
infra/       CDK（dev / prod のスタック定義）。認証情報が届くまでは cdk synth（テンプレート生成）まで
```

## 3. 既存の React アプリとの接続

| 項目 | 変更内容 | 既存機能への影響 |
|---|---|---|
| `api/index.ts` | `VITE_API_MODE` を `mock` / `local` / `aws` の 3 つにする | `mock`（既定）は今と同じ |
| `api/httpApi.ts`（新規） | `GameApi` を実装し、各メソッドを API 呼び出しに置き換える。`demo` は `aws` の `prod` では必ず `null` | 画面はそのまま使える |
| 残高の通知 | `HttpGameApi` も、残高が変わる API の応答（同期・ガチャ・デモ操作）のたびに `onBalanceChange` を呼ぶ | ヘッダーのコイン表示はそのまま動く |
| 認証 | ログイン・登録・ログアウト画面と、トークンを持つ `AuthProvider` を追加。トークンは `Authorization: Bearer` で送る | ログインしていない人は、今の `MockGameApi`（ゲスト・端末内保存）で遊べる |
| 再送対策 | 状態を変える POST には `Idempotency-Key`（UUID）を付ける。通信が切れて再送しても同じキーを使う | 画面側の変更は `HttpGameApi` の中だけ |
| エラー | HTTP の 401 → 再ログイン、409 → 競合（読み直し）、429 → 時間をおいて再試行、5xx → 既存の「もう一度読み込む」表示 | 既存の `ApiError` に `code` を追加済み（Phase 1）なので流用できる |

**ログイン状態による切り替え**：今は `api` がアプリ起動時に 1 つだけ作られ、残高ストア（`balanceStore`）もそれに結び付いている。ログイン・ログアウトで `MockGameApi` と `HttpGameApi` を切り替えるため、「現在の API を差し替えられる入れ物」に変える小さな改修が必要（Step 2 で実施）。

**ライブラリ**：Cognito の操作には AWS Amplify の認証モジュール（`aws-amplify/auth`）を第一候補にする。登録・確認コード・ログイン・トークン更新を自前で書かずに済む。容量が気になる場合は `amazon-cognito-identity-js` を検討する。どちらも追加時に承認をもらう。

## 4. データベース設計

### 4.1 テーブル

| テーブル | 用途 |
|---|---|
| `ewq-{stage}-main` | ユーザーデータ（1 テーブル設計。PK / SK） |
| （当面なし）マスタ | アイテム・排出確率・変換コインは `shared/` のコードに持ち、Lambda に同梱する。管理画面で変えたくなったら `ewq-{stage}-master` に移す |

`{stage}` は `dev` / `prod`。テーブル・ユーザープール・API を環境ごとに完全に分ける。

### 4.2 `ewq-{stage}-main` の項目

| データ | PK | SK | 主な属性 | 使い方 |
|---|---|---|---|---|
| プロフィール | `USER#{sub}` | `PROFILE` | username, friendCode, dailyGoal, title, createdAt | 取得・更新 |
| キャラクター | `USER#{sub}` | `CHARACTER` | name, appearance, equipped, version | 着せ替え（version で同時更新を検出） |
| コイン残高 | `USER#{sub}` | `BALANCE` | balance, updatedAt | 原子的な加減算。条件 `balance >= :cost` で消費 |
| 所持アイテム | `USER#{sub}` | `ITEM#{itemId}` | acquiredAt, via（gacha / starter / import） | 一覧は `begins_with(SK, 'ITEM#')`。重複は `attribute_not_exists` で防ぐ |
| 歩数 | `USER#{sub}` | `STEP#{yyyy-mm-dd}` | steps, demoAddedSteps, source, syncedAt, verification | 期間は `between` |
| 歩数コイン付与 | `USER#{sub}` | `AWARD#{yyyy-mm-dd}` | awardedPoints | 条件付き更新で二重付与を防ぐ |
| コイン取引 | `USER#{sub}` | `TX#{ISO日時}#{id}` | amount, reason, refKey | 履歴（新しい順） |
| ガチャ履歴 | `USER#{sub}` | `GACHA#{ISO日時}#{drawId}` | itemId, rarity, isDuplicate, cost, refund | 履歴・問い合わせ対応 |
| 再送対策 | `USER#{sub}` | `IDEMP#{key}` | response, ttl（24 時間） | 同じキーの再送には保存した結果を返す |
| 週間歩数 | `USER#{sub}` | `WEEK#{週の月曜}` | steps, GSI1PK, GSI1SK | ランキング（Step 5） |
| 移行記録 | `USER#{sub}` | `IMPORT` | importedAt, summary | ローカルデータの取り込みは 1 回だけ |
| 呼び出し回数 | `USER#{sub}` | `QUOTA#{種類}#{期間}` | count, ttl | 同期は 1 分 1 回、AI は 1 日 10 回など |

- GSI1（週間ランキング）：`GSI1PK = RANK#{週}#{scope}`、`GSI1SK = 歩数を 0 埋め 9 桁`。降順で上位を取る（既存設計 6.2 のとおり）
- TTL 属性 `ttl` を有効にし、再送対策と回数制限の項目を自動で消す

### 4.3 整合性の守り方（トランザクション）

**ガチャ（`POST /gacha/normal/draw`）**：サーバーで抽選し、次をすべて 1 つの `TransactWriteItems` で書く。どれか 1 つでも条件に合わなければ全部取り消される。

1. `BALANCE`：`balance = balance - 50 + 変換コイン`（条件 `balance >= 50`）
2. 新規なら `ITEM#{itemId}` を追加（条件 `attribute_not_exists`）／重複なら `ITEM#{itemId}` の存在を確認（`ConditionCheck`）
3. `GACHA#...` と `TX#...`（消費と変換）を追加
4. `IDEMP#{key}` を追加（条件 `attribute_not_exists`）。ここで失敗したら同じキーの再送なので、保存済みの結果を返す

同時に 2 回引かれて「新規」の判定がずれた場合は、2 の条件で失敗するので、読み直して抽選からやり直す（最大 3 回）。

**歩数の同期（`POST /steps/sync`）**：日ごとに、`AWARD#{日付}` の付与済み値を条件（`awardedPoints = :前回値`、初回は `attribute_not_exists`）にして、付与済み値の更新・残高の加算・取引の追加・歩数の保存を 1 つのトランザクションにする。Phase 1 の「差分だけ付与」の規則（`domain/points.ts`）をそのまま使う。

### 4.4 歩数の扱い（Phase 2 の現実的な範囲）

- Phase 2 では実際の歩数（HealthKit / Health Connect）はまだない（Phase 4）
- **`dev` 環境のデモ歩数はサーバーが作る。** Phase 1 の `DemoStepProvider` を `shared/` に移し、ユーザー ID から決まる歩数を Lambda が生成する。クライアントは「同期して」と頼むだけで歩数を送らないので、歩数の水増しを申告できない
- **`prod` 環境ではデモ歩数にコインを付与しない**（既存設計 5.1）。そのため実歩数連携（Phase 4）までは `prod` では歩数コインが増えない。コンテストのデモをどちらの環境で行うかは決める必要がある（9 章）
- Phase 4 でクライアントが歩数を送るようになったら、既存設計 9 章の検証（未来日・7 日より前の拒否、1 日の上限、増加速度、同期頻度）を加える

## 5. API 設計

すべて `Authorization: Bearer <Cognito の ID トークン>`。ユーザー ID はトークンの `sub` から取り、リクエスト本文の値は使わない。状態を変える POST / PUT は `Idempotency-Key` ヘッダーを必須にする。

| メソッド | パス | 内容 | 対応する GameApi |
|---|---|---|---|
| POST | `/me/init` | 初回ログイン時にプロフィール・キャラクター・初期衣装・残高 0 を作る（作成済みなら何もしない） | （ログイン直後に内部で呼ぶ） |
| GET | `/me` | プロフィール・キャラクター・残高 | `getProfile` / `getCharacter` / `getPointBalance` |
| PUT | `/me/character/equipment` | `{ slot, itemId \| null }`。所持チェック・スロットの一致をサーバーで確認 | `equipItem` |
| POST | `/steps/sync` | 歩数を同期し、差分のコインを付与 | `syncSteps` |
| GET | `/steps?from&to` | 歩数記録（最大 62 日） | `getStepRecords` |
| GET | `/inventory` | 所持アイテム | `getInventory` |
| POST | `/gacha/normal/draw` | ガチャ 1 回 | `drawGacha` |
| GET | `/gacha/history?limit` | ガチャ履歴 | （新規・画面は任意） |
| GET | `/coins/transactions?limit` | コインの増減履歴 | （新規・画面は任意） |
| POST | `/me/import` | ローカルデータの取り込み（6 章の方式が決まってから） | （新規） |
| GET | `/quests/recommended` | おすすめクエスト（Step 6 まではモックと同じ規則） | `getRecommendedQuest` |
| GET | `/rankings/{scope}?week` | 週間ランキング（Step 5） | （新規） |
| POST | `/dev/coins`、`/dev/steps` | デモ操作（**`dev` 環境にだけ作る**。`prod` にはルート自体がない） | `demo.addCoins` / `demo.addSteps` |

**応答の形**：成功は JSON 本体。失敗は `{ "error": { "code": "insufficient_points", "message": "コインが足りません…" } }`。`message` は画面にそのまま出せる日本語にする（Phase 1 の `ApiError.userMessage` と同じ考え方）。

| HTTP | code の例 | 画面の扱い |
|---|---|---|
| 400 | invalid_input | 入力の誤り（通常は起きない） |
| 401 | unauthorized | 再ログインを促す |
| 409 | insufficient_points / item_not_owned / conflict | 理由を表示（ガチャ・着せ替え） |
| 429 | rate_limited | 時間をおいて再試行 |
| 5xx | server_error | 既存の「もう一度読み込む」 |

**入力検証**：zod などのスキーマで全項目を確認する。スロット名・アイテム ID はマスタと照合する。

**呼び出し制限**：API Gateway のステージ全体で秒間の上限を設定する。加えて、`/steps/sync` は 1 人 1 分 1 回、`/gacha/normal/draw` は 1 人 1 秒 1 回、AI は 1 人 1 日 10 回（仮）を DynamoDB の `QUOTA#` で数える。

## 6. 既存データ（localStorage）の扱い（提案）

**前提**：localStorage のデータは端末で自由に書き換えられ、Phase 1 のデモ操作で増やしたコインも含まれる。そのまま信用してクラウドに入れると、`prod` のゲームバランスが崩れる。

| 方式 | 内容 | 長所 | 短所 |
|---|---|---|---|
| A. 移行しない | ログインしたらクラウドの新しいデータで始める。端末のデータは消さずにゲスト用として残す | 安全・簡単 | それまでの進行が引き継がれない |
| B. 見た目だけ移行 | 所持アイテム（マスタに存在するガチャ・初期衣装のみ）と装備を 1 回だけ取り込む。コインと歩数は取り込まない | 集めた衣装は残る。コインの水増しは防げる | 書き換えた所持品が入る可能性はある |
| C. 全部移行 | コイン・アイテム・装備・歩数を取り込む | 体験が途切れない | 書き換え・デモコインがそのまま入る |

**推奨**：`dev` では C（試験用なので自由に）、`prod` では **A**。Phase 1 は試作段階で、本番利用者のデータはまだないため。どうしても引き継ぎたい場合は B にとどめる。

| 検討項目 | 方針 |
|---|---|
| 新規ユーザーの初期データ | `POST /me/init` で初期衣装 4 点を所持・装備、コイン 0、目標 6,000 歩（Phase 1 と同じ） |
| ログイン前の利用 | 今の `MockGameApi`（ゲスト・端末内保存）でそのまま遊べる。画面に「ゲスト（この端末のみ）」と表示 |
| ログイン後の同期 | クラウドが正。画面はクラウドのデータを表示する。端末のデータはログアウト後のゲスト用として残す（削除しない） |
| 同期失敗時 | 書き込み操作は送信できるまで反映しない（オフラインで仮に進めない）。エラー表示と再試行。再試行は同じ `Idempotency-Key` で送り、二重処理を防ぐ |
| 複数端末の競合 | 残高・所持品・ガチャはサーバーの原子的な操作なので競合しない。装備は後勝ち（`version` を見て、他の端末で変わっていたら最新を読み直して表示） |
| デモと本番の分離 | `dev` / `prod` でユーザープール・テーブル・API を分ける。デモ操作の API は `dev` にしかない。`prod` のアカウントは `dev` に存在しないので、デモ操作で本番のコインは増やせない |

## 7. AWS 利用料金の目安

**想定規模**：利用者 100 人、1 人 1 日 50 回の API 呼び出し（同期・画面表示・ガチャなど）→ 月約 15 万回。

| サービス | 料金の考え方 | 想定規模での目安 |
|---|---|---|
| API Gateway（HTTP API） | 100 万リクエストあたり約 1 ドル（[公式](https://aws.amazon.com/api-gateway/pricing/)、リージョンで少し違う） | 1 ドル未満 |
| Lambda | 月 100 万リクエストと 40 万 GB 秒は常に無料（[公式](https://aws.amazon.com/lambda/pricing/)） | 無料枠内の見込み |
| DynamoDB（オンデマンド） | 読み書きの回数とデータ量で課金。トランザクションの書き込みは通常の 2 倍で数える。常時無料枠（25GB など）は**プロビジョンドモードが対象で、オンデマンドは最初の 1 回から課金**される（[解説](https://www.usage.ai/blogs/aws/reserved-instances/dynamodb/free-tier/)） | 数十円〜1 ドル程度 |
| Cognito | 料金プラン（Lite / Essentials / Plus）ごとに月間アクティブユーザー数で課金。新しいユーザープールの既定は Essentials で、無料で使える人数の枠がある（[機能プラン](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html)） | 100 人なら無料枠内の見込み（**作成時に公式の料金表で再確認**） |
| CloudWatch Logs | 取り込み量と保存量で課金 | 保存期間を 14 日にすれば少額 |
| AWS Budgets | 少数の予算は無料（要確認） | 0 円の見込み |
| Bedrock（Step 6） | モデルごとの入出力トークン数で課金 | 1 人 1 日 10 回の上限で、低価格モデルなら月数ドル程度。**モデルが決まってから試算** |

**合計の目安**：Bedrock を除いて月 1〜数ドル程度。

**注意点**：

- 学校のアカウントは組織で管理されている可能性があり、無料枠が適用されない・請求画面が見られない場合がある。**学校に確認する**
- 費用が急に増える主な原因：ループで API を呼ぶ不具合、ログの出しすぎ、VPC の NAT ゲートウェイ、Bedrock の呼びすぎ。回数制限とログの保存期間で防ぐ
- **AWS Budgets**：月の予算（例：10 ドル。学校の指定に従う）を作り、50% / 80% / 100% でメール通知する
- 料金は変わるため、リソースを作る前に AWS の料金ページで再確認する

## 8. セキュリティ

| 項目 | 対策 |
|---|---|
| 認証情報 | ソースコード・GitHub・`.env` に書かない。配布された認証情報は端末の `~/.aws/credentials` に**名前付きプロファイル**（例：`ewq-school`）で保存し、`AWS_PROFILE` で指定する。可能なら長期のアクセスキーより、学校の SSO（一時的な認証情報）を使う |
| フロントに置く値 | API の URL、ユーザープール ID、アプリクライアント ID だけ（公開してよい値）。クライアントシークレットは作らない |
| IAM | Lambda ごとに最小権限（自分のテーブルの必要な操作だけ、Step 6 では特定モデルの `InvokeModel` だけ）。開発者用の権限は学校の指定に従う |
| 不正なリクエスト | ユーザー ID はトークンから取る。入力をスキーマで検証。残高・抽選・付与はサーバーで計算。`Idempotency-Key` と条件付き書き込みで再送・連打による二重処理を防ぐ |
| 通信 | CORS は配信元のドメインだけ許可。API Gateway で秒間の上限を設定 |
| 個人情報 | メールアドレスは Cognito にだけ保存し、テーブルやログに出さない。プライバシーポリシーの用意が必要 |
| ローカル開発 | ローカルモードではダミーの認証情報と `http://localhost:8000` を明示し、誤って本物の AWS に接続しないようにする |

## 9. ローカル開発・テストの仕組み（認証情報が届くまで）

| レベル | 方法 | 必要なもの | 確認できること |
|---|---|---|---|
| 1. 単体テスト | services をメモリの保存先で動かす（Vitest） | なし | ガチャの整合性、二重付与、再送、所持チェック |
| 2. ローカル API | `backend/src/local` の Node.js HTTP サーバーが Lambda ハンドラーを直接呼ぶ。フロントは `VITE_API_MODE=local` で接続 | なし | 画面からの一連の操作、エラー表示 |
| 3. DynamoDB の結合テスト | DynamoDB Local（JAR 版。Java 17 以上で動く。この PC には Java 24 がある）で本物と同じ条件付き書き込み・トランザクションを試す | Java（Docker は不要） | 条件式・トランザクションの正しさ |
| 4. 認証 | ローカルでは開発用トークン（固定の秘密鍵で署名した JWT）を受け付ける。**`local` モードだけ有効**で、AWS 版には入れない | なし | 401 の扱い、ユーザーの分離 |
| 5. IaC | `cdk synth` でテンプレートを作るだけ（デプロイしない） | Node.js | 定義の誤り |

この PC には Docker・AWS CLI・SAM・CDK が入っていない（2026-11-12 確認）。上の方法は Docker なしで動くように選んだ。

## 10. 開発ステップと実装順序（提案）

既存の tasks.md 2.0〜2.9 を、今回の Step 1〜7 と「認証情報なしでできる順」に並べ直したもの。**tasks.md への反映は承認後に行う。**

| 順 | 内容 | Step | AWS 接続 | 完了条件 |
|---|---|---|---|---|
| P2-0 | この設計の承認、学校への確認（9 章の決定事項） | 1 | 不要 | 決定事項がそろう |
| P2-1 | `shared/` を作り、`domain/` と「アイテムの規則部分」を移す（見た目のドット絵は frontend に残す） | 3 | 不要 | フロントの全テスト・ビルドが今までどおり通る |
| P2-2 | `backend/` の骨組み、保存先インターフェース、メモリ実装、ローカル API サーバー | 4 | 不要 | `GET /me` がローカルで返る |
| P2-3 | ゲーム処理：初期化・歩数同期・ガチャ・所持品・着せ替え（再送対策つき） | 3・5 | 不要 | 単体テストで二重付与・二重消費・再送が起きない |
| P2-4 | DynamoDB 実装と DynamoDB Local の結合テスト | 3 | 不要 | トランザクション・条件式のテストが通る |
| P2-5 | `HttpGameApi` と `VITE_API_MODE=local`。Phase 1 の画面をローカル API で動かす | 4・5 | 不要 | Phase 1 のブラウザ確認項目がローカル API でも合格 |
| P2-6 | 認証の画面（登録・確認コード・ログイン・ログアウト）、ゲストとの切り替え（ローカルの開発用トークン） | 2 | 不要 | ログイン前はゲスト、ログイン後はローカル API で遊べる |
| P2-7 | CDK で dev / prod の定義（`cdk synth` まで）、Budgets の定義 | 1 | 不要 | テンプレートが生成できる |
| P2-8 | **認証情報が届いてから**：学校の指定どおり `dev` をデプロイ、Budgets 設定、動作確認 | 2〜4 | **必要（承認後）** | dev 環境で一連の操作ができる |
| P2-9 | ランキング（週間歩数・GSI・週次締め） | 5 | ローカル→承認後に AWS | 2 人以上でランキングが出る |
| P2-10 | AI 散策クエスト（Bedrock。回数制限・キャッシュ・保存） | 6 | 学校の環境で利用可否を確認後 | モックと切り替えられる |
| P2-11 | ローカルデータの取り込み（6 章で決めた方式） | 3 | ローカル→承認後に AWS | 1 回だけ取り込める |
| P2-12 | テスト（認証・API・保存・ガチャの整合性・不正なリクエスト・Phase 1 の回帰） | 7 | 両方 | 全テスト合格、結果を記録 |

各ステップの後に確認をもらってから次へ進む。

## 11. 既存機能への影響とリスク

| リスク | 内容 | 対策 |
|---|---|---|
| アイテムのデータが画面の部品と結び付いている | `data/items.ts` がドット絵（`PixelLayer`）と同じファイルにあり、そのままでは Lambda で使えない | P2-1 で「ID・名前・カテゴリー・レア度・入手方法」と「見た目」を分ける。テストで確認 |
| モック API が画面の部品を参照している | `mockApi.ts` が保存データの検証に `features/character/sprites`（髪型などの一覧）を使っている | 外見の選択肢を `shared/` に移す |
| API の切り替え | `api` と `balanceStore` が起動時に固定されている | P2-6 で差し替えられる入れ物にする。`mock` の動きは変えない |
| 用語 | 画面は「コイン」、仕様書・コード・API は「ポイント」 | API 名は今のまま（`points`）にするか、チームで決める |
| 共同開発者のブランチ | `origin/shiomi` が同じファイル（API・画面）を変えている | Phase 2 の改修範囲が広がる前に統合方針を決める |
| prod で歩数コインが増えない | Phase 4 まで実歩数がない | コンテストのデモ環境を決める（下記） |
| 学校の環境の制約 | Cognito・CloudFormation・Bedrock などが使えない可能性 | 確認結果で構成を差し替える（IaC は SAM / 手動、AI はモック継続） |
| 料金 | 不具合による呼び出しの急増 | 回数制限、ログ保存期間、Budgets の通知 |

**Phase 1 の機能は `VITE_API_MODE=mock`（既定）で今までどおり動く**ことを、各ステップの完了条件に含める。

## 12. 事前に決定・準備が必要な事項

**学校に確認すること**

1. 使うリージョン（第一候補：東京 `ap-northeast-1`）
2. 使えるサービス：Cognito、API Gateway、Lambda、DynamoDB、CloudWatch、Budgets、CloudFormation（CDK）、Bedrock（使えるモデル）
3. 認証情報の形式（SSO か、アクセスキーか）、有効期限、誰が持つか
4. IAM 権限の範囲（ロールの作成ができるか。CDK は IAM ロールを作る）
5. 予算の上限、請求・Budgets の画面を見られるか、無料枠が適用されるか
6. 個人情報（メールアドレス）を扱ってよいか、学校の規程

**チームで決めること**

1. ログイン方式（メール + パスワードでよいか。学校のメールに限定するか）
2. 環境の数（dev と prod の 2 つ／当面は dev だけ）
3. コンテストのデモをどの環境で行うか（dev ならデモ歩数・デモ操作が使える）
4. ローカルデータの移行方式（推奨：dev は C、prod は A）
5. フロントエンドの配信先（GitHub Pages／S3 + CloudFront）
6. 予算額と通知を受け取るメールアドレス
7. 用語（コイン／ポイント）
8. `origin/shiomi` との統合の時期
9. 追加するライブラリ（`aws-amplify`、`zod`、AWS SDK v3、CDK）の承認
