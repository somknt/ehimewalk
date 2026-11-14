-- =============================================================================
-- 001_initial_schema.sql の動作確認（RPC・RLS・二重付与の防止）
--
-- 使い方：migrations/001_initial_schema.sql を実行したあとに、このファイルを SQL Editor に貼って実行する。
-- - 全体を 1 つのトランザクションで実行し、最後に ROLLBACK するので、データは残らない
-- - 途中で失敗すると「NG: …」というエラーで止まる。最後まで通れば成功（"Success. No rows returned" など）
-- - テスト用のユーザーを auth.users に 3 人作る（a・b・c。c はデモ用アカウント）
-- - 他の利用者のデータが入っている環境で実行すると、「みんなのクエスト」の合計などの確認が合わないことがある
-- - 同時実行（ガチャの連打など）は 1 つの接続では確かめられないため、ここでは確認しない
-- =============================================================================

begin;

create schema ewq_test;
create table ewq_test.vals (name text primary key, val text);
grant usage on schema ewq_test to anon, authenticated, service_role;
grant select, insert, update on ewq_test.vals to anon, authenticated, service_role;

create function ewq_test.ok(p_cond boolean, p_label text) returns text language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'NG: %', p_label;
  end if;
  raise notice 'OK: %', p_label;
  return 'OK: ' || p_label;
end;
$$;

-- p_sql がエラーになり、そのメッセージが p_pattern（LIKE）に合うことを確かめる
create function ewq_test.raises(p_sql text, p_pattern text, p_label text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_pattern then
      raise notice 'OK: %', p_label;
      return 'OK: ' || p_label;
    end if;
    raise exception 'NG: %（想定と違うエラー：%）', p_label, sqlerrm;
  end;
  raise exception 'NG: %（エラーになりませんでした）', p_label;
end;
$$;

create function ewq_test.v(p_name text) returns text language sql as $$
  select val from ewq_test.vals where name = p_name;
$$;
create function ewq_test.id(p_name text) returns uuid language sql as $$
  select val::uuid from ewq_test.vals where name = p_name;
$$;
-- このトランザクションの中で、指定したユーザーとして JWT を設定する（role は別に SET ROLE で切り替える）
create function ewq_test.as_user(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', ewq_test.id(p_name), 'role', 'authenticated')::text, true);
  select null::void;
$$;
grant execute on all functions in schema ewq_test to anon, authenticated, service_role;

insert into ewq_test.vals values
  ('a', gen_random_uuid()::text), ('b', gen_random_uuid()::text), ('c', gen_random_uuid()::text),
  ('today', to_char((now() at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD')),
  ('tomorrow', to_char((now() at time zone 'Asia/Tokyo')::date + 1, 'YYYY-MM-DD'));

-- ---- 1. 新規登録でプロフィールが自動で作られる ----
insert into auth.users (id, aud, role, email)
select val::uuid, 'authenticated', 'authenticated', name || '@ewq.example' from ewq_test.vals where name in ('a', 'b', 'c');

select ewq_test.ok((select count(*) from public.profiles where user_id in (ewq_test.id('a'), ewq_test.id('b'), ewq_test.id('c'))) = 3,
                   'プロフィールが自動で作られる');
select ewq_test.ok((select bool_and(friend_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$') and count(distinct friend_code) = 3
                      from public.profiles where user_id in (ewq_test.id('a'), ewq_test.id('b'), ewq_test.id('c'))),
                   'フレンドコードは8文字で、重ならない');
select ewq_test.ok((select count(*) from public.inventory where user_id = ewq_test.id('a')) = 4
                   and (select count(*) from public.character_equipment where user_id = ewq_test.id('a')) = 4
                   and (select balance from public.coin_balances where user_id = ewq_test.id('a')) = 0,
                   '初期衣装4つを持って装備し、コインは0');
select ewq_test.ok((select count(distinct c) = 3000 and bool_and(c ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$')
                      from (select private.random_friend_code() as c from generate_series(1, 3000)) x),
                   'フレンドコードを3000個作っても重ならない');
insert into ewq_test.vals select 'code_a', friend_code from public.profiles where user_id = ewq_test.id('a');
select public.admin_set_demo_account(ewq_test.id('c'), true);

-- ---- 2. 未ログイン（anon）は RPC を呼べない ----
set local role anon;
select ewq_test.raises('select public.get_session()', 'permission denied%', '未ログインでは get_session を呼べない');
select ewq_test.ok((select count(*) from public.items) = 27, '未ログインでもマスタは読める');
reset role;

-- ---- 3. ユーザー a：キャラクター作成・歩数・コイン ----
select ewq_test.as_user('a');
set local role authenticated;

select ewq_test.ok((public.get_session() -> 'profile' ->> 'onboarded')::boolean = false, '作成前は onboarded = false');
select ewq_test.raises('select public.draw_gacha()', 'insufficient_points', 'コインが足りないとガチャを引けない');
select ewq_test.raises($$select public.complete_onboarding('あ', 'ミカン', '{"hairStyle":"bob","hairColor":"mikan","skinTone":"light","eyeColor":"brown"}', 'head_castle_kabuto', 'bottom_denim')$$,
                       'invalid_input', '初期衣装以外は選べない');
select ewq_test.ok((public.complete_onboarding('てすとA', 'ミカン', '{"hairStyle":"bob","hairColor":"mikan","skinTone":"light","eyeColor":"brown"}', 'top_leaf_tee', 'bottom_navy_skirt')
                    -> 'character' -> 'equipped' ->> 'top') = 'top_leaf_tee', 'キャラクターを作成し、選んだ服を装備する');
select ewq_test.raises($$select public.complete_onboarding('てすとA', 'ミカン', '{"hairStyle":"bob","hairColor":"mikan","skinTone":"light","eyeColor":"brown"}', 'top_leaf_tee', 'bottom_denim')$$,
                       'invalid_input', 'キャラクター作成は1回だけ');

select ewq_test.ok((public.sync_steps('device_motion', jsonb_build_array(jsonb_build_object('date', ewq_test.v('today'), 'steps', 12345))) ->> 'awardedPoints')::integer = 123,
                   '12,345歩で123コイン');
select ewq_test.ok((public.sync_steps('device_motion', jsonb_build_array(jsonb_build_object('date', ewq_test.v('today'), 'steps', 12345))) ->> 'awardedPoints')::integer = 0,
                   '同じ歩数で同期し直してもコインは増えない');
select ewq_test.ok((public.sync_steps('device_motion', jsonb_build_array(jsonb_build_object('date', ewq_test.v('today'), 'steps', 6000))) ->> 'awardedPoints')::integer = 0
                   and (select steps from public.step_records where step_date = ewq_test.v('today')::date) = 12345,
                   '少ない歩数が届いても減らさない');
select ewq_test.ok((public.sync_steps('device_motion', jsonb_build_array(
                      jsonb_build_object('date', ewq_test.v('tomorrow'), 'steps', 5000),
                      jsonb_build_object('date', ewq_test.v('today'), 'steps', 150000),
                      jsonb_build_object('date', 'abc', 'steps', 100),
                      jsonb_build_object('date', ewq_test.v('today'), 'steps', -1))) ->> 'syncedDays')::integer = 0,
                   '未来の日付・10万歩超・形の違う値は受け付けない');
select ewq_test.ok((select verification = 'pending' from public.step_records where step_date = ewq_test.v('today')::date),
                   'センサーの歩数は pending');

select ewq_test.ok((public.claim_login_bonus() ->> 'granted')::boolean, 'ログインボーナスを受け取れる');
select ewq_test.ok(not (public.claim_login_bonus() ->> 'granted')::boolean
                   and (public.get_point_balance() ->> 'balance')::integer = 133, 'ログインボーナスは1日1回');

select ewq_test.ok((public.claim_common_quest('daily_3000') ->> 'reward')::integer = 20, '今日の一歩の報酬を受け取れる');
select ewq_test.raises($$select public.claim_common_quest('daily_3000')$$, 'invalid_input', 'クエスト報酬は1回だけ');
select ewq_test.raises($$select public.claim_common_quest('matsuyama_history')$$, 'invalid_input', '達成していないクエストは受け取れない');
select ewq_test.raises($$select public.claim_common_quest('nothing')$$, 'not_found', '存在しないクエスト');

-- ガチャ（153 → 103）
select ewq_test.ok((public.draw_gacha() ->> 'cost')::integer = 50, 'ガチャを引ける');
select ewq_test.ok((select balance from public.coin_balances) = (select sum(amount) from public.coin_transactions)
                   and (select count(*) from public.gacha_draws) = 1, '残高と取引の合計が一致する');
reset role;

-- ガチャの対象をすべて持たせて、重複の変換を確かめる
insert into public.inventory (user_id, item_id, acquired_via)
select ewq_test.id('a'), item_id, 'gacha' from public.items where acquisition = 'gacha' on conflict do nothing;
insert into ewq_test.vals select 'balance_before_dup', balance::text from public.coin_balances where user_id = ewq_test.id('a');
select ewq_test.as_user('a');
set local role authenticated;
insert into ewq_test.vals select 'dup', public.draw_gacha()::text;
select ewq_test.ok((ewq_test.v('dup')::jsonb ->> 'isDuplicate')::boolean
                   and (ewq_test.v('dup')::jsonb ->> 'refund')::integer
                       = (select duplicate_coins from public.gacha_rates where rarity::text = ewq_test.v('dup')::jsonb ->> 'rarity')
                   and (ewq_test.v('dup')::jsonb ->> 'balance')::integer
                       = ewq_test.v('balance_before_dup')::integer - 50 + (ewq_test.v('dup')::jsonb ->> 'refund')::integer,
                   '持っているアイテムが出たらレア度に応じたコインに変換する');
select ewq_test.ok((select count(*) from public.inventory where item_id = ewq_test.v('dup')::jsonb ->> 'itemId') = 1, '重複したアイテムは増えない');

-- 着せ替え
select ewq_test.ok((public.equip_item('head', 'head_straw_hat') -> 'equipped' ->> 'head') = 'head_straw_hat', '持っているアイテムを装備できる');
select ewq_test.raises($$select public.equip_item('head', 'head_castle_kabuto')$$, 'item_not_owned', '持っていないアイテムは装備できない');
select ewq_test.raises($$select public.equip_item('head', 'top_leaf_tee')$$, 'invalid_slot', 'スロットが合わないアイテムは装備できない');
select ewq_test.raises($$select public.equip_item('wing', 'top_leaf_tee')$$, 'invalid_slot', '存在しないスロット');
select ewq_test.ok(public.equip_item('head', null) -> 'equipped' -> 'head' is null, '装備を外せる');

-- チェックイン（松山城）
select ewq_test.ok((public.check_in('matsuyama_castle', 33.8456, 132.7656, 10) ->> 'firstVisit')::boolean, '現地でチェックインできる');
-- 関数の書き込みは、同じ文の中の別の問い合わせからは見えないため、文を分けて確かめる
select ewq_test.ok(exists (select 1 from public.inventory where item_id = 'head_castle_kabuto'), '初回のチェックインで限定アイテムがもらえる');
select ewq_test.ok(not (public.check_in('matsuyama_castle', 33.8456, 132.7656, 10) ->> 'firstVisit')::boolean, '2回目は限定アイテムなし');
select ewq_test.ok((public.check_in('dogo_onsen_honkan', 35.68, 139.76, 10) ->> 'status') = 'too_far', '遠い場所からはチェックインできない');
select ewq_test.ok((public.check_in('dogo_onsen_honkan', 33.852, 132.7864, 500) ->> 'status') = 'low_accuracy', '誤差が200mを超えると判定しない');
select ewq_test.raises($$select public.check_in('dogo_onsen_honkan', 0, 0, 0, 'list', null, true)$$, 'demo_unavailable',
                       'デモ用チェックインは一般のアカウントでは使えない');
select ewq_test.ok(not exists (select 1 from information_schema.columns
                                where table_schema = 'public' and table_name = 'visits' and column_name in ('latitude', 'longitude')),
                   '訪問の記録に座標の列がない');

-- 称号
select ewq_test.ok((public.update_profile('{"titleId":"first_journey"}') -> 'profile' ->> 'title') = 'はじめての旅人', '獲得した称号を選べる');
select ewq_test.raises($$select public.update_profile('{"titleId":"ehime_explorer"}')$$, 'invalid_input', '獲得していない称号は選べない');
select ewq_test.raises($$select public.update_profile('{"dailyGoal":50000}')$$, 'invalid_input', '目標は1,000〜20,000歩');
reset role;

-- ---- 4. フレンド（b → a に申請、a が承認） ----
select ewq_test.as_user('b');
set local role authenticated;
select public.complete_onboarding('てすとB', 'ユズ', '{"hairStyle":"short","hairColor":"black","skinTone":"tan","eyeColor":"black"}', 'top_adventure_tee', 'bottom_denim');
select ewq_test.ok((public.find_user_by_friend_code(lower(substr(ewq_test.v('code_a'), 1, 4) || '-' || substr(ewq_test.v('code_a'), 5))) ->> 'relation') = 'none',
                   '小文字・ハイフン付きのフレンドコードで探せる');
select ewq_test.ok(public.find_user_by_friend_code('ZZZZZZZZ') is null, '存在しないコードは null');
select ewq_test.raises($$select public.find_user_by_friend_code('ABC')$$, 'invalid_input', '8文字でないコードはエラー');
select ewq_test.ok(jsonb_array_length(public.send_friend_request(ewq_test.v('code_a')) -> 'outgoing') = 1, 'フレンド申請を送れる');
select ewq_test.ok((public.find_user_by_friend_code(ewq_test.v('code_a')) -> 'weeklySteps') is null, '申請中の相手の歩数は見えない');

-- RLS：他人の行は見えず、直接は書き込めない
select ewq_test.ok((select count(*) from public.coin_transactions where user_id = ewq_test.id('a')) = 0, '他人のコイン履歴は見えない');
select ewq_test.ok((select count(*) from public.profiles) = 1, '他人のプロフィールは直接は見えない');
select ewq_test.ok((select count(*) from public.step_records where user_id = ewq_test.id('a')) = 0, '他人の歩数は見えない');
select ewq_test.raises('update public.coin_balances set balance = 99999', 'permission denied%', 'コイン残高を直接変更できない');
select ewq_test.raises($$insert into public.inventory (user_id, item_id, acquired_via) values (auth.uid(), 'top_golden_haori', 'gacha')$$,
                       'permission denied%', '所持アイテムを直接追加できない');
select ewq_test.raises('select * from private.ai_quota_reservations', 'permission denied%', 'private スキーマは読めない');
select ewq_test.raises($$select public.ai_quota_reserve(auth.uid())$$, 'permission denied%', 'AI の回数を予約する関数は呼べない');
select ewq_test.raises($$select public.ai_quota_release(gen_random_uuid())$$, 'permission denied%', 'AI の回数を戻す関数は呼べない');
select ewq_test.raises($$select public.admin_set_demo_account(auth.uid(), true)$$, 'permission denied%', '自分をデモ用アカウントにできない');
reset role;

select ewq_test.as_user('a');
set local role authenticated;
select ewq_test.ok(jsonb_array_length(public.get_friends() -> 'incoming') = 1, '届いた申請が見える');
select ewq_test.ok(jsonb_array_length(public.respond_friend_request(ewq_test.id('b'), true) -> 'friends') = 1, '申請を承認できる');
select public.send_cheer(ewq_test.id('b'), 'nice');
select public.send_cheer(ewq_test.id('b'), 'fight');
select public.send_cheer(ewq_test.id('b'), 'thanks');
select ewq_test.raises($$select public.send_cheer(ewq_test.id('b'), 'nice')$$, 'invalid_input', '同じ相手への応援は1日3回まで');
select ewq_test.raises($$select public.send_cheer(ewq_test.id('b'), 'bad')$$, 'invalid_input', '決まった種類以外の応援は送れない');
select ewq_test.raises($$select public.send_cheer(ewq_test.id('c'), 'nice')$$, 'not_found', 'フレンド以外には応援を送れない');
select ewq_test.ok((public.get_friends() -> 'friends' -> 0 ->> 'cheersSent')::integer = 3, '送った応援の回数');
reset role;

select ewq_test.as_user('b');
set local role authenticated;
select ewq_test.ok((public.get_friends() -> 'friends' -> 0 ->> 'weeklySteps')::integer = 12345, 'フレンドの今週の歩数は見える');
reset role;

-- ---- 5. デモ用アカウント（c）とランキング ----
select ewq_test.as_user('a');
set local role authenticated;
insert into ewq_test.vals select 'community_before', public.get_common_quests() -> 2 ->> 'progress';
select ewq_test.raises('select public.demo_add_coins(500)', 'demo_unavailable', '一般のアカウントはデモ操作を使えない');
reset role;

select ewq_test.as_user('c');
set local role authenticated;
select public.complete_onboarding('デモ', 'デモ', '{"hairStyle":"long","hairColor":"pink","skinTone":"medium","eyeColor":"blue"}', 'top_sunrise_tee', 'bottom_denim');
select ewq_test.ok((public.demo_add_steps(10000) ->> 'todaySteps')::integer = 10000, 'デモ用アカウントは歩数を足せる');
select ewq_test.ok((select verification = 'excluded' from public.step_records where step_date = ewq_test.v('today')::date), 'デモの歩数は excluded');
select ewq_test.ok((public.demo_add_coins(500) ->> 'balance')::integer = 600, 'デモ用アカウントはコインを足せる（歩数の100＋500）');
select ewq_test.raises('select public.demo_add_coins(123)', 'demo_unavailable', '決まった数以外は足せない');
select ewq_test.ok((public.get_ranking('all', 'web') -> 'me' ->> 'excludedReason') = 'demo_data', 'デモ用アカウントはランキング対象外');
select ewq_test.ok((public.check_in('uwajima_castle', 0, 0, 0, 'list', null, true) -> 'visit' ->> 'verified')::boolean = false,
                   'デモ用チェックインは現地確認なしとして記録する');
reset role;

select ewq_test.as_user('a');
set local role authenticated;
select ewq_test.ok(exists (select 1 from jsonb_array_elements(public.get_ranking('all', 'web') -> 'entries') e
                            where (e ->> 'isMe')::boolean and (e ->> 'weeklySteps')::integer = 12345),
                   'Web 版ランキングにセンサーの歩数で入る');
select ewq_test.ok(not exists (select 1 from jsonb_array_elements(public.get_ranking('all', 'web') -> 'entries') e
                                where (e ->> 'userId')::uuid = ewq_test.id('c')),
                   'デモ用アカウントはランキングに出ない');
select ewq_test.ok((public.get_ranking('all', 'official') -> 'me' ->> 'excludedReason') = 'unverified'
                   and not exists (select 1 from jsonb_array_elements(public.get_ranking('all', 'official') -> 'entries') e
                                    where (e ->> 'isMe')::boolean),
                   '正式ランキングには pending の歩数では入らない');
select ewq_test.ok(jsonb_array_length(public.get_ranking('friends', 'web') -> 'entries') = 2, 'フレンドランキングは自分とフレンド');
select ewq_test.ok((public.get_common_quests() -> 2 ->> 'progress') = ewq_test.v('community_before'),
                   'みんなのクエストの合計にデモの歩数は入らない');
select ewq_test.raises($$select public.get_ranking('world', 'web')$$, 'invalid_input', '存在しないランキング');
reset role;

-- ---- 6. AI の利用回数（サーバー＝service_role） ----
set local role service_role;
insert into ewq_test.vals select 'r' || i, public.ai_quota_reserve(ewq_test.id('a')) ->> 'reservationId' from generate_series(1, 5) i;
select ewq_test.ok((public.ai_quota_reserve(ewq_test.id('a')) ->> 'reason') = 'user_limit', '1日5回を超えると断る');
select ewq_test.ok(public.ai_quota_release(ewq_test.id('r5')), '失敗したときは予約を戻せる');
select ewq_test.ok(not public.ai_quota_release(ewq_test.id('r5')), '同じ予約は2回戻せない');
insert into ewq_test.vals values ('quest', gen_random_uuid()::text);
select ewq_test.ok(public.ai_quota_commit(ewq_test.id('r4'), ewq_test.id('quest'), '道後さんぽ', array['dogo_onsen_honkan'], 'jp.amazon.nova-2-lite-v1:0', 'bedrock'),
                   '提案したクエストを記録できる');
select ewq_test.ok(not public.ai_quota_release(ewq_test.id('r4')), '使った予約は戻せない');
select ewq_test.ok((public.ai_quota_reserve(ewq_test.id('a')) ->> 'ok')::boolean, '戻した分だけ、もう1回使える');
select ewq_test.ok((public.ai_quota_reserve(ewq_test.id('a')) ->> 'ok')::boolean = false, 'また上限');
select ewq_test.raises($$select public.ai_quota_commit(ewq_test.id('r3'), gen_random_uuid(), 'x', array['nowhere'], 'm', 'bedrock')$$,
                       'invalid_input', '登録スポット以外は記録できない');
select ewq_test.ok((public.ai_quota_reserve(ewq_test.id('b'), 3) ->> 'reason') = 'global_limit', 'アプリ全体の1日の上限を超えると断る');
reset role;

select ewq_test.as_user('a');
set local role authenticated;
select ewq_test.ok((public.get_ai_quota() ->> 'remainingToday')::integer = 0, '残り回数を表示できる');
select ewq_test.ok((public.check_in('dogo_onsen_honkan', 33.852, 132.7864, 10, 'ai_quest', ewq_test.v('quest')) -> 'visit' ->> 'via') = 'ai_quest',
                   'サーバーが提案したクエストのスポットは AI 経由として記録する');
select ewq_test.ok((public.check_in('imabari_castle', 34.0656, 133.0054, 10, 'ai_quest', gen_random_uuid()::text) -> 'visit' ->> 'via') = 'list',
                   '提案していないクエストを名乗っても AI 経由にはならない');

-- ---- 7. データ削除 ----
select public.delete_my_data();
select ewq_test.ok((public.get_point_balance() ->> 'balance')::integer = 0
                   and (select count(*) from public.inventory) = 4
                   and (select count(*) from public.visits) = 0
                   and (select count(*) from public.coin_transactions) = 0
                   and (public.get_session() -> 'profile' ->> 'onboarded')::boolean = false
                   and (public.get_session() -> 'profile' ->> 'friendCode') <> ewq_test.v('code_a')
                   and jsonb_array_length(public.get_friends() -> 'friends') = 0,
                   'データ削除で最初の状態に戻り、フレンドコードも新しくなる');
select ewq_test.ok((public.get_ai_quota() ->> 'remainingToday')::integer = 0, 'データを削除しても AI の回数は戻らない');
reset role;

rollback;
