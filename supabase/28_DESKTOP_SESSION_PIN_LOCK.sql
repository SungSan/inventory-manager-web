-- SAN WMS V4.5.0
-- PC 전용 유휴 잠금 해제를 위한 기존 개인 PIN 검증 RPC
--
-- 적용 후 동작:
--   * 앱 활동 10분 없음: PIN 잠금 화면
--   * 앱 활동 40분 없음: Supabase 세션 로그아웃
--   * 모바일/태블릿: 앱 코드에서 제외
--
-- PIN 원문과 해시는 클라이언트에 반환하지 않는다.

begin;

create extension if not exists pgcrypto;

create or replace function public.get_desktop_session_guard_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_profile public.profiles%rowtype;
  v_pin private.user_pin_credentials%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'enabled', false,
      'pin_configured', false,
      'message', '로그인이 필요합니다.'
    );
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid();

  if not found then
    return jsonb_build_object(
      'enabled', false,
      'pin_configured', false,
      'message', '사용자 프로필을 찾을 수 없습니다.'
    );
  end if;

  select * into v_pin
  from private.user_pin_credentials
  where user_id = auth.uid();

  return jsonb_build_object(
    'enabled',
      v_profile.active
      and not v_profile.is_service_account
      and v_profile.account_type = 'HUMAN'
      and v_pin.user_id is not null
      and v_profile.pin_set_at is not null
      and not v_profile.pin_reset_required
      and public.user_access_ready(auth.uid()),
    'pin_configured',
      v_pin.user_id is not null
      and v_profile.pin_set_at is not null
      and not v_profile.pin_reset_required,
    'display_name', coalesce(
      nullif(btrim(v_profile.legal_name), ''),
      nullif(btrim(v_profile.assigned_name), ''),
      nullif(btrim(v_profile.display_name), ''),
      v_profile.email,
      '사용자'
    )
  );
end;
$$;

create or replace function public.verify_current_user_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_profile public.profiles%rowtype;
  v_pin private.user_pin_credentials%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_locked_until timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'NOT_AUTHENTICATED',
      'message', '로그인이 필요합니다.'
    );
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid();

  if not found or not v_profile.active then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'ACCOUNT_INACTIVE',
      'message', '사용할 수 없는 계정입니다.'
    );
  end if;

  if v_profile.is_service_account or v_profile.account_type <> 'HUMAN' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'PIN_NOT_REQUIRED',
      'message', '개인 PIN 잠금 대상 계정이 아닙니다.'
    );
  end if;

  if not public.user_access_ready(auth.uid()) then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'ACCESS_NOT_READY',
      'message', '본인확인, PIN 설정 또는 최신 이용조건 동의 상태를 확인하세요.'
    );
  end if;

  select * into v_pin
  from private.user_pin_credentials
  where user_id = auth.uid()
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'PIN_NOT_CONFIGURED',
      'message', '등록된 개인 PIN이 없습니다. 관리자에게 PIN 초기화를 요청하세요.'
    );
  end if;

  -- 기존 15분 잠금 시간이 끝난 뒤에는 실패 횟수를 새로 계산한다.
  if v_pin.locked_until is not null and v_pin.locked_until <= v_now then
    update private.user_pin_credentials
    set failed_attempts = 0,
        locked_until = null,
        updated_at = v_now
    where user_id = auth.uid();
    v_pin.failed_attempts := 0;
    v_pin.locked_until := null;
  end if;

  if v_pin.locked_until is not null and v_pin.locked_until > v_now then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'PIN_LOCKED',
      'message', 'PIN 입력 실패로 잠금 상태입니다. 잠시 후 다시 시도하세요.',
      'locked_until', v_pin.locked_until,
      'remaining_attempts', 0
    );
  end if;

  if coalesce(p_pin, '') !~ '^[0-9]{6}$'
     or crypt(p_pin, v_pin.pin_hash) <> v_pin.pin_hash then
    v_attempts := coalesce(v_pin.failed_attempts, 0) + 1;
    v_locked_until := case
      when v_attempts >= 5 then v_now + interval '15 minutes'
      else null
    end;

    update private.user_pin_credentials
    set failed_attempts = v_attempts,
        locked_until = v_locked_until,
        updated_at = v_now
    where user_id = auth.uid();

    return jsonb_build_object(
      'ok', false,
      'error_code', case when v_attempts >= 5 then 'PIN_LOCKED' else 'INVALID_PIN' end,
      'message', case
        when v_attempts >= 5 then 'PIN을 5회 잘못 입력하여 15분간 잠겼습니다.'
        else '개인 PIN이 일치하지 않습니다.'
      end,
      'locked_until', v_locked_until,
      'remaining_attempts', greatest(0, 5 - v_attempts)
    );
  end if;

  update private.user_pin_credentials
  set failed_attempts = 0,
      locked_until = null,
      updated_at = v_now
  where user_id = auth.uid();

  return jsonb_build_object(
    'ok', true,
    'verified_at', v_now
  );
end;
$$;

revoke all on function public.get_desktop_session_guard_status() from public, anon;
revoke all on function public.verify_current_user_pin(text) from public, anon;
grant execute on function public.get_desktop_session_guard_status() to authenticated;
grant execute on function public.verify_current_user_pin(text) to authenticated;

commit;

select 'SAN WMS V4.5.0 desktop session PIN lock functions completed' as result;
