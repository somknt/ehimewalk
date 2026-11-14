-- =============================================================================
-- えひめウォーククエスト：002 AI の残り回数をサーバーから確かめる関数
-- 001 のあとに実行する。2 回実行しても壊れない
-- =============================================================================

-- 指定したユーザーの今日の AI の残り回数（service_role 専用。Vercel Functions が画面に返すために使う）
create or replace function public.ai_quota_status(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where user_id = p_user_id) then
    perform private.fail('not_found', 'ユーザーが見つかりません。');
  end if;
  return jsonb_build_object('remainingToday', greatest(0, private.ai_daily_limit() - private.ai_used_today(p_user_id)),
                            'dailyLimit', private.ai_daily_limit());
end;
$$;

revoke all on function public.ai_quota_status(uuid) from public, anon, authenticated;
grant execute on function public.ai_quota_status(uuid) to service_role;
