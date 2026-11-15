-- =============================================================================
-- 005_demo_mode_for_judges.sql の動作確認。001〜005 を実行したあとに SQL Editor で実行する（最後に ROLLBACK）
-- 失敗すると「NG: …」で止まる。最後まで通れば成功
-- =============================================================================

begin;

create schema ewq_test5;
create table ewq_test5.vals (name text primary key, val text);
grant usage on schema ewq_test5 to authenticated;
grant select on ewq_test5.vals to authenticated;
create function ewq_test5.ok(p_cond boolean, p_label text) returns text language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'NG: %', p_label; end if;
  raise notice 'OK: %', p_label;
  return 'OK: ' || p_label;
end;
$$;
create function ewq_test5.id(p_name text) returns uuid language sql as $$ select val::uuid from ewq_test5.vals where name = p_name; $$;
create function ewq_test5.as_user(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', ewq_test5.id(p_name), 'role', 'authenticated')::text, true);
  select null::void;
$$;
grant execute on all functions in schema ewq_test5 to authenticated;

insert into ewq_test5.vals values
  ('normal', gen_random_uuid()::text), ('presenter1', gen_random_uuid()::text), ('judge1', gen_random_uuid()::text),
  ('judge2', gen_random_uuid()::text), ('presenter2', gen_random_uuid()::text);
insert into auth.users (id, aud, role, email) select val::uuid, 'authenticated', 'authenticated', name || '@ewq5.example' from ewq_test5.vals;

-- ふつうの名前ならデモモードにならない
select ewq_test5.as_user('normal');
set local role authenticated;
select ewq_test5.ok(not (public.complete_onboarding('みかん', 'ミカン', '{"hairStyle":"bob","hairColor":"mikan","skinTone":"light","eyeColor":"brown"}', 'top_leaf_tee', 'bottom_denim')
                      -> 'profile' ->> 'isDemo')::boolean, 'ふつうの名前ではデモモードにならない');
reset role;

-- 「発表用デモ」で作ると ABCD2345 になる
select ewq_test5.as_user('presenter1');
set local role authenticated;
select ewq_test5.ok((public.complete_onboarding('発表用デモ', 'デモ', '{"hairStyle":"long","hairColor":"pink","skinTone":"medium","eyeColor":"blue"}', 'top_sunrise_tee', 'bottom_denim')
                     -> 'profile' ->> 'friendCode') = 'ABCD2345', 'ユーザー名「発表用デモ」で作ると ABCD2345 になる');
reset role;

-- 審査の人が「デモ」で作ると、デモモードになるが ABCD2345 は取らない
select ewq_test5.as_user('judge1');
set local role authenticated;
select ewq_test5.ok((select (s -> 'profile' ->> 'isDemo')::boolean and s -> 'profile' ->> 'friendCode' <> 'ABCD2345'
                       from (select public.complete_onboarding(' デモ ', 'しんさ', '{"hairStyle":"short","hairColor":"black","skinTone":"tan","eyeColor":"black"}', 'top_adventure_tee', 'bottom_denim') as s) t),
                    '「デモ」で作るとデモモードになり、フレンドIDはその人のもの');
select ewq_test5.ok((public.demo_add_coins(500) ->> 'balance')::integer = 500, 'デモモードでデモ操作が使える');
select ewq_test5.ok((public.send_friend_request('ABCD-2345') -> 'friends' -> 0 ->> 'relation') = 'friend', 'ABCD-2345 への申請はすぐに承認される');
reset role;

select ewq_test5.as_user('judge2');
set local role authenticated;
select ewq_test5.ok((public.complete_onboarding('DEMO', 'しんさ2', '{"hairStyle":"short","hairColor":"black","skinTone":"tan","eyeColor":"black"}', 'top_adventure_tee', 'bottom_denim')
                     -> 'profile' ->> 'isDemo')::boolean, '2人目の審査の人もデモモードになれる');
reset role;
select ewq_test5.ok((select friend_code = 'ABCD2345' and is_demo from public.profiles where user_id = ewq_test5.id('presenter1')),
                    '審査の人が「デモ」で作っても、発表用アカウントの ABCD2345 は変わらない');

-- 発表用の端末を替えたときは、あとから「発表用デモ」で作った人に移る（前の人はデモモードのまま）
select ewq_test5.as_user('presenter2');
set local role authenticated;
select ewq_test5.ok((public.complete_onboarding('発表用デモ', 'デモ2', '{"hairStyle":"short","hairColor":"black","skinTone":"tan","eyeColor":"black"}', 'top_adventure_tee', 'bottom_denim')
                     -> 'profile' ->> 'friendCode') = 'ABCD2345', 'あとから「発表用デモ」で作った人に ABCD2345 が移る');
reset role;
select ewq_test5.ok((select friend_code <> 'ABCD2345' and is_demo from public.profiles where user_id = ewq_test5.id('presenter1')),
                    '前の発表用アカウントは、デモモードのまま新しいIDになる');
select ewq_test5.ok((select count(*) from public.profiles where friend_code = 'ABCD2345') = 1, 'ABCD2345 は 1 人だけ');

rollback;
