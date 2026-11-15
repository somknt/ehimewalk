-- =============================================================================
-- えひめウォーククエスト：004 ユーザー名を「デモ」にしてキャラクターを作ると、デモ用アカウントになる
-- 003 のあとに実行する（003 の関数を使う）。2 回実行しても壊れない
--
-- しくみ
-- - キャラクター作成のときのユーザー名が「デモ」（または demo）なら、そのアカウントをデモ用アカウントにし、
--   フレンドIDを ABCD-2345 にする
-- - ABCD-2345 は 1 人だけ。あとから「デモ」で作った人に移り、前の人はデモ用をやめて新しいIDになる
--   （発表の直前に作り直せば、必ず自分のスマホが ABCD-2345 になる）
-- - 合言葉を変えたいときは、private.demo_usernames() の中身を書き換えて実行し直す
-- =============================================================================

-- デモ用アカウントにする合言葉（ユーザー名）。比べるときは前後の空白を除き、英字は小文字にそろえる
create or replace function private.demo_usernames()
returns text[] language sql immutable set search_path = '' as $$
  select array['デモ', 'demo'];
$$;

-- 指定したユーザーをデモ用アカウント（ABCD-2345）にする。前の持ち主はデモ用をやめて新しいIDになる
create or replace function private.assign_demo_account(p_user_id uuid)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_holder uuid;
begin
  -- 同時に 2 人が「デモ」で作っても、ID が重ならないよう順番に処理する
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ewq_demo_account', 0));
  select user_id into v_holder from public.profiles where friend_code = private.demo_friend_code();
  if v_holder is not null and v_holder <> p_user_id then
    update public.profiles set friend_code = private.new_friend_code(), is_demo = false, updated_at = pg_catalog.now()
     where user_id = v_holder;
  end if;
  update public.profiles set friend_code = private.demo_friend_code(), is_demo = true, updated_at = pg_catalog.now()
   where user_id = p_user_id;
end;
$$;

-- 管理者用（003 の関数を、共通の処理を使う形に置き換える）
create or replace function public.admin_make_demo_account(p_current_friend_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_target uuid;
begin
  select user_id into v_target from public.profiles where friend_code = private.normalize_friend_code(p_current_friend_code);
  if not found then perform private.fail('not_found', 'このフレンドIDのユーザーは見つかりませんでした。'); end if;
  perform private.assign_demo_account(v_target);
  return jsonb_build_object('userId', v_target, 'friendCode', 'ABCD-2345', 'isDemo', true);
end;
$$;

-- キャラクター作成（1 アカウント 1 回）。ユーザー名が合言葉なら、デモ用アカウントにする
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
  -- ユーザー名が合言葉なら、デモ用アカウント（ABCD-2345）にする
  if pg_catalog.lower(v_username) = any (private.demo_usernames()) then
    perform private.assign_demo_account(v_uid);
  end if;
  return private.session_json(v_uid);
end;
$$;

revoke all on function public.complete_onboarding(text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.complete_onboarding(text, text, jsonb, text, text) to authenticated;
revoke all on function public.admin_make_demo_account(text) from public, anon, authenticated;
grant execute on function public.admin_make_demo_account(text) to service_role;
revoke all on all functions in schema private from public, anon, authenticated;
