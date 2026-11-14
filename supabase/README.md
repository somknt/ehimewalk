# Supabase（オンライン化）

えひめウォーククエストを Supabase でオンライン化するための SQL です。いまはフェーズ1・2（調査・設計と SQL の作成）まで終わっています。画面はまだモック API（localStorage）で動いていて、Supabase にはつながっていません。

| ファイル | 内容 |
|---|---|
| `migrations/001_initial_schema.sql` | 型・テーブル・インデックス・RLS・トリガー・RPC・マスタデータ |
| `tests/001_rpc_rls_test.sql` | 動作確認の SQL（最後に ROLLBACK するのでデータは残らない） |

## SQL Editor での実行手順

1. https://supabase.com でプロジェクトを作る。Region は **Northeast Asia (Tokyo)** を選ぶ
2. **Authentication → Sign In / Providers** で **Allow anonymous sign-ins** をオンにする（初回は匿名でサインインするため）
3. **SQL Editor → New query** に `migrations/001_initial_schema.sql` の中身を全部貼り、**Run** を押す
   - 「Success. No rows returned」と出れば成功。2 回実行しても壊れない
4. 新しい query に `tests/001_rpc_rls_test.sql` を貼って **Run** を押す
   - エラーが出なければ合格。失敗すると `NG: …` で止まる（そのときの文を教えてください）
   - テスト用のユーザーを `auth.users` に作ってから ROLLBACK で取り消すので、データは残らない
5. **Table Editor** で、`public` のテーブル一覧にこのファイルのテーブルがあり、すべて「RLS enabled」になっていることを確かめる

デモ用アカウントにするとき（管理者だけ。SQL Editor で実行）：

```sql
select public.admin_set_demo_account('<ユーザーの UUID>', true);
```

## テーブル

| テーブル | 内容 | クライアントから |
|---|---|---|
| `items` `gacha_rates` `spots` `titles` `common_quests` | マスタ | 誰でも読める |
| `profiles` | ユーザー名・フレンドコード・目標・称号・デモ用か | 自分の行だけ読める |
| `characters` `character_equipment` | 見た目・装備（持っていてスロットが合うアイテムしか入らない） | 自分の行だけ |
| `inventory` | 所持アイテム（重複なし） | 自分の行だけ |
| `coin_balances` `coin_transactions` | 残高（マイナス不可）と台帳 | 自分の行だけ |
| `step_records` | 日付ごとの歩数・取得元・検証状態・付与済みコイン | 自分の行だけ |
| `gacha_draws` | ガチャの履歴 | 自分の行だけ |
| `visits` | スポットの訪問（座標は保存しない） | 自分の行だけ |
| `friendships` `cheers` | フレンド関係・応援 | 自分が関わる行だけ |
| `quest_claims` | クエスト報酬の受け取り（クエスト × 期間ごとに 1 回） | 自分の行だけ |
| `ai_quests` | AI が提案したクエスト（サーバーだけが書く） | 自分の行だけ |
| `activity_days` `demo_history` | 利用した日・デモ操作の履歴 | 自分の行だけ |
| `private.ai_quota_reservations` | AI の回数の予約 | 読めない |

書き込みはすべて RPC（関数）からだけです。テーブルに INSERT・UPDATE・DELETE の権限もポリシーも付けていません。

## RPC

ログイン中のユーザー（`authenticated`、匿名サインインを含む）が呼べるもの。本人は `auth.uid()` で決めます。

| 関数 | 画面の操作（`frontend/src/api/types.ts` の GameApi） |
|---|---|
| `get_session()` | getSession（プロフィール・キャラクター・称号） |
| `complete_onboarding(username, character_name, appearance, top_item_id, bottom_item_id)` | キャラクター作成（1 回だけ） |
| `update_profile(patch)` / `update_character(patch)` | マイページの変更 |
| `equip_item(slot, item_id)` | 着せ替え |
| `sync_steps(source, days)` | 歩数の同期とコインの付与 |
| `get_point_balance()` / `claim_login_bonus()` | 所持コイン・ログインボーナス |
| `draw_gacha()` | ガチャ |
| `check_in(spot_id, latitude, longitude, accuracy_m, via, quest_id, demo_location)` | GPS チェックイン |
| `get_ranking(scope, mode)` | ランキング（mode：`web` / `official`） |
| `get_friends()` / `find_user_by_friend_code(code)` / `send_friend_request(code)` / `respond_friend_request(user_id, accept)` / `remove_friend(user_id)` / `send_cheer(user_id, reaction)` | フレンド |
| `get_common_quests()` / `claim_common_quest(quest_id)` | みんなのクエスト |
| `get_activity_summary()` / `get_ai_quota()` | 利用状況・AI の残り回数 |
| `delete_my_data()` | データ削除 |
| `demo_add_coins(amount)` / `demo_add_steps(steps)` / `demo_get_history(limit)` / `demo_prepare_showcase()` | デモ操作（デモ用アカウントだけ） |

`service_role`（サーバーだけ）が呼べるもの：`ai_quota_reserve(user_id, global_limit)`、`ai_quota_commit(reservation_id, quest_id, title, spot_ids, model, generated_by)`、`ai_quota_release(reservation_id)`、`admin_set_demo_account(user_id, is_demo)`。

エラーは `message` に決まったコード（`insufficient_points`、`item_not_owned`、`invalid_slot`、`invalid_input`、`not_found`、`demo_unavailable`、`not_authenticated`）、`hint` に画面に出せる日本語が入ります。

## 画面から Supabase につなぐ（フェーズ3）

画面側の実装は `frontend/src/api/supabaseApi.ts`（GameApi と同じ形）と `frontend/src/lib/supabase.ts` です。`VITE_API_MODE` で切り替えます。設定しなければ、いままでどおりモックで動きます。

自分の PC で試すとき：

1. `frontend/.env.example` をコピーして `frontend/.env.development.local` を作り、`VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY`（`sb_publishable_` で始まるキー）を入れる
2. `VITE_API_MODE=supabase` にして `npm run dev`
3. 開くと匿名でサインインし、キャラクター作成から始まる（データは Supabase に保存される。上の「モック動作中」の帯は出ない）

ブラウザで試したテスト用のユーザーは、Supabase の **Authentication → Users** に残ります。要らなければそこで削除してください（関連するデータも一緒に消えます）。

## 公開版をオンラインにする（フェーズ4）

1. SQL Editor で `migrations/002_ai_quota_status.sql` を実行する（AI の残り回数をサーバーから確かめる関数）
2. Supabase の **Project Settings → API Keys** で、秘密のキー（`sb_secret_…`）を作る。チャットや GitHub には貼らない
3. Vercel の **Settings → Environment Variables** に、下の表の 5 つを **Production** で追加する
4. 再デプロイする（環境変数は次のデプロイから効く。`VITE_` で始まる値は画面のビルドに入る）

| 名前 | 値 | 公開してよいか |
|---|---|---|
| `VITE_API_MODE` | `supabase` | よい |
| `VITE_SUPABASE_URL` | プロジェクトの URL | よい（ブラウザに入る） |
| `VITE_SUPABASE_ANON_KEY` | 公開用のキー（`sb_publishable_…`） | よい（RLS で守る前提のキー） |
| `SUPABASE_URL` | プロジェクトの URL | サーバー用 |
| `SUPABASE_SECRET_KEY` | 秘密のキー（`sb_secret_…`） | **秘密**。Sensitive にする。`VITE_` を付けない |

- 秘密のキーは、AI の回数を数える Vercel Functions（`backend/src/limits/supabaseQuota.ts`）だけで使う。ブラウザ・GitHub・チャットには絶対に出さない
- `SUPABASE_URL` と `SUPABASE_SECRET_KEY` があると、AI 散策クエストはログイン中の Supabase のユーザーだけが使え、1 人 1 日 5 回を Supabase で数え、提案したクエストを `ai_quests` に記録する（チェックインの「AI 経由」の判定に使う）
- 画面だけをオンラインにして、サーバー側の 2 つを入れなかった場合は、AI の回数はこれまでどおり実行環境ごとのメモリで数える
- 切り替えると、これまで端末（localStorage）に保存していた進み具合は引き継がれない（最初から始まる）

### 発表用のアカウントをデモ用アカウントにする

1. 発表で使う端末・ブラウザで公開版を開き、キャラクターを作る
2. 「フレンド」画面の「あなたのフレンドコード」を控える
3. SQL Editor で次を実行する（`ABCD2345` を控えたコードに替える。ハイフンは入れない）

```sql
select public.admin_set_demo_account(
  (select user_id from public.profiles where friend_code = 'ABCD2345'), true);
```

4. アプリを再読み込みすると、ホームのデモ操作・マイページの「発表用デモ」・スポットの「デモ用チェックイン」が出る

匿名のアカウントは、そのブラウザに保存されたログイン情報で続いています。発表の前にブラウザのデータ（サイトデータ）を消すと、別のアカウントになるので、もう一度 1〜3 を行ってください。

## 注意

- **GPS の不正は完全には防げません。** 位置はブラウザが送る値なので、位置を偽装するアプリを使えば現地にいなくてもチェックインできます。座標の妥当性・誤差・距離の確認はしていますが、現地にいることの証明にはなりません
- **匿名サインインは何度でもやり直せます。** ブラウザのデータを消すと新しいアカウントになるため、1 人 1 日 5 回の AI の制限は、アカウント単位の目安です。料金を本当に守るのは、アプリ全体の 1 日の上限（`ai_quota_reserve` の `global_limit`、既定 200）です。Supabase の Authentication の設定で、匿名サインインの回数制限と CAPTCHA を有効にしてください
- 実際の Supabase では、まだ実行していません。PGlite（PostgreSQL 18.6 を WebAssembly で動かしたもの）に、Supabase のロールと `auth` スキーマの最小限のまねを作って確かめました。Supabase の PostgreSQL（15 / 17）での実行は未確認です
- ガチャの同時実行（連打）は、ユーザーごとの行ロック（`coin_balances` の FOR UPDATE）で順番に処理する作りですが、複数の接続での確認はまだしていません
