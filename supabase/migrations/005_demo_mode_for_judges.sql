-- =============================================================================
-- えひめウォーククエスト：005 「デモ」は審査・お試し用のデモモード。ABCD-2345 は発表用の合言葉のときだけ
-- 004 のあとに実行する（004 の関数を使う）。2 回実行しても壊れない
--
-- しくみ
-- - ユーザー名「デモ」（または demo）でキャラクターを作ると、デモモード（デモ操作・デモ用チェックイン）になる。
--   フレンドIDは、その人だけのふつうのIDのまま（何人でもデモモードで始められる。審査の人が同時に使ってもよい）
-- - ユーザー名「発表用デモ」で作ったときだけ、フレンドIDを ABCD-2345 にする（発表で使う 1 台だけ）。
--   前の持ち主は、デモモードのまま新しいIDになる
-- - すでに ABCD-2345 を持っているアカウントは、そのまま（この SQL を実行しても変わらない）
-- =============================================================================

-- ABCD-2345 を受け取る合言葉（ユーザー名）。審査の人に案内する「デモ」とは別にする
create or replace function private.presenter_usernames()
returns text[] language sql immutable set search_path = '' as $$
  select array['発表用デモ'];
$$;

-- 指定したユーザーを発表用のデモ用アカウント（ABCD-2345）にする。前の持ち主はデモモードのまま新しいIDになる
create or replace function private.assign_demo_account(p_user_id uuid)
returns void language plpgsql volatile set search_path = '' as $$
declare
  v_holder uuid;
begin
  -- 同時に 2 人が作っても、ID が重ならないよう順番に処理する
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ewq_demo_account', 0));
  select user_id into v_holder from public.profiles where friend_code = private.demo_friend_code();
  if v_holder is not null and v_holder <> p_user_id then
    update public.profiles set friend_code = private.new_friend_code(), updated_at = pg_catalog.now()
     where user_id = v_holder;
  end if;
  update public.profiles set friend_code = private.demo_friend_code(), is_demo = true, updated_at = pg_catalog.now()
   where user_id = p_user_id;
end;
$$;

-- キャラクター作成（1 アカウント 1 回）。ユーザー名が合言葉なら、デモモード・発表用アカウントにする
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
  if pg_catalog.lower(v_username) = any (private.presenter_usernames()) then
    -- 発表用：ABCD-2345 のデモ用アカウントにする
    perform private.assign_demo_account(v_uid);
  elsif pg_catalog.lower(v_username) = any (private.demo_usernames()) then
    -- 審査・お試し用：デモモードにするだけ（フレンドIDは変えない）
    update public.profiles set is_demo = true, updated_at = pg_catalog.now() where user_id = v_uid;
  end if;
  return private.session_json(v_uid);
end;
$$;

revoke all on function public.complete_onboarding(text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.complete_onboarding(text, text, jsonb, text, text) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
