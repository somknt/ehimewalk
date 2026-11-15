-- =============================================================================
-- 004_demo_by_username.sql の動作確認。001〜004 を実行したあとに SQL Editor で実行する（最後に ROLLBACK）
-- 失敗すると「NG: …」で止まる。最後まで通れば成功
-- =============================================================================

begin;

create schema ewq_test4;
create table ewq_test4.vals (name text primary key, val text);
grant usage on schema ewq_test4 to authenticated;
grant select on ewq_test4.vals to authenticated;
create function ewq_test4.ok(p_cond boolean, p_label text) returns text language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'NG: %', p_label; end if;
  raise notice 'OK: %', p_label;
  return 'OK: ' || p_label;
end;
$$;
create function ewq_test4.id(p_name text) returns uuid language sql as $$ select val::uuid from ewq_test4.vals where name = p_name; $$;
create function ewq_test4.as_user(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', ewq_test4.id(p_name), 'role', 'authenticated')::text, true);
  select null::void;
$$;
grant execute on all functions in schema ewq_test4 to authenticated;

insert into ewq_test4.vals values ('normal', gen_random_uuid()::text), ('demo1', gen_random_uuid()::text), ('demo2', gen_random_uuid()::text);
insert into auth.users (id, aud, role, email) select val::uuid, 'authenticated', 'authenticated', name || '@ewq4.example' from ewq_test4.vals;

-- ふつうの名前ならデモ用にならない
select ewq_test4.as_user('normal');
set local role authenticated;
select ewq_test4.ok(not (public.complete_onboarding('みかん', 'ミカン', '{"hairStyle":"bob","hairColor":"mikan","skinTone":"light","eyeColor":"brown"}', 'top_leaf_tee', 'bottom_denim')
                      -> 'profile' ->> 'isDemo')::boolean, 'ふつうの名前ではデモ用アカウントにならない');
reset role;

-- 「デモ」で作るとデモ用アカウント（ABCD2345）になる
select ewq_test4.as_user('demo1');
set local role authenticated;
select ewq_test4.ok((public.complete_onboarding(' デモ ', 'デモ', '{"hairStyle":"long","hairColor":"pink","skinTone":"medium","eyeColor":"blue"}', 'top_sunrise_tee', 'bottom_denim')
                     -> 'profile' ->> 'friendCode') = 'ABCD2345', 'ユーザー名「デモ」で作ると ABCD2345 のデモ用アカウントになる');
select ewq_test4.ok((public.demo_add_coins(500) ->> 'balance')::integer = 500, 'デモ操作が使える');
reset role;

-- あとから「DEMO」で作った人に ABCD2345 が移り、前の人はデモ用をやめる
select ewq_test4.as_user('demo2');
set local role authenticated;
select ewq_test4.ok((public.complete_onboarding('DEMO', 'デモ2', '{"hairStyle":"short","hairColor":"black","skinTone":"tan","eyeColor":"black"}', 'top_adventure_tee', 'bottom_denim')
                     -> 'profile' ->> 'friendCode') = 'ABCD2345', 'あとから作った人に ABCD2345 が移る');
reset role;
select ewq_test4.ok((select friend_code <> 'ABCD2345' and not is_demo from public.profiles where user_id = ewq_test4.id('demo1')),
                    '前のデモ用アカウントは、デモ用をやめて新しいIDになる');
select ewq_test4.ok((select count(*) from public.profiles where friend_code = 'ABCD2345') = 1, 'ABCD2345 は 1 人だけ');

rollback;
