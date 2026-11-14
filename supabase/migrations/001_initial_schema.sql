-- =============================================================================
-- えひめウォーククエスト：Supabase 初期スキーマ（001）
--
-- 方針
-- - ゲームの値（コイン・所持アイテム・ガチャ・チェックイン・クエスト報酬）は、すべて RPC（関数）の中で
--   検証してから書き込む。クライアントはテーブルを直接 INSERT / UPDATE / DELETE できない
-- - 全テーブルで RLS を有効にする。直接読めるのは自分の行とマスタだけ。他人の情報は必要な列だけを RPC で返す
-- - RPC は security definer ＋ search_path = '' ＋ スキーマ付きの名前。本人は auth.uid() から決め、
--   引数でユーザー ID を受け取らない（service_role 専用の関数を除く）
-- - 二重付与は一意制約と、ユーザーごとの行ロック（coin_balances の FOR UPDATE）で防ぐ
-- - GPS の座標は判定にだけ使い、どのテーブルにも保存しない
-- - 日付はすべて日本時間（Asia/Tokyo）。週は月曜始まり
-- - 規則の正解は frontend/src/api/mockApi.ts と frontend/src/domain/*.ts（値を変えるときは両方を直す）
--
-- 再実行について
-- - create ... if not exists / create or replace / on conflict do update で、2 回実行しても壊れないようにしている
-- - DROP TABLE・TRUNCATE は使わない。ポリシーとトリガーだけは drop if exists → create で作り直す
-- =============================================================================

create schema if not exists private;

-- -----------------------------------------------------------------------------
-- 1. 型
-- -----------------------------------------------------------------------------

do $$
begin
  create type public.step_source as enum ('device_motion', 'demo', 'healthkit', 'health_connect');
exception when duplicate_object then null;
end $$;

do $$
begin
  -- trusted：信頼できる歩数（HealthKit 等の連携とサーバー側の確認ができてから使う）
  -- pending：端末のセンサーなど、確認待ち。Web 版ランキングにだけ入る
  -- excluded：デモの歩数。どのランキングにも入らない
  create type public.step_verification as enum ('trusted', 'pending', 'excluded');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.point_reason as enum (
    'step_reward', 'login_bonus', 'gacha_draw', 'gacha_refund', 'demo_grant', 'admin_adjustment', 'quest_reward'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.equip_slot as enum ('head', 'hair', 'top', 'bottom', 'shoes', 'accessory', 'background', 'pet');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.rarity as enum ('N', 'R', 'SR', 'SSR');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.item_acquisition as enum ('starter', 'gacha', 'spot', 'login_bonus');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.visit_via as enum ('ai_quest', 'list');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.spot_kind as enum ('landmark', 'shopping_street', 'culture', 'shop');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.friendship_status as enum ('pending', 'accepted');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.cheer_reaction as enum ('nice', 'fight', 'thanks');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.quest_kind as enum ('daily_steps', 'weekly_steps', 'visit_spots', 'community_steps');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.quest_period as enum ('daily', 'weekly', 'once');
exception when duplicate_object then null;
end $$;

do $$
begin
  -- reserved：AI を呼ぶ前に 1 回分を確保した / committed：使った / released：AI に請求されない失敗で戻した
  create type private.ai_reservation_status as enum ('reserved', 'committed', 'released');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 2. マスタテーブル（誰でも読める。書き込みは管理者のみ）
-- -----------------------------------------------------------------------------

-- アイテム（frontend/src/data/items.ts）。見た目のドット絵はフロントエンドに残す
create table if not exists public.items (
  item_id text primary key,
  name text not null,
  slot public.equip_slot not null,
  rarity public.rarity not null,
  acquisition public.item_acquisition not null,
  -- キャラクター作成で選べる初期衣装（'top' / 'bottom'）
  starter_choice text check (starter_choice in ('top', 'bottom')),
  -- 最初から持っていて装備している初期衣装（STARTER_EQUIPMENT）
  is_default_starter boolean not null default false,
  sort_order integer not null default 0,
  -- 装備の外部キー（アイテムとスロットの組）に使う
  unique (item_id, slot)
);

-- 通常ガチャの排出確率と、持っているアイテムが出たときの変換コイン
create table if not exists public.gacha_rates (
  rarity public.rarity primary key,
  probability numeric(6, 4) not null check (probability >= 0 and probability <= 1),
  duplicate_coins integer not null check (duplicate_coins >= 0 and duplicate_coins <= 50),
  sort_order integer not null
);

-- 観光スポット（frontend/src/data/spots.ts）。説明文・ガイド・情報源はフロントエンドに残す
create table if not exists public.spots (
  spot_id text primary key,
  name text not null,
  prefecture_code text not null,
  municipality_code text not null,
  municipality text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  checkin_radius_m integer not null check (checkin_radius_m between 10 and 1000),
  kind public.spot_kind not null,
  tags text[] not null default '{}',
  reward_item_id text not null references public.items (item_id),
  sort_order integer not null default 0
);

-- 称号（frontend/src/domain/titles.ts）。条件はサーバーで判定する
create table if not exists public.titles (
  title_id text primary key,
  name text not null,
  condition_text text not null,
  unlock_kind text not null check (unlock_kind in ('always', 'gacha_draws', 'goal_days_last7', 'visited_spots', 'owned_item_kinds')),
  unlock_threshold integer not null default 0,
  sort_order integer not null default 0
);

-- みんな共通のクエスト（frontend/src/domain/commonQuests.ts）
create table if not exists public.common_quests (
  quest_id text primary key,
  title text not null,
  description text not null,
  kind public.quest_kind not null,
  period public.quest_period not null,
  target integer not null check (target > 0),
  spot_ids text[],
  reward_coins integer not null check (reward_coins > 0),
  min_contribution integer,
  sort_order integer not null default 0
);

-- -----------------------------------------------------------------------------
-- 3. ユーザーデータのテーブル
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null default 'ぼうけんしゃ' check (char_length(username) between 1 and 12),
  friend_code text not null unique check (friend_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'),
  selected_region text not null default '38',
  ehime_ranking_opt_in boolean not null default true,
  title_id text not null default 'mikan_novice' references public.titles (title_id),
  daily_goal integer not null default 6000 check (daily_goal between 1000 and 20000),
  onboarded boolean not null default false,
  reduce_gacha_effects boolean not null default false,
  -- 発表用のデモ用アカウント。管理者だけが設定できる（admin_set_demo_account）。ランキングには入らない
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.characters (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  name text not null default 'ミカ' check (char_length(name) between 1 and 12),
  hair_style text not null default 'short' check (hair_style in ('short', 'bob', 'long')),
  hair_color text not null default 'brown' check (hair_color in ('black', 'brown', 'mikan', 'blonde', 'seto', 'pink')),
  skin_tone text not null default 'light' check (skin_tone in ('light', 'medium', 'tan', 'deep')),
  eye_color text not null default 'brown' check (eye_color in ('brown', 'black', 'blue', 'green')),
  updated_at timestamptz not null default now()
);

-- 所持アイテム。重複して持たない（ガチャで重複したときはコインに変換する）
create table if not exists public.inventory (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  item_id text not null references public.items (item_id),
  acquired_at timestamptz not null default now(),
  acquired_via public.item_acquisition not null,
  primary key (user_id, item_id)
);

-- 装備。持っているアイテム（inventory）で、スロットが合うもの（items）しか入らないよう外部キーで縛る
create table if not exists public.character_equipment (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  slot public.equip_slot not null,
  item_id text not null,
  primary key (user_id, slot),
  foreign key (user_id, item_id) references public.inventory (user_id, item_id) on delete cascade,
  foreign key (item_id, slot) references public.items (item_id, slot)
);

-- コイン残高。取引（coin_transactions）と同じトランザクションで更新し、マイナスにしない。
-- この行の FOR UPDATE を「ユーザーごとのロック」としても使う（ガチャの連打・同時実行の対策）
create table if not exists public.coin_balances (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- コインの取引履歴（台帳）
create table if not exists public.coin_transactions (
  transaction_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason public.point_reason not null,
  -- 二重付与の確認に使う参照キー（ログインボーナス：日付 / ガチャ：抽選 ID / クエスト：クエスト ID:期間 / 歩数：日付）
  ref_key text,
  created_at timestamptz not null default now()
);

-- 歩数（日本時間の日付ごとに 1 行）。steps = 取得した歩数 ＋ デモ操作で足した歩数（上限 100,000）
create table if not exists public.step_records (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  step_date date not null,
  raw_steps integer not null default 0 check (raw_steps between 0 and 100000),
  demo_added_steps integer not null default 0 check (demo_added_steps between 0 and 100000),
  steps integer generated always as (least(100000, raw_steps + demo_added_steps)) stored,
  source public.step_source not null,
  verification public.step_verification not null,
  -- この日の歩数で付与済みのコイン（二重付与の防止。差分だけを付与する）
  awarded_points integer not null default 0 check (awarded_points >= 0),
  synced_at timestamptz not null default now(),
  primary key (user_id, step_date)
);

-- ガチャの履歴
create table if not exists public.gacha_draws (
  draw_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  item_id text not null references public.items (item_id),
  rarity public.rarity not null,
  is_duplicate boolean not null,
  cost integer not null,
  refund integer not null default 0,
  created_at timestamptz not null default now()
);

-- 観光スポットの訪問（スポットごとに初回だけ）。座標の列は作らない
create table if not exists public.visits (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  spot_id text not null references public.spots (spot_id),
  visited_at timestamptz not null default now(),
  via public.visit_via not null,
  quest_id uuid,
  -- GPS で現地確認できた訪問か（デモ用チェックインは false）
  verified boolean not null,
  primary key (user_id, spot_id)
);

-- フレンド関係。2 人の組を 1 行で持つ（user_low < user_high）
create table if not exists public.friendships (
  user_low uuid not null references public.profiles (user_id) on delete cascade,
  user_high uuid not null references public.profiles (user_id) on delete cascade,
  requested_by uuid not null,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_low, user_high),
  check (user_low < user_high),
  check (requested_by in (user_low, user_high))
);

-- 応援（定型の種類だけ。自由文は送れない）
create table if not exists public.cheers (
  cheer_id bigint generated always as identity primary key,
  from_user uuid not null references public.profiles (user_id) on delete cascade,
  to_user uuid not null references public.profiles (user_id) on delete cascade,
  reaction public.cheer_reaction not null,
  cheer_date date not null,
  created_at timestamptz not null default now()
);

-- みんな共通のクエストの報酬を受け取った記録（クエスト × 期間ごとに 1 回）
create table if not exists public.quest_claims (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  quest_id text not null references public.common_quests (quest_id),
  period_key text not null,
  reward_coins integer not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, quest_id, period_key)
);

-- AI 散策クエストの記録（サーバー＝Vercel Functions が service_role で書き込む。座標・入力条件は保存しない）
create table if not exists public.ai_quests (
  quest_id uuid primary key,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  title text not null check (char_length(title) <= 100),
  spot_ids text[] not null,
  model text,
  generated_by text not null check (generated_by in ('mock', 'bedrock')),
  reservation_id uuid unique,
  created_at timestamptz not null default now()
);

-- アプリを利用した日（効果検証の「利用日数」）
create table if not exists public.activity_days (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  active_date date not null,
  primary key (user_id, active_date)
);

-- デモ操作の履歴（デモ用アカウントだけ）
create table if not exists public.demo_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  kind text not null check (kind in ('coins', 'steps')),
  amount integer not null check (amount >= 0),
  awarded_coins integer not null default 0 check (awarded_coins >= 0),
  created_at timestamptz not null default now()
);

-- AI の利用回数の予約（クライアントからは見えない private スキーマ）。
-- データ削除をしても消さない（消すと回数を戻せてしまうため）。auth のユーザー削除では一緒に消える
create table if not exists private.ai_quota_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  quota_date date not null,
  status private.ai_reservation_status not null default 'reserved',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- -----------------------------------------------------------------------------
-- 4. インデックス
-- -----------------------------------------------------------------------------

-- 同じ報酬を 2 回入れない（歩数のコインは同じ日に何回にも分かれるので対象外。step_records.awarded_points で防ぐ）
create unique index if not exists coin_transactions_once_idx
  on public.coin_transactions (user_id, reason, ref_key)
  where reason in ('login_bonus', 'quest_reward', 'gacha_draw', 'gacha_refund') and ref_key is not null;
create index if not exists coin_transactions_user_idx on public.coin_transactions (user_id, created_at desc);
-- ランキング・みんなのクエストの週間集計
create index if not exists step_records_date_idx on public.step_records (step_date, user_id) include (steps, verification);
create index if not exists gacha_draws_user_idx on public.gacha_draws (user_id, created_at desc);
create index if not exists friendships_high_idx on public.friendships (user_high);
create index if not exists cheers_pair_day_idx on public.cheers (from_user, to_user, cheer_date);
create index if not exists cheers_to_idx on public.cheers (to_user);
create index if not exists ai_quests_user_idx on public.ai_quests (user_id, created_at desc);
create index if not exists ai_quota_day_idx on private.ai_quota_reservations (quota_date, user_id);
create index if not exists demo_history_user_idx on public.demo_history (user_id, created_at desc);
create index if not exists profiles_ranking_idx on public.profiles (onboarded, is_demo, ehime_ranking_opt_in);

-- -----------------------------------------------------------------------------
-- 5・6. RLS とポリシー
-- -----------------------------------------------------------------------------

alter table public.items enable row level security;
alter table public.gacha_rates enable row level security;
alter table public.spots enable row level security;
alter table public.titles enable row level security;
alter table public.common_quests enable row level security;
alter table public.profiles enable row level security;
alter table public.characters enable row level security;
alter table public.inventory enable row level security;
alter table public.character_equipment enable row level security;
alter table public.coin_balances enable row level security;
alter table public.coin_transactions enable row level security;
alter table public.step_records enable row level security;
alter table public.gacha_draws enable row level security;
alter table public.visits enable row level security;
alter table public.friendships enable row level security;
alter table public.cheers enable row level security;
alter table public.quest_claims enable row level security;
alter table public.ai_quests enable row level security;
alter table public.activity_days enable row level security;
alter table public.demo_history enable row level security;
alter table private.ai_quota_reservations enable row level security;

-- マスタ：誰でも読める
drop policy if exists items_read on public.items;
create policy items_read on public.items for select to anon, authenticated using (true);
drop policy if exists gacha_rates_read on public.gacha_rates;
create policy gacha_rates_read on public.gacha_rates for select to anon, authenticated using (true);
drop policy if exists spots_read on public.spots;
create policy spots_read on public.spots for select to anon, authenticated using (true);
drop policy if exists titles_read on public.titles;
create policy titles_read on public.titles for select to anon, authenticated using (true);
drop policy if exists common_quests_read on public.common_quests;
create policy common_quests_read on public.common_quests for select to anon, authenticated using (true);

-- ユーザーデータ：自分の行だけ読める。書き込みのポリシーは作らない（RPC だけが書き込む）
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists characters_own on public.characters;
create policy characters_own on public.characters for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists inventory_own on public.inventory;
create policy inventory_own on public.inventory for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists equipment_own on public.character_equipment;
create policy equipment_own on public.character_equipment for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists balances_own on public.coin_balances;
create policy balances_own on public.coin_balances for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists transactions_own on public.coin_transactions;
create policy transactions_own on public.coin_transactions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists step_records_own on public.step_records;
create policy step_records_own on public.step_records for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists gacha_draws_own on public.gacha_draws;
create policy gacha_draws_own on public.gacha_draws for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists visits_own on public.visits;
create policy visits_own on public.visits for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists friendships_own on public.friendships;
create policy friendships_own on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));
drop policy if exists cheers_own on public.cheers;
create policy cheers_own on public.cheers for select to authenticated using (from_user = (select auth.uid()));
drop policy if exists quest_claims_own on public.quest_claims;
create policy quest_claims_own on public.quest_claims for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists ai_quests_own on public.ai_quests;
create policy ai_quests_own on public.ai_quests for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists activity_days_own on public.activity_days;
create policy activity_days_own on public.activity_days for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists demo_history_own on public.demo_history;
create policy demo_history_own on public.demo_history for select to authenticated using (user_id = (select auth.uid()));
-- private.ai_quota_reservations はポリシーを作らない（関数からだけ読み書きする）

-- -----------------------------------------------------------------------------
-- 8a. 内部の関数（private スキーマ。クライアントからは呼べない）
-- -----------------------------------------------------------------------------

-- 決まったエラーコードで止める。message はコード、hint は画面に出せる日本語
create or replace function private.fail(p_code text, p_message text)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code, hint = p_message;
end;
$$;

create or replace function private.jst_today()
returns date language sql stable set search_path = '' as $$
  select (pg_catalog.now() at time zone 'Asia/Tokyo')::date;
$$;

-- その週の月曜日
create or replace function private.week_start(p_date date)
returns date language sql immutable set search_path = '' as $$
  select p_date - (extract(isodow from p_date)::integer - 1);
$$;

create or replace function private.date_key(p_date date)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.to_char(p_date, 'YYYY-MM-DD');
$$;

create or replace function private.iso(p_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select pg_catalog.to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- 暗号論的な乱数（gen_random_uuid の乱数部分の 4 バイト）。0 以上 1 未満
create or replace function private.secure_random()
returns double precision language plpgsql volatile set search_path = '' as $$
declare
  v_bytes bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
begin
  return ((pg_catalog.get_byte(v_bytes, 10)::bigint << 24)
        | (pg_catalog.get_byte(v_bytes, 11)::bigint << 16)
        | (pg_catalog.get_byte(v_bytes, 12)::bigint << 8)
        |  pg_catalog.get_byte(v_bytes, 13)::bigint)::double precision / 4294967296.0;
end;
$$;

-- 8 文字のフレンドコード（32 種類の文字。256 は 32 で割り切れるので偏らない）
create or replace function private.random_friend_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_a bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  v_b bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  v_code text := '';
  v_byte integer;
  i integer;
begin
  for i in 0..7 loop
    -- uuid の 10〜15 バイト目は乱数だけでできている
    v_byte := case when i < 6 then pg_catalog.get_byte(v_a, 10 + i) else pg_catalog.get_byte(v_b, 10 + i - 6) end;
    v_code := v_code || pg_catalog.substr(v_chars, (v_byte % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- まだ使われていないフレンドコード
create or replace function private.new_friend_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_code text;
begin
  for i in 1..20 loop
    v_code := private.random_friend_code();
    if not exists (select 1 from public.profiles where friend_code = v_code) then
      return v_code;
    end if;
  end loop;
  perform private.fail('server_error', 'フレンドコードを作れませんでした。');
  return null;
end;
$$;

-- 呼び出した本人（ログインしていなければ止める）
create or replace function private.require_uid()
returns uuid language plpgsql stable set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform private.fail('not_authenticated', 'ログインしてください。');
  end if;
  if not exists (select 1 from public.profiles where user_id = v_uid) then
    perform private.fail('not_found', 'ユーザーが見つかりません。');
  end if;
  return v_uid;
end;
$$;

-- ユーザーごとのロック。コインや所持品を変える RPC は最初に呼ぶ（同時に呼ばれても順番に処理される）
create or replace function private.lock_user(p_user_id uuid)
returns void language plpgsql volatile set search_path = '' as $$
begin
  perform 1 from public.coin_balances where user_id = p_user_id for update;
  if not found then
    perform private.fail('not_found', 'ユーザーが見つかりません。');
  end if;
end;
$$;

create or replace function private.is_demo(p_user_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select is_demo from public.profiles where user_id = p_user_id), false);
$$;

create or replace function private.require_demo(p_user_id uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if not private.is_demo(p_user_id) then
    perform private.fail('demo_unavailable', 'デモ操作は、発表用のデモ用アカウントでだけ使えます。');
  end if;
end;
$$;

-- コインを増減して取引を記録し、新しい残高を返す（残高はマイナスにしない）。lock_user のあとに呼ぶ
create or replace function private.add_coins(p_user_id uuid, p_amount integer, p_reason public.point_reason, p_ref_key text)
returns integer language plpgsql volatile set search_path = '' as $$
declare
  v_balance integer;
begin
  if p_amount = 0 then
    select balance into v_balance from public.coin_balances where user_id = p_user_id;
    return v_balance;
  end if;
  update public.coin_balances
     set balance = balance + p_amount, updated_at = pg_catalog.now()
   where user_id = p_user_id and balance + p_amount >= 0
  returning balance into v_balance;
  if not found then
    perform private.fail('insufficient_points', 'コインが足りません。');
  end if;
  insert into public.coin_transactions (user_id, amount, reason, ref_key) values (p_user_id, p_amount, p_reason, p_ref_key);
  return v_balance;
end;
$$;

-- その日の歩数から、付与済みとの差分だけ歩数コインを付与する（100 歩 = 1 コイン、上限なし、直近 7 日分だけ）
create or replace function private.award_step_coins(p_user_id uuid, p_date date)
returns integer language plpgsql volatile set search_path = '' as $$
declare
  v_today date := private.jst_today();
  v_steps integer;
  v_awarded integer;
  v_add integer;
begin
  if p_date < v_today - 6 or p_date > v_today then
    return 0;
  end if;
  select steps, awarded_points into v_steps, v_awarded
    from public.step_records where user_id = p_user_id and step_date = p_date for update;
  if not found then
    return 0;
  end if;
  v_add := greatest(0, (v_steps / 100) - v_awarded);
  if v_add > 0 then
    update public.step_records set awarded_points = awarded_points + v_add where user_id = p_user_id and step_date = p_date;
    perform private.add_coins(p_user_id, v_add, 'step_reward', private.date_key(p_date));
  end if;
  return v_add;
end;
$$;

-- 初期状態の作成（キャラクター・残高・初期衣装と装備）。新規登録とデータ削除で使う
create or replace function private.init_user_data(p_user_id uuid)
returns void language plpgsql volatile set search_path = '' as $$
begin
  insert into public.characters (user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.coin_balances (user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.inventory (user_id, item_id, acquired_via)
    select p_user_id, item_id, 'starter' from public.items where is_default_starter
  on conflict (user_id, item_id) do nothing;
  insert into public.character_equipment (user_id, slot, item_id)
    select p_user_id, slot, item_id from public.items where is_default_starter
  on conflict (user_id, slot) do nothing;
end;
$$;

-- 自分のデータをすべて消して初期状態に戻す（アカウントと、AI の利用回数の予約は残す）
create or replace function private.reset_user_data(p_user_id uuid)
returns void language plpgsql volatile set search_path = '' as $$
begin
  delete from public.character_equipment where user_id = p_user_id;
  delete from public.inventory where user_id = p_user_id;
  delete from public.coin_transactions where user_id = p_user_id;
  delete from public.step_records where user_id = p_user_id;
  delete from public.gacha_draws where user_id = p_user_id;
  delete from public.visits where user_id = p_user_id;
  delete from public.friendships where p_user_id in (user_low, user_high);
  delete from public.cheers where from_user = p_user_id or to_user = p_user_id;
  delete from public.quest_claims where user_id = p_user_id;
  delete from public.ai_quests where user_id = p_user_id;
  delete from public.activity_days where user_id = p_user_id;
  delete from public.demo_history where user_id = p_user_id;
  delete from public.characters where user_id = p_user_id;
  update public.coin_balances set balance = 0, updated_at = pg_catalog.now() where user_id = p_user_id;
  -- フレンドコードも新しくする（前のコードを知っている人から見つからないように）
  update public.profiles
     set username = 'ぼうけんしゃ', friend_code = private.new_friend_code(), selected_region = '38',
         ehime_ranking_opt_in = true, title_id = 'mikan_novice', daily_goal = 6000, onboarded = false,
         reduce_gacha_effects = false, created_at = pg_catalog.now(), updated_at = pg_catalog.now()
   where user_id = p_user_id;
  perform private.init_user_data(p_user_id);
end;
$$;

-- ---- JSON（frontend/src/api/types.ts の形に合わせる） ----

create or replace function private.character_json(p_user_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'name', c.name,
    'appearance', jsonb_build_object('hairStyle', c.hair_style, 'hairColor', c.hair_color, 'skinTone', c.skin_tone, 'eyeColor', c.eye_color),
    'equipped', coalesce((select jsonb_object_agg(e.slot::text, e.item_id) from public.character_equipment e where e.user_id = p_user_id), '{}'::jsonb)
  )
  from public.characters c where c.user_id = p_user_id;
$$;

create or replace function private.title_name(p_title_id text)
returns text language sql stable set search_path = '' as $$
  select coalesce((select name from public.titles where title_id = p_title_id), 'みかん見習い');
$$;

create or replace function private.profile_json(p_user_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'userId', p.user_id,
    'username', p.username,
    'friendCode', p.friend_code,
    'selectedRegion', p.selected_region,
    'ehimeRankingOptIn', p.ehime_ranking_opt_in,
    'titleId', p.title_id,
    'title', private.title_name(p.title_id),
    'dailyGoal', p.daily_goal,
    'onboarded', p.onboarded,
    'reduceGachaEffects', p.reduce_gacha_effects,
    'isDemo', p.is_demo,
    'createdAt', private.iso(p.created_at)
  )
  from public.profiles p where p.user_id = p_user_id;
$$;

-- 称号の獲得状況（TitleStatus[]）
create or replace function private.titles_json(p_user_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_today date := private.jst_today();
  v_goal integer;
  v_visited integer;
  v_draws integer;
  v_goal_days integer;
  v_items integer;
begin
  select daily_goal into v_goal from public.profiles where user_id = p_user_id;
  select count(*) into v_visited from public.visits where user_id = p_user_id;
  select count(*) into v_draws from public.gacha_draws where user_id = p_user_id;
  select count(*) into v_items from public.inventory where user_id = p_user_id;
  select count(*) into v_goal_days from public.step_records
   where user_id = p_user_id and step_date between v_today - 6 and v_today and steps >= v_goal;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'titleId', t.title_id,
      'name', t.name,
      'condition', t.condition_text,
      'unlocked', case t.unlock_kind
        when 'always' then true
        when 'gacha_draws' then v_draws >= t.unlock_threshold
        when 'goal_days_last7' then v_goal_days >= t.unlock_threshold
        when 'visited_spots' then v_visited >= t.unlock_threshold
        when 'owned_item_kinds' then v_items >= t.unlock_threshold
        else false end
    ) order by t.sort_order)
    from public.titles t
  ), '[]'::jsonb);
end;
$$;

create or replace function private.session_json(p_user_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'profile', private.profile_json(p_user_id),
    'character', private.character_json(p_user_id),
    'titles', private.titles_json(p_user_id)
  );
$$;

create or replace function private.balance_json(p_user_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'balance', coalesce((select balance from public.coin_balances where user_id = p_user_id), 0),
    'todayStepPoints', coalesce((select awarded_points from public.step_records
                                  where user_id = p_user_id and step_date = private.jst_today()), 0),
    'loginBonusClaimedToday', exists (select 1 from public.coin_transactions
                                       where user_id = p_user_id and reason = 'login_bonus'
                                         and ref_key = private.date_key(private.jst_today())),
    'loginBonusAmount', 10
  );
$$;

create or replace function private.visit_json(v public.visits)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('spotId', v.spot_id, 'visitedAt', private.iso(v.visited_at), 'via', v.via, 'verified', v.verified)
      || case when v.quest_id is null then '{}'::jsonb else jsonb_build_object('questId', v.quest_id) end;
$$;

-- 今週（月曜から）の歩数。p_mode：'all' すべて / 'web' trusted と pending / 'official' trusted だけ
create or replace function private.weekly_steps(p_user_id uuid, p_mode text)
returns integer language sql stable set search_path = '' as $$
  select coalesce(sum(steps), 0)::integer from public.step_records
   where user_id = p_user_id
     and step_date between private.week_start(private.jst_today()) and private.jst_today()
     and (p_mode = 'all'
          or (p_mode = 'web' and verification in ('trusted', 'pending'))
          or (p_mode = 'official' and verification = 'trusted'));
$$;

-- ---- フレンド ----

create or replace function private.normalize_friend_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
$$;

-- 相手との関係：self / friend / pending_sent / pending_received / none
create or replace function private.relation(p_me uuid, p_other uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when p_me = p_other then 'self'
    else coalesce((
      select case when f.status = 'accepted' then 'friend'
                  when f.requested_by = p_me then 'pending_sent'
                  else 'pending_received' end
        from public.friendships f
       where f.user_low = least(p_me, p_other) and f.user_high = greatest(p_me, p_other)
    ), 'none')
  end;
$$;

-- 他人に見せてよい情報だけ（名前・見た目・称号）
create or replace function private.public_user_json(p_user_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'userId', p.user_id,
    'username', p.username,
    'character', private.character_json(p.user_id),
    'title', private.title_name(p.title_id)
  )
  from public.profiles p where p.user_id = p_user_id;
$$;

-- FriendsData（sampleCodes はオンライン版では空）
create or replace function private.friends_json(p_me uuid)
returns jsonb language sql stable set search_path = '' as $$
  with rel as (
    select case when f.user_low = p_me then f.user_high else f.user_low end as other_id,
           case when f.status = 'accepted' then 'friend'
                when f.requested_by = p_me then 'pending_sent'
                else 'pending_received' end as relation,
           coalesce(f.responded_at, f.created_at) as since
      from public.friendships f
     where p_me in (f.user_low, f.user_high)
  ), entries as (
    select r.relation, r.since,
           case when r.relation = 'friend' then private.weekly_steps(r.other_id, 'web') end as weekly_steps,
           private.public_user_json(r.other_id)
             || jsonb_build_object(
                  'weeklySteps', case when r.relation = 'friend' then private.weekly_steps(r.other_id, 'web') end,
                  'relation', r.relation,
                  'since', private.iso(r.since),
                  'cheersSent', (select count(*) from public.cheers c where c.from_user = p_me and c.to_user = r.other_id),
                  'isSample', false
                ) as entry
      from rel r
  )
  select jsonb_build_object(
    'myFriendCode', (select friend_code from public.profiles where user_id = p_me),
    'friends', coalesce((select jsonb_agg(entry order by weekly_steps desc nulls last, since desc) from entries where relation = 'friend'), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(entry order by since desc) from entries where relation = 'pending_received'), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(entry order by since desc) from entries where relation = 'pending_sent'), '[]'::jsonb),
    'limit', 100,
    'sampleCodes', '[]'::jsonb
  );
$$;

-- ---- みんな共通のクエスト ----

create or replace function private.quest_period_key(p_period public.quest_period)
returns text language sql stable set search_path = '' as $$
  select case p_period
    when 'daily' then private.date_key(private.jst_today())
    when 'weekly' then private.date_key(private.week_start(private.jst_today()))
    else 'once' end;
$$;

-- CommonQuestStatus[]
create or replace function private.common_quest_statuses(p_user_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_today date := private.jst_today();
  v_week date := private.week_start(private.jst_today());
  v_today_steps integer;
  v_week_steps integer;
  v_total bigint;
  v_participants integer;
  v_result jsonb := '[]'::jsonb;
  v_quest jsonb;
  v_status jsonb;
  v_visited text[];
  v_claimed boolean;
  q public.common_quests;
begin
  -- 自分の進み具合はすべての歩数で数える（モックと同じ）
  select coalesce(sum(steps) filter (where step_date = v_today), 0), coalesce(sum(steps), 0)
    into v_today_steps, v_week_steps
    from public.step_records where user_id = p_user_id and step_date between v_week and v_today;
  -- みんなの合計：デモ用アカウントとデモの歩数（excluded）は入れない
  select coalesce(sum(s.steps), 0), count(distinct s.user_id)
    into v_total, v_participants
    from public.step_records s join public.profiles p on p.user_id = s.user_id
   where s.step_date between v_week and v_today and s.verification <> 'excluded' and not p.is_demo and s.steps > 0;

  for q in select * from public.common_quests order by sort_order loop
    v_claimed := exists (select 1 from public.quest_claims c
                          where c.user_id = p_user_id and c.quest_id = q.quest_id and c.period_key = private.quest_period_key(q.period));
    v_quest := jsonb_build_object('questId', q.quest_id, 'title', q.title, 'description', q.description, 'kind', q.kind,
                                  'period', q.period, 'target', q.target, 'rewardCoins', q.reward_coins)
            || case when q.spot_ids is null then '{}'::jsonb else jsonb_build_object('spotIds', to_jsonb(q.spot_ids)) end
            || case when q.min_contribution is null then '{}'::jsonb else jsonb_build_object('minContribution', q.min_contribution) end;
    if q.kind = 'daily_steps' then
      v_status := jsonb_build_object('progress', v_today_steps, 'completed', v_today_steps >= q.target, 'resetsOn', private.date_key(v_today + 1));
    elsif q.kind = 'weekly_steps' then
      v_status := jsonb_build_object('progress', v_week_steps, 'completed', v_week_steps >= q.target, 'resetsOn', private.date_key(v_week + 7));
    elsif q.kind = 'community_steps' then
      v_status := jsonb_build_object(
        'progress', v_total,
        'completed', v_total >= q.target and v_week_steps >= coalesce(q.min_contribution, 0),
        'myContribution', v_week_steps,
        'participants', v_participants,
        'resetsOn', private.date_key(v_week + 7));
    else
      select coalesce(array_agg(sid order by ord), '{}') into v_visited
        from unnest(q.spot_ids) with ordinality as u(sid, ord)
       where exists (select 1 from public.visits v where v.user_id = p_user_id and v.spot_id = u.sid);
      v_status := jsonb_build_object('progress', cardinality(v_visited), 'completed', cardinality(v_visited) >= q.target,
                                     'visitedSpotIds', to_jsonb(v_visited));
    end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object('quest', v_quest, 'claimed', v_claimed) || v_status);
  end loop;
  return v_result;
end;
$$;

-- ---- AI の利用回数 ----

create or replace function private.ai_daily_limit()
returns integer language sql immutable set search_path = '' as $$
  select 5;
$$;

-- 今日使った回数（予約中・使用済み。取り消したものは数えない）
create or replace function private.ai_used_today(p_user_id uuid)
returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from private.ai_quota_reservations
   where user_id = p_user_id and quota_date = private.jst_today() and status <> 'released';
$$;

-- -----------------------------------------------------------------------------
-- 7. トリガー：新規登録（匿名サインインを含む）でプロフィールと初期データを作る
-- -----------------------------------------------------------------------------

-- Supabase の案内に合わせて public に置く（トリガー用の関数は RPC としては呼べない）
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tries integer := 0;
begin
  loop
    begin
      insert into public.profiles (user_id, friend_code) values (new.id, private.new_friend_code());
      exit;
    exception when unique_violation then
      -- 同時に同じコードを作った場合だけ、作り直す
      v_tries := v_tries + 1;
      if v_tries >= 5 then raise; end if;
    end;
  end loop;
  perform private.init_user_data(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 8b. RPC（authenticated が呼べる）
-- -----------------------------------------------------------------------------

-- ---- セッション・プロフィール・キャラクター ----

-- SessionData
create or replace function public.get_session()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return private.session_json(private.require_uid());
end;
$$;

-- キャラクター作成（1 アカウント 1 回）
create or replace function public.complete_onboarding(
  p_username text, p_character_name text, p_appearance jsonb, p_top_item_id text, p_bottom_item_id text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := pg_catalog.btrim(coalesce(p_character_name, ''));
  v_username text := pg_catalog.btrim(coalesce(p_username, ''));
begin
  if char_length(v_name) = 0 then perform private.fail('invalid_input', 'キャラクターの名前を入力してください。'); end if;
  if char_length(v_name) > 12 then perform private.fail('invalid_input', 'キャラクターの名前は12文字以内で入力してください。'); end if;
  if char_length(v_username) = 0 then perform private.fail('invalid_input', 'ユーザー名を入力してください。'); end if;
  if char_length(v_username) > 12 then perform private.fail('invalid_input', 'ユーザー名は12文字以内で入力してください。'); end if;
  if p_appearance is null or jsonb_typeof(p_appearance) <> 'object'
     or coalesce(p_appearance ->> 'hairStyle', '') not in ('short', 'bob', 'long')
     or coalesce(p_appearance ->> 'hairColor', '') not in ('black', 'brown', 'mikan', 'blonde', 'seto', 'pink')
     or coalesce(p_appearance ->> 'skinTone', '') not in ('light', 'medium', 'tan', 'deep')
     or coalesce(p_appearance ->> 'eyeColor', '') not in ('brown', 'black', 'blue', 'green') then
    perform private.fail('invalid_input', '見た目をすべて選んでください。');
  end if;
  if not exists (select 1 from public.items where item_id = p_top_item_id and starter_choice = 'top')
     or not exists (select 1 from public.items where item_id = p_bottom_item_id and starter_choice = 'bottom') then
    perform private.fail('invalid_input', '選べない服が指定されました。');
  end if;

  perform private.lock_user(v_uid);
  if (select onboarded from public.profiles where user_id = v_uid) then
    perform private.fail('invalid_input', 'キャラクターはすでに作成済みです。');
  end if;

  insert into public.inventory (user_id, item_id, acquired_via)
  values (v_uid, p_top_item_id, 'starter'), (v_uid, p_bottom_item_id, 'starter')
  on conflict (user_id, item_id) do nothing;
  -- 装備は初期衣装に、選んだ上下を重ねる
  delete from public.character_equipment where user_id = v_uid;
  insert into public.character_equipment (user_id, slot, item_id)
    select v_uid, slot, item_id from public.items where is_default_starter and slot not in ('top', 'bottom');
  insert into public.character_equipment (user_id, slot, item_id) values (v_uid, 'top', p_top_item_id), (v_uid, 'bottom', p_bottom_item_id);
  update public.characters
     set name = v_name, hair_style = p_appearance ->> 'hairStyle', hair_color = p_appearance ->> 'hairColor',
         skin_tone = p_appearance ->> 'skinTone', eye_color = p_appearance ->> 'eyeColor', updated_at = pg_catalog.now()
   where user_id = v_uid;
  update public.profiles set username = v_username, onboarded = true, updated_at = pg_catalog.now() where user_id = v_uid;
  return private.session_json(v_uid);
end;
$$;

-- ProfilePatch：username / dailyGoal / ehimeRankingOptIn / reduceGachaEffects / titleId
create or replace function public.update_profile(p_patch jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_username text;
  v_goal numeric;
  v_title_ok boolean;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform private.fail('invalid_input', '変更内容が正しくありません。');
  end if;
  perform private.lock_user(v_uid);

  if p_patch ? 'username' then
    if jsonb_typeof(p_patch -> 'username') <> 'string' then perform private.fail('invalid_input', 'ユーザー名を入力してください。'); end if;
    v_username := pg_catalog.btrim(p_patch ->> 'username');
    if char_length(v_username) = 0 then perform private.fail('invalid_input', 'ユーザー名を入力してください。'); end if;
    if char_length(v_username) > 12 then perform private.fail('invalid_input', 'ユーザー名は12文字以内で入力してください。'); end if;
    update public.profiles set username = v_username where user_id = v_uid;
  end if;
  if p_patch ? 'dailyGoal' then
    if jsonb_typeof(p_patch -> 'dailyGoal') <> 'number' then perform private.fail('invalid_input', '目標は1,000〜20,000歩の範囲で設定してください。'); end if;
    v_goal := (p_patch ->> 'dailyGoal')::numeric;
    if v_goal <> trunc(v_goal) or v_goal < 1000 or v_goal > 20000 then
      perform private.fail('invalid_input', '目標は1,000〜20,000歩の範囲で設定してください。');
    end if;
    update public.profiles set daily_goal = v_goal::integer where user_id = v_uid;
  end if;
  if p_patch ? 'ehimeRankingOptIn' then
    update public.profiles set ehime_ranking_opt_in = (p_patch -> 'ehimeRankingOptIn') = 'true'::jsonb where user_id = v_uid;
  end if;
  if p_patch ? 'reduceGachaEffects' then
    update public.profiles set reduce_gacha_effects = (p_patch -> 'reduceGachaEffects') = 'true'::jsonb where user_id = v_uid;
  end if;
  if p_patch ? 'titleId' then
    select coalesce((t ->> 'unlocked')::boolean, false) into v_title_ok
      from jsonb_array_elements(private.titles_json(v_uid)) t where t ->> 'titleId' = p_patch ->> 'titleId';
    if not coalesce(v_title_ok, false) then perform private.fail('invalid_input', 'まだ獲得していない称号です。'); end if;
    update public.profiles set title_id = p_patch ->> 'titleId' where user_id = v_uid;
  end if;
  update public.profiles set updated_at = pg_catalog.now() where user_id = v_uid;
  return private.session_json(v_uid);
end;
$$;

-- CharacterPatch：name / appearance（一部だけでもよい）
create or replace function public.update_character(p_patch jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_name text;
  v_a jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform private.fail('invalid_input', '変更内容が正しくありません。');
  end if;
  if p_patch ? 'name' then
    v_name := pg_catalog.btrim(coalesce(p_patch ->> 'name', ''));
    if char_length(v_name) = 0 then perform private.fail('invalid_input', 'キャラクターの名前を入力してください。'); end if;
    if char_length(v_name) > 12 then perform private.fail('invalid_input', 'キャラクターの名前は12文字以内で入力してください。'); end if;
    update public.characters set name = v_name where user_id = v_uid;
  end if;
  if p_patch ? 'appearance' then
    v_a := p_patch -> 'appearance';
    if jsonb_typeof(v_a) <> 'object'
       or (v_a ? 'hairStyle' and coalesce(v_a ->> 'hairStyle', '') not in ('short', 'bob', 'long'))
       or (v_a ? 'hairColor' and coalesce(v_a ->> 'hairColor', '') not in ('black', 'brown', 'mikan', 'blonde', 'seto', 'pink'))
       or (v_a ? 'skinTone' and coalesce(v_a ->> 'skinTone', '') not in ('light', 'medium', 'tan', 'deep'))
       or (v_a ? 'eyeColor' and coalesce(v_a ->> 'eyeColor', '') not in ('brown', 'black', 'blue', 'green')) then
      perform private.fail('invalid_input', '選べない外見が指定されました。');
    end if;
    update public.characters
       set hair_style = coalesce(v_a ->> 'hairStyle', hair_style), hair_color = coalesce(v_a ->> 'hairColor', hair_color),
           skin_tone = coalesce(v_a ->> 'skinTone', skin_tone), eye_color = coalesce(v_a ->> 'eyeColor', eye_color)
     where user_id = v_uid;
  end if;
  update public.characters set updated_at = pg_catalog.now() where user_id = v_uid;
  return private.character_json(v_uid);
end;
$$;

-- 着せ替え。p_item_id が null なら外す。持っていない・スロットが合わないアイテムは装備できない
create or replace function public.equip_item(p_slot text, p_item_id text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_slot public.equip_slot;
  v_item_slot public.equip_slot;
begin
  begin
    v_slot := p_slot::public.equip_slot;
  exception when others then
    perform private.fail('invalid_slot', '装備する場所が正しくありません。');
  end;
  if v_slot is null then perform private.fail('invalid_slot', '装備する場所が正しくありません。'); end if;
  if p_item_id is null then
    delete from public.character_equipment where user_id = v_uid and slot = v_slot;
    return private.character_json(v_uid);
  end if;
  select i.slot into v_item_slot from public.items i
    join public.inventory inv on inv.item_id = i.item_id and inv.user_id = v_uid
   where i.item_id = p_item_id;
  if not found then perform private.fail('item_not_owned', 'まだ持っていないアイテムは装備できません。'); end if;
  if v_item_slot <> v_slot then perform private.fail('invalid_slot', 'このアイテムは、ここには装備できません。'); end if;
  insert into public.character_equipment (user_id, slot, item_id) values (v_uid, v_slot, p_item_id)
  on conflict (user_id, slot) do update set item_id = excluded.item_id;
  return private.character_json(v_uid);
end;
$$;

-- ---- 歩数とコイン ----

-- 歩数の同期。p_days = [{ "date": "YYYY-MM-DD", "steps": 1234 }, ...]
-- 受け付けるのは月初または 7 日前の早いほうから今日まで。コインは直近 7 日分だけ。値は減らさない（大きいほうを残す）
create or replace function public.sync_steps(p_source text, p_days jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_today date := private.jst_today();
  v_from date := least(private.jst_today() - 6, pg_catalog.date_trunc('month', private.jst_today()::timestamp)::date);
  v_source public.step_source;
  v_day jsonb;
  v_date date;
  v_steps numeric;
  v_synced integer := 0;
  v_awarded integer := 0;
begin
  begin
    v_source := p_source::public.step_source;
  exception when others then
    perform private.fail('invalid_input', '歩数の取得元が正しくありません。');
  end;
  if v_source is null then perform private.fail('invalid_input', '歩数の取得元が正しくありません。'); end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 62 then
    perform private.fail('invalid_input', '歩数のデータが正しくありません。');
  end if;

  perform private.lock_user(v_uid);
  for v_day in select value from jsonb_array_elements(p_days) loop
    -- クライアントからの値は信用しない。形が正しく、範囲内のものだけ受け付ける
    continue when jsonb_typeof(v_day) <> 'object'
               or coalesce(v_day ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
               or jsonb_typeof(v_day -> 'steps') is distinct from 'number';
    begin
      v_date := (v_day ->> 'date')::date;
    exception when others then
      continue;
    end;
    v_steps := (v_day ->> 'steps')::numeric;
    continue when v_date > v_today or v_date < v_from or v_steps <> trunc(v_steps) or v_steps < 0 or v_steps > 100000;

    insert into public.step_records (user_id, step_date, raw_steps, source, verification, synced_at)
    values (v_uid, v_date, v_steps::integer, v_source,
            case when v_source = 'demo' then 'excluded'::public.step_verification else 'pending'::public.step_verification end,
            pg_catalog.now())
    on conflict (user_id, step_date) do update
       set raw_steps = greatest(public.step_records.raw_steps, excluded.raw_steps),
           source = excluded.source,
           synced_at = excluded.synced_at,
           -- 信頼済み（trusted）はこの関数では付けない。デモの歩数を含む日は対象外（excluded）
           verification = case when excluded.source = 'demo' or public.step_records.demo_added_steps > 0
                               then 'excluded'::public.step_verification else 'pending'::public.step_verification end;
    v_synced := v_synced + 1;
    v_awarded := v_awarded + private.award_step_coins(v_uid, v_date);
  end loop;

  insert into public.activity_days (user_id, active_date) values (v_uid, v_today) on conflict do nothing;
  return jsonb_build_object('source', v_source, 'syncedDays', v_synced, 'awardedPoints', v_awarded,
                            'syncedAt', private.iso(pg_catalog.now()), 'balance', private.balance_json(v_uid));
end;
$$;

-- PointBalance
create or replace function public.get_point_balance()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return private.balance_json(private.require_uid());
end;
$$;

-- ログインボーナス（日本時間で 1 日 1 回、10 コイン）
create or replace function public.claim_login_bonus()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_key text := private.date_key(private.jst_today());
begin
  perform private.lock_user(v_uid);
  if exists (select 1 from public.coin_transactions where user_id = v_uid and reason = 'login_bonus' and ref_key = v_key) then
    return jsonb_build_object('granted', false, 'amount', 0, 'balance', private.balance_json(v_uid));
  end if;
  perform private.add_coins(v_uid, 10, 'login_bonus', v_key);
  return jsonb_build_object('granted', true, 'amount', 10, 'balance', private.balance_json(v_uid));
end;
$$;

-- ---- ガチャ ----

-- 通常ガチャ 1 回（50 コイン）。抽選・消費・付与・重複の変換を 1 つのトランザクションで行う
create or replace function public.draw_gacha()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_cost constant integer := 50;
  v_balance integer;
  v_r double precision;
  v_rarity public.rarity;
  v_refund_coins integer;
  v_count integer;
  v_item_id text;
  v_draw_id uuid := pg_catalog.gen_random_uuid();
  v_dup boolean;
  v_refund integer := 0;
begin
  perform private.lock_user(v_uid);
  select balance into v_balance from public.coin_balances where user_id = v_uid;
  if v_balance < v_cost then
    perform private.fail('insufficient_points', 'コインが足りません。あと ' || (v_cost - v_balance) || ' コインでガチャを引けます。');
  end if;

  -- レア度を決める（確率の累積和）
  v_r := private.secure_random();
  select rarity, duplicate_coins into v_rarity, v_refund_coins from (
    select rarity, duplicate_coins, sum(probability) over (order by sort_order) as cumulative
      from public.gacha_rates
  ) x where v_r < cumulative order by cumulative limit 1;
  if v_rarity is null then
    -- 浮動小数の端数で外れたときは最後のレア度
    select rarity, duplicate_coins into v_rarity, v_refund_coins from public.gacha_rates order by sort_order desc limit 1;
  end if;

  -- そのレア度のガチャ対象から同じ確率で 1 つ
  select count(*) into v_count from public.items where acquisition = 'gacha' and rarity = v_rarity;
  if v_count = 0 then perform private.fail('server_error', 'ガチャの設定に誤りがあります。'); end if;
  select item_id into v_item_id from public.items where acquisition = 'gacha' and rarity = v_rarity
   order by item_id offset floor(private.secure_random() * v_count)::integer limit 1;

  v_dup := exists (select 1 from public.inventory where user_id = v_uid and item_id = v_item_id);
  perform private.add_coins(v_uid, -v_cost, 'gacha_draw', v_draw_id::text);
  if v_dup then
    -- 重複は所持せず、レア度に応じたコインに変換する
    v_refund := v_refund_coins;
    if v_refund > 0 then perform private.add_coins(v_uid, v_refund, 'gacha_refund', v_draw_id::text); end if;
  else
    insert into public.inventory (user_id, item_id, acquired_via) values (v_uid, v_item_id, 'gacha');
  end if;
  insert into public.gacha_draws (draw_id, user_id, item_id, rarity, is_duplicate, cost, refund)
  values (v_draw_id, v_uid, v_item_id, v_rarity, v_dup, v_cost, v_refund);

  select balance into v_balance from public.coin_balances where user_id = v_uid;
  return jsonb_build_object('drawId', v_draw_id, 'itemId', v_item_id, 'rarity', v_rarity, 'isDuplicate', v_dup,
                            'cost', v_cost, 'refund', v_refund, 'balance', v_balance);
end;
$$;

-- ---- 観光 ----

-- GPS チェックイン。座標は判定にだけ使い、保存しない。
-- 注意：位置はブラウザが送る値なので、位置を偽装するツールを使った不正は完全には防げない
create or replace function public.check_in(
  p_spot_id text, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision,
  p_via text default 'list', p_quest_id text default null, p_demo_location boolean default false
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  s public.spots;
  v_lat double precision;
  v_lng double precision;
  v_acc double precision;
  v_h double precision;
  v_distance integer;
  v_allowed integer;
  v_existing public.visits;
  v_quest_id uuid;
  v_via public.visit_via := 'list';
  v_visit public.visits;
begin
  select * into s from public.spots where spot_id = p_spot_id;
  if not found then perform private.fail('not_found', 'スポットが見つかりません。'); end if;

  if coalesce(p_demo_location, false) then
    -- デモ用チェックイン（現地確認なし）はデモ用アカウントだけ
    perform private.require_demo(v_uid);
    v_lat := s.latitude; v_lng := s.longitude; v_acc := 10;
  else
    v_lat := p_latitude; v_lng := p_longitude; v_acc := p_accuracy_m;
  end if;
  if v_lat is null or v_lng is null or v_lat = 'NaN'::float8 or v_lng = 'NaN'::float8
     or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    perform private.fail('invalid_input', '位置情報が正しくありません。');
  end if;
  if v_acc is null or v_acc = 'NaN'::float8 or v_acc > 200 then
    -- NaN・無限大は JSON にできないため null で返す
    return jsonb_build_object('status', 'low_accuracy',
                              'accuracyM', case when v_acc is null or v_acc = 'NaN'::float8 or v_acc = 'Infinity'::float8 then null
                                                else round(v_acc::numeric) end);
  end if;

  -- ハバーサイン式（地球の半径 6,371,000 m）
  v_h := power(sin(radians(v_lat - s.latitude) / 2), 2)
       + cos(radians(s.latitude)) * cos(radians(v_lat)) * power(sin(radians(v_lng - s.longitude) / 2), 2);
  v_distance := round(2 * 6371000 * asin(least(1, sqrt(v_h))))::integer;
  v_allowed := s.checkin_radius_m + least(greatest(0, v_acc), 50)::integer;
  if v_distance > v_allowed then
    return jsonb_build_object('status', 'too_far', 'distanceM', v_distance, 'allowedM', v_allowed);
  end if;

  perform private.lock_user(v_uid);
  select * into v_existing from public.visits where user_id = v_uid and spot_id = s.spot_id;
  if found then
    return jsonb_build_object('status', 'success', 'distanceM', v_distance, 'visit', private.visit_json(v_existing),
                              'rewardItemId', null, 'firstVisit', false);
  end if;

  -- AI 経由と認めるのは、サーバーが本人に提案したクエスト（ai_quests）に、このスポットが含まれるときだけ
  if p_via = 'ai_quest' and p_quest_id ~ '^[0-9a-fA-F-]{36}$' then
    select quest_id into v_quest_id from public.ai_quests
     where quest_id = p_quest_id::uuid and user_id = v_uid and s.spot_id = any (spot_ids);
    if v_quest_id is not null then v_via := 'ai_quest'; end if;
  end if;

  insert into public.visits (user_id, spot_id, via, quest_id, verified)
  values (v_uid, s.spot_id, v_via, v_quest_id, not coalesce(p_demo_location, false))
  returning * into v_visit;
  -- 限定アイテムは初回の訪問でだけ付与する
  insert into public.inventory (user_id, item_id, acquired_via) values (v_uid, s.reward_item_id, 'spot')
  on conflict (user_id, item_id) do nothing;
  return jsonb_build_object('status', 'success', 'distanceM', v_distance, 'visit', private.visit_json(v_visit),
                            'rewardItemId', s.reward_item_id, 'firstVisit', true);
end;
$$;

-- ---- ランキング ----

-- RankingResult。p_scope：all / ehime / friends、p_mode：web（trusted＋pending）/ official（trusted だけ）
-- 正式（official）は、その週の記録がすべて trusted の人だけ。Web 版（web）は excluded の日がない人だけ。
-- どちらもデモ用アカウントと、キャラクター作成前の人は入れない。上位 100 人まで
create or replace function public.get_ranking(p_scope text, p_mode text default 'web')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_today date := private.jst_today();
  v_week date := private.week_start(private.jst_today());
  v_me public.profiles;
  v_entries jsonb;
  v_total integer;
  v_ranked integer;
  v_records integer;
  v_trusted integer;
  v_excluded integer;
  v_opted_out boolean;
  v_eligible boolean;
  v_reason text;
  v_ref_rank integer;
begin
  if p_scope is null or p_scope not in ('all', 'ehime', 'friends') then
    perform private.fail('invalid_input', 'ランキングの種類が正しくありません。');
  end if;
  if p_mode is null or p_mode not in ('web', 'official') then
    perform private.fail('invalid_input', 'ランキングの種類が正しくありません。');
  end if;
  select * into v_me from public.profiles where user_id = v_uid;

  with candidates as (
    select p.user_id, p.username, p.title_id
      from public.profiles p
     where p.onboarded and not p.is_demo
       and (p_scope <> 'ehime' or (p.ehime_ranking_opt_in and p.selected_region = '38'))
       and (p_scope <> 'friends' or p.user_id = v_uid or exists (
             select 1 from public.friendships f
              where f.status = 'accepted' and f.user_low = least(v_uid, p.user_id) and f.user_high = greatest(v_uid, p.user_id)))
  ), sums as (
    select c.user_id,
           count(s.step_date) as records,
           count(s.step_date) filter (where s.verification = 'trusted') as trusted_days,
           count(s.step_date) filter (where s.verification = 'excluded') as excluded_days,
           coalesce(sum(s.steps) filter (where s.verification = 'trusted' or (p_mode = 'web' and s.verification = 'pending')), 0)::integer as weekly
      from candidates c
      left join public.step_records s on s.user_id = c.user_id and s.step_date between v_week and v_today
     group by c.user_id
  ), eligible as (
    select * from sums
     where (p_mode = 'official' and records > 0 and trusted_days = records)
        or (p_mode = 'web' and excluded_days = 0)
  ), shown as (
    select e.user_id, e.weekly, rank() over (order by e.weekly desc) as rnk
      from eligible e
     where e.weekly > 0 or p_scope = 'friends'
     order by e.weekly desc, e.user_id
     limit 100
  )
  select coalesce(jsonb_agg(
           private.public_user_json(sh.user_id)
             || jsonb_build_object('rank', sh.rnk, 'weeklySteps', sh.weekly, 'isMe', sh.user_id = v_uid, 'isSample', false)
           order by sh.rnk, sh.user_id), '[]'::jsonb)
    into v_entries
    from shown sh;

  -- 自分の状況
  select count(*), count(*) filter (where verification = 'trusted'), count(*) filter (where verification = 'excluded'),
         coalesce(sum(steps), 0)::integer
    into v_records, v_trusted, v_excluded, v_total
    from public.step_records where user_id = v_uid and step_date between v_week and v_today;
  v_ranked := private.weekly_steps(v_uid, p_mode);
  v_opted_out := p_scope = 'ehime' and not v_me.ehime_ranking_opt_in;
  v_eligible := v_me.onboarded and not v_me.is_demo and not v_opted_out
                and ((p_mode = 'official' and v_records > 0 and v_trusted = v_records) or (p_mode = 'web' and v_excluded = 0));
  v_reason := case
    when v_eligible then null
    when v_opted_out then 'not_opted_in'
    when v_me.is_demo or v_excluded > 0 then 'demo_data'
    else 'unverified' end;
  select 1 + count(*) into v_ref_rank
    from jsonb_array_elements(v_entries) e
   where not (e ->> 'isMe')::boolean and (e ->> 'weeklySteps')::integer > v_total;

  return jsonb_build_object(
    'scope', p_scope,
    'mode', p_mode,
    'weekStart', private.date_key(v_week),
    'entries', v_entries,
    'me', jsonb_build_object('weeklySteps', v_total, 'rankedSteps', v_ranked, 'eligible', v_eligible, 'referenceRank', v_ref_rank)
          || case when v_reason is null then '{}'::jsonb else jsonb_build_object('excludedReason', v_reason) end
  );
end;
$$;

-- ---- フレンド ----

create or replace function public.get_friends()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return private.friends_json(private.require_uid());
end;
$$;

-- FriendCandidate（見つからなければ null）。名前・見た目・称号・関係だけを返す
create or replace function public.find_user_by_friend_code(p_friend_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_code text := private.normalize_friend_code(p_friend_code);
  v_other uuid;
begin
  if v_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    perform private.fail('invalid_input', 'フレンドコードは英数字8文字で入力してください。');
  end if;
  select user_id into v_other from public.profiles where friend_code = v_code;
  if not found then return null; end if;
  return private.public_user_json(v_other) || jsonb_build_object('relation', private.relation(v_uid, v_other));
end;
$$;

-- フレンド申請。相手から申請が届いていれば、そのままフレンドになる
create or replace function public.send_friend_request(p_friend_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_code text := private.normalize_friend_code(p_friend_code);
  v_other uuid;
  f public.friendships;
begin
  if v_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    perform private.fail('invalid_input', 'フレンドコードは英数字8文字で入力してください。');
  end if;
  select user_id into v_other from public.profiles where friend_code = v_code;
  if not found then perform private.fail('not_found', 'このフレンドコードのユーザーは見つかりませんでした。'); end if;
  if v_other = v_uid then perform private.fail('invalid_input', '自分のフレンドコードです。'); end if;

  -- 2 人の組ごとのロック（お互いに同時に申請しても 1 行になる）
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(v_uid, v_other)::text || greatest(v_uid, v_other)::text, 0));
  select * into f from public.friendships where user_low = least(v_uid, v_other) and user_high = greatest(v_uid, v_other);
  if found and f.status = 'accepted' then
    perform private.fail('invalid_input', 'すでにフレンドです。');
  elsif found and f.requested_by = v_other then
    if (select count(*) from public.friendships where v_uid in (user_low, user_high) and status = 'accepted') >= 100
       or (select count(*) from public.friendships where v_other in (user_low, user_high) and status = 'accepted') >= 100 then
      perform private.fail('invalid_input', 'フレンドは100人までです。');
    end if;
    update public.friendships set status = 'accepted', responded_at = pg_catalog.now()
     where user_low = f.user_low and user_high = f.user_high;
  elsif not found then
    if (select count(*) from public.friendships
         where v_uid in (user_low, user_high) and (status = 'accepted' or requested_by = v_uid)) >= 100 then
      perform private.fail('invalid_input', 'フレンドと申請中の人数は100人までです。');
    end if;
    insert into public.friendships (user_low, user_high, requested_by)
    values (least(v_uid, v_other), greatest(v_uid, v_other), v_uid);
  end if;
  -- 自分が申請中の場合は何もしない
  return private.friends_json(v_uid);
end;
$$;

-- 届いた申請に答える（p_accept = false なら見送る）
create or replace function public.respond_friend_request(p_user_id uuid, p_accept boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  f public.friendships;
begin
  if p_user_id is null or p_user_id = v_uid then perform private.fail('not_found', 'この申請は見つかりませんでした。'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(v_uid, p_user_id)::text || greatest(v_uid, p_user_id)::text, 0));
  select * into f from public.friendships where user_low = least(v_uid, p_user_id) and user_high = greatest(v_uid, p_user_id);
  if not found or f.status <> 'pending' or f.requested_by <> p_user_id then
    perform private.fail('not_found', 'この申請は見つかりませんでした。');
  end if;
  if coalesce(p_accept, false) then
    if (select count(*) from public.friendships where v_uid in (user_low, user_high) and status = 'accepted') >= 100
       or (select count(*) from public.friendships where p_user_id in (user_low, user_high) and status = 'accepted') >= 100 then
      perform private.fail('invalid_input', 'フレンドは100人までです。');
    end if;
    update public.friendships set status = 'accepted', responded_at = pg_catalog.now()
     where user_low = f.user_low and user_high = f.user_high;
  else
    delete from public.friendships where user_low = f.user_low and user_high = f.user_high;
  end if;
  return private.friends_json(v_uid);
end;
$$;

-- フレンドの解除、または送った申請の取り消し
create or replace function public.remove_friend(p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  f public.friendships;
begin
  select * into f from public.friendships where user_low = least(v_uid, p_user_id) and user_high = greatest(v_uid, p_user_id);
  if not found or not (f.status = 'accepted' or f.requested_by = v_uid) then
    perform private.fail('not_found', 'フレンドが見つかりません。');
  end if;
  delete from public.friendships where user_low = f.user_low and user_high = f.user_high;
  delete from public.cheers where from_user = v_uid and to_user = p_user_id;
  return private.friends_json(v_uid);
end;
$$;

-- 応援。フレンドにだけ、定型の種類だけ。同じ相手には 1 日 3 回まで
create or replace function public.send_cheer(p_friend_user_id uuid, p_reaction text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_reaction public.cheer_reaction;
  v_today date := private.jst_today();
begin
  if private.relation(v_uid, p_friend_user_id) <> 'friend' then
    perform private.fail('not_found', 'フレンドが見つかりません。');
  end if;
  begin
    v_reaction := p_reaction::public.cheer_reaction;
  exception when others then
    perform private.fail('invalid_input', '送れない応援です。');
  end;
  if v_reaction is null then perform private.fail('invalid_input', '送れない応援です。'); end if;
  perform private.lock_user(v_uid);
  if (select count(*) from public.cheers where from_user = v_uid and to_user = p_friend_user_id and cheer_date = v_today) >= 3 then
    perform private.fail('invalid_input', '同じフレンドへの応援は1日3回までです。');
  end if;
  insert into public.cheers (from_user, to_user, reaction, cheer_date) values (v_uid, p_friend_user_id, v_reaction, v_today);
end;
$$;

-- ---- みんな共通のクエスト ----

create or replace function public.get_common_quests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return private.common_quest_statuses(private.require_uid());
end;
$$;

-- 報酬の受け取り（クエスト × 期間ごとに 1 回）。達成の判定はサーバーで行う
create or replace function public.claim_common_quest(p_quest_id text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  q public.common_quests;
  v_status jsonb;
  v_key text;
begin
  select * into q from public.common_quests where quest_id = p_quest_id;
  if not found then perform private.fail('not_found', 'クエストが見つかりません。'); end if;
  perform private.lock_user(v_uid);
  select s into v_status from jsonb_array_elements(private.common_quest_statuses(v_uid)) s where s -> 'quest' ->> 'questId' = q.quest_id;
  if not coalesce((v_status ->> 'completed')::boolean, false) then
    perform private.fail('invalid_input', 'まだクエストを達成していません。');
  end if;
  if coalesce((v_status ->> 'claimed')::boolean, false) then
    perform private.fail('invalid_input', 'この報酬はもう受け取りました。');
  end if;
  v_key := private.quest_period_key(q.period);
  insert into public.quest_claims (user_id, quest_id, period_key, reward_coins) values (v_uid, q.quest_id, v_key, q.reward_coins);
  perform private.add_coins(v_uid, q.reward_coins, 'quest_reward', q.quest_id || ':' || v_key);
  return jsonb_build_object('reward', q.reward_coins, 'balance', private.balance_json(v_uid),
                            'quests', private.common_quest_statuses(v_uid));
end;
$$;

-- ---- 利用状況・AI の残り回数 ----

-- ActivitySummary
create or replace function public.get_activity_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_goal integer;
begin
  select daily_goal into v_goal from public.profiles where user_id = v_uid;
  return jsonb_build_object(
    'activeDays', (select count(*) from public.activity_days where user_id = v_uid),
    'goalAchievedDays', (select count(*) from public.step_records where user_id = v_uid and steps >= v_goal),
    'recordedDays', (select count(*) from public.step_records where user_id = v_uid),
    'questGenerations', (select count(*) from public.ai_quests where user_id = v_uid),
    'visitsViaQuest', (select count(*) from public.visits where user_id = v_uid and via = 'ai_quest'),
    'visitsViaList', (select count(*) from public.visits where user_id = v_uid and via = 'list'),
    'gachaDraws', (select count(*) from public.gacha_draws where user_id = v_uid)
  );
end;
$$;

-- 今日の AI の残り回数（表示用。回数を減らすのは service_role の ai_quota_reserve だけ）
create or replace function public.get_ai_quota()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
begin
  return jsonb_build_object('remainingToday', greatest(0, private.ai_daily_limit() - private.ai_used_today(v_uid)),
                            'dailyLimit', private.ai_daily_limit());
end;
$$;

-- ---- データ削除 ----

-- 自分のデータをすべて消して、キャラクター作成前の状態に戻す（ログイン中のアカウントは残す）
create or replace function public.delete_my_data()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.lock_user(v_uid);
  perform private.reset_user_data(v_uid);
end;
$$;

-- ---- デモ操作（is_demo のアカウントだけ） ----

create or replace function public.demo_add_coins(p_amount integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.require_demo(v_uid);
  if p_amount is null or p_amount not in (100, 500, 1000) then
    perform private.fail('demo_unavailable', '追加できるコインの数ではありません。');
  end if;
  perform private.lock_user(v_uid);
  perform private.add_coins(v_uid, p_amount, 'demo_grant', null);
  insert into public.demo_history (user_id, kind, amount, awarded_coins) values (v_uid, 'coins', p_amount, p_amount);
  return private.balance_json(v_uid);
end;
$$;

-- 今日の歩数にデモの歩数を足す（その日は excluded になり、どのランキングにも入らない）
create or replace function public.demo_add_steps(p_steps integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_today date := private.jst_today();
  v_source public.step_source;
  v_awarded integer;
begin
  perform private.require_demo(v_uid);
  if p_steps is null or p_steps not in (100, 1000, 5000, 10000) then
    perform private.fail('demo_unavailable', '追加できる歩数ではありません。');
  end if;
  perform private.lock_user(v_uid);
  select source into v_source from public.step_records where user_id = v_uid and step_date = v_today;
  if v_source in ('healthkit', 'health_connect') then
    perform private.fail('demo_unavailable', '実際の歩数データには、デモの歩数を追加できません。');
  end if;
  insert into public.step_records (user_id, step_date, raw_steps, demo_added_steps, source, verification)
  values (v_uid, v_today, 0, p_steps, 'device_motion', 'excluded')
  on conflict (user_id, step_date) do update
     set demo_added_steps = least(100000, public.step_records.demo_added_steps + excluded.demo_added_steps),
         verification = 'excluded', synced_at = pg_catalog.now();
  v_awarded := private.award_step_coins(v_uid, v_today);
  insert into public.demo_history (user_id, kind, amount, awarded_coins) values (v_uid, 'steps', p_steps, v_awarded);
  return jsonb_build_object(
    'todaySteps', (select steps from public.step_records where user_id = v_uid and step_date = v_today),
    'awardedPoints', v_awarded,
    'balance', private.balance_json(v_uid));
end;
$$;

-- DemoHistoryEntry[]（新しい順）
create or replace function public.demo_get_history(p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'kind', h.kind, 'amount', h.amount, 'awardedCoins', h.awarded_coins,
                                        'createdAt', private.iso(h.created_at)) order by h.created_at desc)
      from (select * from public.demo_history where user_id = v_uid
             order by created_at desc limit least(greatest(coalesce(p_limit, 10), 1), 200)) h
  ), '[]'::jsonb);
end;
$$;

-- 発表用：データを消して、途中まで遊んだ状態にする（frontend の SHOWCASE と同じ内容。フレンドは作らない）
create or replace function public.demo_prepare_showcase()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_today date := private.jst_today();
  v_steps constant integer[] := array[5200, 7400, 6100, 9300, 4800, 8200, 3500];
  v_total_awarded integer := 0;
  i integer;
begin
  perform private.require_demo(v_uid);
  perform private.lock_user(v_uid);
  perform private.reset_user_data(v_uid);
  update public.profiles set username = 'デモユーザー', onboarded = true where user_id = v_uid;
  update public.characters set name = 'ミカン', hair_style = 'bob', hair_color = 'mikan', skin_tone = 'light', eye_color = 'brown'
   where user_id = v_uid;
  insert into public.inventory (user_id, item_id, acquired_via)
  select v_uid, x, 'gacha' from unnest(array['head_mikan_hat', 'pet_koromikan', 'bottom_seto_skirt', 'top_traveler',
                                              'accessory_mikan_pendant', 'bg_mikan_field']) x
  on conflict do nothing;
  insert into public.character_equipment (user_id, slot, item_id)
  values (v_uid, 'head', 'head_mikan_hat'), (v_uid, 'pet', 'pet_koromikan'), (v_uid, 'bottom', 'bottom_seto_skirt')
  on conflict (user_id, slot) do update set item_id = excluded.item_id;
  -- 過去 7 日分（古い順）は「デモ操作で追加した歩数」として入れる
  for i in 0..6 loop
    insert into public.step_records (user_id, step_date, raw_steps, demo_added_steps, source, verification)
    values (v_uid, v_today - 6 + i, 0, v_steps[i + 1], 'device_motion', 'excluded');
    v_total_awarded := v_total_awarded + private.award_step_coins(v_uid, v_today - 6 + i);
    insert into public.activity_days (user_id, active_date) values (v_uid, v_today - 6 + i) on conflict do nothing;
  end loop;
  perform private.add_coins(v_uid, 300, 'demo_grant', null);
  insert into public.demo_history (user_id, kind, amount, awarded_coins)
  values (v_uid, 'coins', 300, 300), (v_uid, 'steps', 44500, v_total_awarded);
  insert into public.visits (user_id, spot_id, visited_at, via, verified)
  values (v_uid, 'dogo_onsen_honkan', ((v_today - 2)::timestamp + interval '10 hours') at time zone 'Asia/Tokyo', 'list', false);
  insert into public.inventory (user_id, item_id, acquired_via) values (v_uid, 'top_onsen_yukata', 'spot') on conflict do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8c. service_role 専用の RPC（Vercel Functions などサーバー側だけが呼ぶ。ブラウザからは呼べない）
--     サーバーは、ブラウザから届いたアクセストークンを Supabase Auth で確かめてからユーザー ID を渡す
-- -----------------------------------------------------------------------------

-- AI の利用回数を 1 回分予約する。上限を超えるときは AI を呼ぶ前に断る
create or replace function public.ai_quota_reserve(p_user_id uuid, p_global_limit integer default 200)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := private.jst_today();
  v_used integer;
  v_global integer;
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where user_id = p_user_id) then
    perform private.fail('not_found', 'ユーザーが見つかりません。');
  end if;
  -- その日の予約を順番に処理する（同時に呼ばれても上限を超えない）
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ewq_ai_quota:' || private.date_key(v_today), 0));
  v_used := private.ai_used_today(p_user_id);
  if v_used >= private.ai_daily_limit() then
    return jsonb_build_object('ok', false, 'reason', 'user_limit', 'remainingToday', 0);
  end if;
  select count(*) into v_global from private.ai_quota_reservations where quota_date = v_today and status <> 'released';
  if v_global >= greatest(1, least(coalesce(p_global_limit, 200), 10000)) then
    return jsonb_build_object('ok', false, 'reason', 'global_limit', 'remainingToday', private.ai_daily_limit() - v_used);
  end if;
  insert into private.ai_quota_reservations (user_id, quota_date) values (p_user_id, v_today) returning reservation_id into v_id;
  return jsonb_build_object('ok', true, 'reservationId', v_id, 'remainingToday', private.ai_daily_limit() - v_used - 1);
end;
$$;

-- 予約を「使った」にし、提案したクエストを記録する（クエストが作れなかったときは p_quest_id を null にする）
create or replace function public.ai_quota_commit(
  p_reservation_id uuid, p_quest_id uuid default null, p_title text default null, p_spot_ids text[] default null,
  p_model text default null, p_generated_by text default 'bedrock'
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  r private.ai_quota_reservations;
begin
  select * into r from private.ai_quota_reservations where reservation_id = p_reservation_id for update;
  if not found or r.status <> 'reserved' then
    return false;
  end if;
  if p_quest_id is not null then
    if p_spot_ids is null or cardinality(p_spot_ids) not between 1 and 4
       or exists (select 1 from unnest(p_spot_ids) x where not exists (select 1 from public.spots s where s.spot_id = x)) then
      perform private.fail('invalid_input', '登録スポット以外は記録できません。');
    end if;
    insert into public.ai_quests (quest_id, user_id, title, spot_ids, model, generated_by, reservation_id)
    values (p_quest_id, r.user_id, left(coalesce(p_title, ''), 100), p_spot_ids, p_model, coalesce(p_generated_by, 'bedrock'), r.reservation_id);
  end if;
  update private.ai_quota_reservations set status = 'committed', finished_at = pg_catalog.now() where reservation_id = r.reservation_id;
  return true;
end;
$$;

-- AI に請求されない失敗のときだけ、予約を取り消して回数を戻す。
-- 戻せるのは「予約中」で、同じ日の、予約から 10 分以内のものだけ（何度も戻したり、後から戻したりできない）
create or replace function public.ai_quota_release(p_reservation_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  update private.ai_quota_reservations
     set status = 'released', finished_at = pg_catalog.now()
   where reservation_id = p_reservation_id
     and status = 'reserved'
     and quota_date = private.jst_today()
     and created_at > pg_catalog.now() - interval '10 minutes';
  return found;
end;
$$;

-- デモ用アカウントの設定（管理者だけ。SQL Editor か service_role から使う）
create or replace function public.admin_set_demo_account(p_user_id uuid, p_is_demo boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.profiles set is_demo = coalesce(p_is_demo, false), updated_at = pg_catalog.now() where user_id = p_user_id;
  if not found then perform private.fail('not_found', 'ユーザーが見つかりません。'); end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 効果検証用の集計（管理者だけが読める private スキーマ。5 人未満の日は出さない）
-- -----------------------------------------------------------------------------

create or replace view private.analytics_daily as
with days as (
  select active_date as day, count(distinct user_id) as active_users
    from public.activity_days group by active_date
)
select d.day,
       d.active_users,
       (select count(*) from public.ai_quests q where (q.created_at at time zone 'Asia/Tokyo')::date = d.day) as ai_quests,
       (select count(*) from public.visits v where (v.visited_at at time zone 'Asia/Tokyo')::date = d.day and v.via = 'ai_quest') as visits_via_quest,
       (select count(*) from public.visits v where (v.visited_at at time zone 'Asia/Tokyo')::date = d.day and v.via = 'list') as visits_via_list,
       (select count(*) from public.gacha_draws g where (g.created_at at time zone 'Asia/Tokyo')::date = d.day) as gacha_draws
  from days d
 where d.active_users >= 5;

-- -----------------------------------------------------------------------------
-- 権限
-- -----------------------------------------------------------------------------

-- private スキーマはクライアントから使えない
revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

-- テーブル：クライアントは読むだけ（書き込みは RPC だけ）。ユーザーデータは anon（未ログイン）には見せない
do $$
declare
  t text;
begin
  foreach t in array array['items', 'gacha_rates', 'spots', 'titles', 'common_quests'] loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
  end loop;
  foreach t in array array['profiles', 'characters', 'inventory', 'character_equipment', 'coin_balances', 'coin_transactions',
                           'step_records', 'gacha_draws', 'visits', 'friendships', 'cheers', 'quest_claims', 'ai_quests',
                           'activity_days', 'demo_history'] loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- 関数：既定の実行権限（PUBLIC・anon・authenticated）を外してから、必要なロールにだけ付ける
do $$
declare
  f record;
  user_rpcs constant text[] := array[
    'get_session', 'complete_onboarding', 'update_profile', 'update_character', 'equip_item', 'sync_steps',
    'get_point_balance', 'claim_login_bonus', 'draw_gacha', 'check_in', 'get_ranking', 'get_friends',
    'find_user_by_friend_code', 'send_friend_request', 'respond_friend_request', 'remove_friend', 'send_cheer',
    'get_common_quests', 'claim_common_quest', 'get_activity_summary', 'get_ai_quota', 'delete_my_data',
    'demo_add_coins', 'demo_add_steps', 'demo_get_history', 'demo_prepare_showcase'];
  service_rpcs constant text[] := array['ai_quota_reserve', 'ai_quota_commit', 'ai_quota_release', 'admin_set_demo_account'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (user_rpcs || service_rpcs || array['handle_new_user'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname = any (user_rpcs) then
      execute format('grant execute on function %s to authenticated', f.sig);
    elsif f.proname = any (service_rpcs) then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 9. マスタデータ（frontend/src/data・domain と同じ値。変えるときは両方を直す）
-- -----------------------------------------------------------------------------

insert into public.items (item_id, name, slot, rarity, acquisition, starter_choice, is_default_starter, sort_order) values
  -- 初期装備
  ('top_adventure_tee', 'ぼうけんTシャツ', 'top', 'N', 'starter', 'top', true, 1),
  ('top_leaf_tee', 'もりのTシャツ', 'top', 'N', 'starter', 'top', false, 2),
  ('top_sunrise_tee', 'あさやけTシャツ', 'top', 'N', 'starter', 'top', false, 3),
  ('bottom_denim', 'デニムパンツ', 'bottom', 'N', 'starter', 'bottom', true, 4),
  ('bottom_navy_skirt', 'ネイビースカート', 'bottom', 'N', 'starter', 'bottom', false, 5),
  ('shoes_travel_boots', '旅のブーツ', 'shoes', 'N', 'starter', null, true, 6),
  ('bg_seto_sea', '瀬戸内の海', 'background', 'N', 'starter', null, true, 7),
  -- ガチャ
  ('top_traveler', '旅人の服', 'top', 'N', 'gacha', null, false, 8),
  ('top_mikan_tee', 'みかん色のTシャツ', 'top', 'N', 'gacha', null, false, 9),
  ('bottom_seto_skirt', '瀬戸内スカート', 'bottom', 'N', 'gacha', null, false, 10),
  ('bottom_khaki_pants', 'カーキのパンツ', 'bottom', 'N', 'gacha', null, false, 11),
  ('shoes_white_sneakers', 'しろいスニーカー', 'shoes', 'N', 'gacha', null, false, 12),
  ('head_straw_hat', '麦わら帽子', 'head', 'N', 'gacha', null, false, 13),
  ('shoes_mikan_sneakers', 'みかんスニーカー', 'shoes', 'R', 'gacha', null, false, 14),
  ('head_mikan_hat', 'みかん帽子', 'head', 'R', 'gacha', null, false, 15),
  ('accessory_mikan_pendant', 'みかん型ペンダント', 'accessory', 'R', 'gacha', null, false, 16),
  ('bg_mikan_field', 'みかん畑', 'background', 'R', 'gacha', null, false, 17),
  ('bg_seto_sunset', '瀬戸内の夕焼け', 'background', 'R', 'gacha', null, false, 18),
  ('top_starry_cape', '星空のマント', 'top', 'SR', 'gacha', null, false, 19),
  ('pet_koromikan', 'ころみかん', 'pet', 'SR', 'gacha', null, false, 20),
  ('top_golden_haori', '黄金みかんの羽織', 'top', 'SSR', 'gacha', null, false, 21),
  ('head_golden_crown', '黄金みかんの冠', 'head', 'SSR', 'gacha', null, false, 22),
  -- 地域限定（スポットのチェックインで獲得）
  ('head_castle_kabuto', '城主の兜', 'head', 'SR', 'spot', null, false, 23),
  ('top_onsen_yukata', '温泉浴衣', 'top', 'SR', 'spot', null, false, 24),
  ('head_pirate_hat', '海賊風の帽子', 'head', 'SR', 'spot', null, false, 25),
  ('accessory_sunset_mantle', '夕焼けのマント', 'accessory', 'SR', 'spot', null, false, 26),
  ('top_samurai_armor', '武将衣装', 'top', 'SR', 'spot', null, false, 27)
on conflict (item_id) do update set
  name = excluded.name, slot = excluded.slot, rarity = excluded.rarity, acquisition = excluded.acquisition,
  starter_choice = excluded.starter_choice, is_default_starter = excluded.is_default_starter, sort_order = excluded.sort_order;

insert into public.gacha_rates (rarity, probability, duplicate_coins, sort_order) values
  ('N', 0.60, 5, 1),
  ('R', 0.30, 15, 2),
  ('SR', 0.09, 30, 3),
  ('SSR', 0.01, 50, 4)
on conflict (rarity) do update set
  probability = excluded.probability, duplicate_coins = excluded.duplicate_coins, sort_order = excluded.sort_order;

insert into public.spots (spot_id, name, prefecture_code, municipality_code, municipality, latitude, longitude,
                          checkin_radius_m, kind, tags, reward_item_id, sort_order) values
  ('matsuyama_castle', '松山城', '38', '38201', '松山市', 33.8456, 132.7656, 150, 'landmark', array['歴史', '城', '絶景'], 'head_castle_kabuto', 1),
  ('dogo_onsen_honkan', '道後温泉本館', '38', '38201', '松山市', 33.852, 132.7864, 100, 'culture', array['温泉', '歴史', '文化'], 'top_onsen_yukata', 2),
  ('imabari_castle', '今治城', '38', '38202', '今治市', 34.0656, 133.0054, 150, 'landmark', array['歴史', '城', '海'], 'head_pirate_hat', 3),
  ('shimonada_station', '下灘駅', '38', '38210', '伊予市', 33.65523, 132.58933, 100, 'landmark', array['絶景', '海'], 'accessory_sunset_mantle', 4),
  ('uwajima_castle', '宇和島城', '38', '38203', '宇和島市', 33.21948, 132.56524, 150, 'landmark', array['歴史', '城', '絶景'], 'top_samurai_armor', 5)
on conflict (spot_id) do update set
  name = excluded.name, prefecture_code = excluded.prefecture_code, municipality_code = excluded.municipality_code,
  municipality = excluded.municipality, latitude = excluded.latitude, longitude = excluded.longitude,
  checkin_radius_m = excluded.checkin_radius_m, kind = excluded.kind, tags = excluded.tags,
  reward_item_id = excluded.reward_item_id, sort_order = excluded.sort_order;

insert into public.titles (title_id, name, condition_text, unlock_kind, unlock_threshold, sort_order) values
  ('mikan_novice', 'みかん見習い', 'はじめから', 'always', 0, 1),
  ('gacha_debut', 'ガチャデビュー', 'ガチャを1回引く', 'gacha_draws', 1, 2),
  ('steady_walker', 'コツコツ歩き', '直近7日間で目標を3日達成', 'goal_days_last7', 3, 3),
  ('first_journey', 'はじめての旅人', '観光スポットに1か所チェックイン', 'visited_spots', 1, 4),
  ('ehime_explorer', '愛媛冒険家', '観光スポットに3か所チェックイン', 'visited_spots', 3, 5),
  ('collector', 'おしゃれコレクター', 'アイテムを10種類集める', 'owned_item_kinds', 10, 6)
on conflict (title_id) do update set
  name = excluded.name, condition_text = excluded.condition_text, unlock_kind = excluded.unlock_kind,
  unlock_threshold = excluded.unlock_threshold, sort_order = excluded.sort_order;

insert into public.common_quests (quest_id, title, description, kind, period, target, spot_ids, reward_coins, min_contribution, sort_order) values
  ('daily_3000', '今日の一歩', '今日 3,000 歩あるこう。体調に合わせて、無理のない範囲で。',
   'daily_steps', 'daily', 3000, null, 20, null, 1),
  ('weekly_30000', '今週のウォーキング', '今週（月曜から）合計 30,000 歩あるこう。1 日あたり約 4,300 歩です。',
   'weekly_steps', 'weekly', 30000, null, 100, null, 2),
  ('community_weekly', 'みんなで愛媛 50 万歩',
   '参加しているみんなの今週の歩数を合わせて 50 万歩をめざそう。自分が今週 1,000 歩以上歩いていれば報酬を受け取れます。',
   'community_steps', 'weekly', 500000, null, 50, 1000, 3),
  ('matsuyama_history', '松山 歴史めぐり', '松山城と道後温泉本館の両方を訪れよう。2 か所は歩いて約 40 分です。',
   'visit_spots', 'once', 2, array['matsuyama_castle', 'dogo_onsen_honkan'], 150, null, 4),
  ('ehime_first_step', '愛媛冒険の第一歩', '松山城・道後温泉本館・今治城の 3 か所を訪れよう。今治城は松山から電車やバスで行けます。',
   'visit_spots', 'once', 3, array['matsuyama_castle', 'dogo_onsen_honkan', 'imabari_castle'], 300, null, 5)
on conflict (quest_id) do update set
  title = excluded.title, description = excluded.description, kind = excluded.kind, period = excluded.period,
  target = excluded.target, spot_ids = excluded.spot_ids, reward_coins = excluded.reward_coins,
  min_contribution = excluded.min_contribution, sort_order = excluded.sort_order;
