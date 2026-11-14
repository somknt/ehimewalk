-- =============================================================================
-- 003_fixed_friend_id.sql の動作確認（フレンドIDが変わらないこと・デモ用アカウント ABCD-2345）
-- 001・002・003 を実行したあとに、SQL Editor に貼って実行する。最後に ROLLBACK するのでデータは残らない
-- 失敗すると「NG: …」で止まる。最後まで通れば成功
-- =============================================================================

begin;

create schema ewq_test3;
create table ewq_test3.vals (name text primary key, val text);
grant usage on schema ewq_test3 to anon, authenticated, service_role;
grant select, insert, update on ewq_test3.vals to anon, authenticated, service_role;

create function ewq_test3.ok(p_cond boolean, p_label text) returns text language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'NG: %', p_label; end if;
  raise notice 'OK: %', p_label;
  return 'OK: ' || p_label;
end;
$$;
create function ewq_test3.raises(p_sql text, p_pattern text, p_label text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_pattern then raise notice 'OK: %', p_label; return 'OK: ' || p_label; end if;
    raise exception 'NG: %（想定と違うエラー：%）', p_label, sqlerrm;
  end;
  raise exception 'NG: %（エラーになりませんでした）', p_label;
end;
$$;
create function ewq_test3.v(p_name text) returns text language sql as $$ select val from ewq_test3.vals where name = p_name; $$;
create function ewq_test3.id(p_name text) returns uuid language sql as $$ select val::uuid from ewq_test3.vals where name = p_name; $$;
create function ewq_test3.as_user(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', ewq_test3.id(p_name), 'role', 'authenticated')::text, true);
  select null::void;
$$;
grant execute on all functions in schema ewq_test3 to anon, authenticated, service_role;

insert into ewq_test3.vals values ('a', gen_random_uuid()::text), ('b', gen_random_uuid()::text);
insert into auth.users (id, aud, role, email)
select val::uuid, 'authenticated', 'authenticated', name || '@ewq3.example' from ewq_test3.vals where name in ('a', 'b');
insert into ewq_test3.vals select 'code_a', friend_code from public.profiles where user_id = ewq_test3.id('a');
insert into ewq_test3.vals select 'code_b', friend_code from public.profiles where user_id = ewq_test3.id('b');
-- 発表用のデモ用アカウントの元の状態（テストの最後に ROLLBACK で戻る）
insert into ewq_test3.vals select 'demo_before', user_id::text from public.profiles where friend_code = 'ABCD2345';

select ewq_test3.ok(ewq_test3.v('code_a') <> 'ABCD2345' and ewq_test3.v('code_b') <> 'ABCD2345', '予約したID（ABCD2345）は新しい人に発行しない');

-- ---- 1. データを削除してもフレンドIDは変わらない ----
select ewq_test3.as_user('a');
set local role authenticated;
select public.complete_onboarding('てすとA', 'ミカン', '{"hairStyle":"bob","hairColor":"mikan","skinTone":"light","eyeColor":"brown"}', 'top_leaf_tee', 'bottom_denim');
select public.delete_my_data();
select ewq_test3.ok((public.get_session() -> 'profile' ->> 'friendCode') = ewq_test3.v('code_a'), 'データを削除してもフレンドIDは変わらない');
select ewq_test3.raises($$select public.admin_make_demo_account('ABCD2345')$$, 'permission denied%', '利用者は自分をデモ用アカウントにできない');
reset role;

-- ---- 2. 管理者が b をデモ用アカウント（ABCD-2345）にする ----
select public.admin_make_demo_account(lower(substr(ewq_test3.v('code_b'), 1, 4) || '-' || substr(ewq_test3.v('code_b'), 5)));
select ewq_test3.ok((select friend_code = 'ABCD2345' and is_demo from public.profiles where user_id = ewq_test3.id('b')),
                    'デモ用アカウントのIDが ABCD2345 になる');
select ewq_test3.ok(ewq_test3.v('demo_before') is null
                    or (select friend_code <> 'ABCD2345' and not is_demo from public.profiles where user_id = ewq_test3.id('demo_before')),
                    '前のデモ用アカウントは、デモ用をやめて別のIDになる');

select ewq_test3.as_user('b');
set local role authenticated;
select public.complete_onboarding('デモ', 'デモ', '{"hairStyle":"long","hairColor":"pink","skinTone":"medium","eyeColor":"blue"}', 'top_sunrise_tee', 'bottom_denim');
select public.demo_prepare_showcase();
select ewq_test3.ok((public.get_session() -> 'profile' ->> 'friendCode') = 'ABCD2345'
                    and (public.get_session() -> 'profile' ->> 'isDemo')::boolean,
                    '発表用デモを作り直しても ABCD2345 とデモ用の設定は変わらない');
reset role;

-- ---- 3. ABCD-2345 で検索して申請すると、すぐにフレンドになる ----
select ewq_test3.as_user('a');
set local role authenticated;
select ewq_test3.ok((public.find_user_by_friend_code('abcd-2345') ->> 'username') = 'デモユーザー', 'ABCD-2345 で検索できる');
select ewq_test3.ok(jsonb_array_length(public.send_friend_request('ABCD-2345') -> 'friends') = 1, 'デモ用アカウントへの申請はすぐに承認される');
select ewq_test3.raises($$select public.send_friend_request('ABCD-2345')$$, 'invalid_input', '2回目は「すでにフレンド」');
select ewq_test3.raises($$select public.send_friend_request('ZZZZZZZZ')$$, 'not_found', '存在しないIDには申請できない');
reset role;

rollback;
