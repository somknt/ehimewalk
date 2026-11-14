# 公開版（Vercel）で AI 散策クエストを動かす設定

公開版（https://ehime-walk.vercel.app/）の AI 散策クエストを動かすための、AWS と Vercel の設定手順です。

## しくみ

```
ブラウザ ──> Vercel Functions（/api/ai/quests/...）──> Amazon Bedrock（東京リージョン）
                    │                                 └> DynamoDB（回数の記録）
                    └ Vercel の OIDC トークン ──> AWS STS ──> IAM ロールの一時的な認証情報（15 分）
```

- **API キーはどこにも置きません。** Vercel の関数は、リクエストごとに Vercel が発行する OIDC トークンを AWS に渡し、IAM ロールの一時的な認証情報（15 分で切れる）と交換して Bedrock を呼びます（[Vercel の説明](https://vercel.com/docs/oidc/aws)）。
- IAM ロールを引き受けられるのは、信頼ポリシーで指定した **Vercel のプロジェクト `ehime-walk` の本番（production）だけ**です。プレビューからは引き受けられません。
- IAM ロールにできるのは、**指定した 2 つのモデルを呼ぶことと、回数のテーブルを読み書きすることだけ**です。
- `AWS_BEARER_TOKEN_BEDROCK`（ローカル開発用の API キー）が Vercel に設定されていても、公開版では使いません。
- 回数は、サーバーが発行した匿名の ID（HttpOnly の Cookie）ごとに 1 日 5 回（`AI_QUEST_USER_DAILY_LIMIT`、最大 10）、アプリ全体で 1 日 200 回（`AI_QUEST_GLOBAL_DAILY_LIMIT`）まで数えます。ログインがないため、Cookie を消すと 1 人の 5 回はやり直せます。料金はアプリ全体の上限で抑えます。

## 必要なもの

- Bedrock のモデルを使える AWS アカウントで、IAM・DynamoDB・Budgets を設定できる権限
- Vercel のプロジェクト `ehime-walk` の設定を変えられる権限

以下の `<AWSアカウントID>` は、12 桁の AWS アカウント ID に置き換えてください。Vercel のチーム名（`bsi25016-3922s-projects`）とプロジェクト名（`ehime-walk`）は、2026-11-14 時点の値です。変えたときはポリシーも直してください。

## 1. Vercel：OIDC 連携を確認する

1. Vercel でプロジェクト `ehime-walk` を開き、**Settings → Security** の「Secure backend access with OIDC federation」が有効になっていることを確認する
2. **Issuer Mode** を **Team** にする

## 2. AWS：OIDC の ID プロバイダーを作る

IAM → **ID プロバイダー** → **プロバイダーを追加**

| 項目 | 値 |
| --- | --- |
| プロバイダーのタイプ | OpenID Connect |
| プロバイダーの URL | `https://oidc.vercel.com/bsi25016-3922s-projects` |
| 対象者（Audience） | `https://vercel.com/bsi25016-3922s-projects` |

## 3. AWS：回数のテーブルを作る（DynamoDB）

リージョンは **アジアパシフィック（東京）ap-northeast-1**。

| 項目 | 値 |
| --- | --- |
| テーブル名 | `ehime-walk-ai-quota` |
| パーティションキー | `pk`（文字列） |
| ソートキー | なし |
| キャパシティモード | オンデマンド |

作成後、テーブルの **追加の設定 → Time to Live（TTL）** を有効にし、属性名を `expiresAt` にする（古い記録が数日後に自動で消える）。

## 4. AWS：IAM ロールを作る

IAM → **ロール** → **ロールを作成** → **ウェブアイデンティティ** を選び、手順 2 のプロバイダーを選ぶ。作成後、**信頼関係** を次の内容に置き換える。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWSアカウントID>:oidc-provider/oidc.vercel.com/bsi25016-3922s-projects"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.vercel.com/bsi25016-3922s-projects:aud": "https://vercel.com/bsi25016-3922s-projects",
          "oidc.vercel.com/bsi25016-3922s-projects:sub": "owner:bsi25016-3922s-projects:project:ehime-walk:environment:production"
        }
      }
    }
  ]
}
```

ロール名は `ehime-walk-ai-quest` とし、次のインラインポリシーを付ける（ほかの権限は付けない）。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeAllowedInferenceProfiles",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": [
        "arn:aws:bedrock:ap-northeast-1:<AWSアカウントID>:inference-profile/jp.amazon.nova-2-lite-v1:0",
        "arn:aws:bedrock:ap-northeast-1:<AWSアカウントID>:inference-profile/jp.anthropic.claude-haiku-5-5"
      ]
    },
    {
      "Sid": "InvokeModelsOnlyThroughThoseProfiles",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:ap-northeast-*::foundation-model/*",
      "Condition": {
        "StringEquals": {
          "bedrock:InferenceProfileArn": [
            "arn:aws:bedrock:ap-northeast-1:<AWSアカウントID>:inference-profile/jp.amazon.nova-2-lite-v1:0",
            "arn:aws:bedrock:ap-northeast-1:<AWSアカウントID>:inference-profile/jp.anthropic.claude-haiku-5-5"
          ]
        }
      }
    },
    {
      "Sid": "QuotaTable",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:ap-northeast-1:<AWSアカウントID>:table/ehime-walk-ai-quota"
    }
  ]
}
```

- `jp.` で始まるモデル ID は、日本国内の東京・大阪リージョンに振り分ける推論プロファイルです。プロファイルと、振り分け先のモデルの両方に許可が必要です（[AWS の説明](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference-prereq.html)）。2 つ目の許可は、条件によって上の 2 つのプロファイルを通したときだけ有効です。
- 作成したロールの **ARN**（`arn:aws:iam::<AWSアカウントID>:role/ehime-walk-ai-quest`）を控える。

## 5. AWS：料金のアラートを作る（おすすめ）

AWS Budgets で月の予算（例：3 USD）を作り、実際の金額が 80% を超えたらメールで知らせる設定にする。アプリの上限（1 日 200 回）を使い切っても 1 日 30 円台の見込みなので、通知が来たら想定外の使われ方を疑う。

## 6. Vercel：環境変数を設定する

プロジェクト `ehime-walk` → **Settings → Environment Variables**。**Environment は Production だけ**にする。秘密の値はありません（ロールの ARN は秘密情報ではない）。

| 名前 | 値 |
| --- | --- |
| `AI_PROVIDER` | `bedrock` |
| `AWS_ROLE_ARN` | 手順 4 のロールの ARN |
| `AI_QUEST_QUOTA_TABLE` | `ehime-walk-ai-quota` |
| `ALLOWED_ORIGIN` | `https://ehime-walk.vercel.app` |
| `BEDROCK_MODEL_ID`（任意） | 既定は `jp.amazon.nova-2-lite-v1:0` |
| `AI_QUEST_GLOBAL_DAILY_LIMIT`（任意） | 既定は `200` |

- **`AWS_BEARER_TOKEN_BEDROCK` は設定しない。** すでにあれば削除する。
- 任意：**Settings → Functions → Function Region** を **Tokyo（hnd1）** にすると、Bedrock までの通信が短くなる。

環境変数は次のデプロイから効きます。`main` へのマージで自動で再デプロイされます（すでにマージ済みなら、Deployments から最新の本番を **Redeploy**）。

## 7. 確認する

1. ブラウザで `https://ehime-walk.vercel.app/api/ai/quests/quota` を開く。`"provider":"bedrock"`、`"configured":true`、`"remainingToday":10` が表示されれば準備完了（この確認では AI を呼ばず、回数も減らない）
2. アプリの「冒険 → AIクエスト」で 1 回提案させる（1 日 5 回のうち 1 回を使う）

## うまく動かないとき

| 症状 | 見るところ |
| --- | --- |
| AIクエストの画面が従来の提案のまま | 手順 6 の環境変数（Production に設定したか、`AI_PROVIDER=bedrock`、再デプロイしたか） |
| `/api/ai/quests/quota` が `ai_disabled` | `AI_PROVIDER`・`AWS_ROLE_ARN`・`AI_QUEST_QUOTA_TABLE` のどれかが本番に設定されていない |
| `/api/ai/quests/quota` が `service_unavailable` | ロールを引き受けられない、またはテーブルを読めない。手順 1（OIDC が有効か・Team か）、手順 2 の URL と対象者、手順 4 の信頼関係（チーム名・プロジェクト名・production）、テーブル名とリージョン |
| 提案すると「AIに接続できませんでした」 | 手順 4 の Bedrock の許可（モデル ID の綴り、アカウント ID）。Vercel の **Logs** で `ai_quest_failed` の `httpStatus` を見る（403 なら権限） |

Vercel のログには、エラーの種類と HTTP ステータスだけを出しています（トークン・認証情報・利用者の位置は出しません）。
