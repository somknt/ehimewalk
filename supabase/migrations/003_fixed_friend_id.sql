-- =============================================================================
-- えひめウォーククエスト：003 フレンドIDを固定にする・発表用のデモ用アカウント
-- 001・002 のあとに実行する。2 回実行しても壊れない
--
-- 変更点
-- 1. フレンドID（friend_code）は、アカウントを作ったときに 1 回だけ決め、そのあとは変えない
--    （001 では「データ削除」と「発表用デモ」のたびに作り直していたため、IDが変わっていた）
-- 2. 発表用のデモ用アカウントのID「ABCD-2345」を予約し、ほかの人には発行しない
-- 3. 管理者が、指定したアカウントをデモ用アカウント（ID：ABCD-2345）にする関数を追加する
-- 4. デモ用アカウントへのフレンド申請は、すぐに承認される（発表中に、その場でフレンドになれるように）
-- =============================================================================

-- 発表用のデモ用アカウントのフレンドID（ハイフンなしで保存し、画面では ABCD-2345 と表示する）
create or replace function private.demo_friend_code()
returns text language sql immutable set search_path = '' as $$
  select 'ABCD2345';
$$;

-- まだ使われていないフレンドID（予約したIDは発行しない）
create or replace function private.new_friend_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_code text;
begin
  for i in 1..20 loop
    v_code := private.random_friend_code();
    if v_code <> private.demo_friend_code()
       and not exists (select 1 from public.profiles where friend_code = v_code) then
      return v_code;
    end if;
  end loop;
  perform private.fail('server_error', 'フレンドIDを作れませんでした。');
  return null;
end;
$$;

-- 自分のデータをすべて消して初期状態に戻す。アカウント・フレンドID・デモ用の設定・AI の利用回数は残す
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
  -- フレンドID（friend_code）は変えない
  update public.profiles
     set username = 'ぼうけんしゃ', selected_region = '38', ehime_ranking_opt_in = true, title_id = 'mikan_novice',
         daily_goal = 6000, onboarded = false, reduce_gacha_effects = false, updated_at = pg_catalog.now()
   where user_id = p_user_id;
  perform private.init_user_data(p_user_id);
end;
$$;

-- フレンド申請。相手から申請が届いていれば、そのままフレンドになる。
-- 相手がデモ用アカウントなら、すぐに承認される（デモ用アカウントのフレンドの上限は数えない）
create or replace function public.send_friend_request(p_friend_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_code text := private.normalize_friend_code(p_friend_code);
  v_other uuid;
  v_other_demo boolean;
  f public.friendships;
begin
  if v_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    perform private.fail('invalid_input', 'フレンドIDは英数字8文字で入力してください。');
  end if;
  select user_id, is_demo into v_other, v_other_demo from public.profiles where friend_code = v_code;
  if not found then perform private.fail('not_found', 'このフレンドIDのユーザーは見つかりませんでした。'); end if;
  if v_other = v_uid then perform private.fail('invalid_input', '自分のフレンドIDです。'); end if;

  -- 2 人の組ごとのロック（お互いに同時に申請しても 1 行になる）
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(v_uid, v_other)::text || greatest(v_uid, v_other)::text, 0));
  select * into f from public.friendships where user_low = least(v_uid, v_other) and user_high = greatest(v_uid, v_other);
  if found and f.status = 'accepted' then
    perform private.fail('invalid_input', 'すでにフレンドです。');
  elsif found and (f.requested_by = v_other or v_other_demo) then
    if (select count(*) from public.friendships where v_uid in (user_low, user_high) and status = 'accepted') >= 100
       or (not v_other_demo and (select count(*) from public.friendships where v_other in (user_low, user_high) and status = 'accepted') >= 100) then
      perform private.fail('invalid_input', 'フレンドは100人までです。');
    end if;
    update public.friendships set status = 'accepted', responded_at = pg_catalog.now()
     where user_low = f.user_low and user_high = f.user_high;
  elsif not found then
    if (select count(*) from public.friendships
         where v_uid in (user_low, user_high) and (status = 'accepted' or requested_by = v_uid)) >= 100 then
      perform private.fail('invalid_input', 'フレンドと申請中の人数は100人までです。');
    end if;
    insert into public.friendships (user_low, user_high, requested_by, status, responded_at)
    values (least(v_uid, v_other), greatest(v_uid, v_other), v_uid,
            case when v_other_demo then 'accepted'::public.friendship_status else 'pending'::public.friendship_status end,
            case when v_other_demo then pg_catalog.now() end);
  end if;
  -- 自分が申請中の場合は何もしない
  return private.friends_json(v_uid);
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
    perform private.fail('invalid_input', 'フレンドIDは英数字8文字で入力してください。');
  end if;
  select user_id into v_other from public.profiles where friend_code = v_code;
  if not found then return null; end if;
  return private.public_user_json(v_other) || jsonb_build_object('relation', private.relation(v_uid, v_other));
end;
$$;

-- 指定したアカウント（いまのフレンドIDで指定）を、発表用のデモ用アカウントにする。
-- フレンドIDは ABCD-2345 に変わる（ほかの人が ABCD-2345 を使っていたら、その人は新しいIDになる）。
-- 管理者だけ（SQL Editor か service_role から使う）
create or replace function public.admin_make_demo_account(p_current_friend_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text := private.normalize_friend_code(p_current_friend_code);
  v_target uuid;
  v_holder uuid;
begin
  select user_id into v_target from public.profiles where friend_code = v_code;
  if not found then perform private.fail('not_found', 'このフレンドIDのユーザーは見つかりませんでした。'); end if;
  select user_id into v_holder from public.profiles where friend_code = private.demo_friend_code();
  if v_holder is not null and v_holder <> v_target then
    -- 前のデモ用アカウントは、デモ用をやめて新しいIDにする
    update public.profiles set friend_code = private.new_friend_code(), is_demo = false, updated_at = pg_catalog.now()
     where user_id = v_holder;
  end if;
  update public.profiles set friend_code = private.demo_friend_code(), is_demo = true, updated_at = pg_catalog.now()
   where user_id = v_target;
  return jsonb_build_object('userId', v_target, 'friendCode', 'ABCD-2345', 'isDemo', true);
end;
$$;

-- 権限：利用者が呼べる関数は authenticated だけ、管理用の関数は service_role だけ
revoke all on function public.send_friend_request(text) from public, anon, authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
revoke all on function public.find_user_by_friend_code(text) from public, anon, authenticated;
grant execute on function public.find_user_by_friend_code(text) to authenticated;
revoke all on function public.admin_make_demo_account(text) from public, anon, authenticated;
grant execute on function public.admin_make_demo_account(text) to service_role;
revoke all on all functions in schema private from public, anon, authenticated;
