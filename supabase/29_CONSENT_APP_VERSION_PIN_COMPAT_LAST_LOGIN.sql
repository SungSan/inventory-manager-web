-- SAN WMS V4.5.1
-- 1) 동의 당시 실제 앱 버전 저장
-- 2) 기존 bcrypt PIN 해시($2a$/$2b$/$2y$) 호환 검증
-- 3) 관리자 사용자 목록에 마지막 성공 로그인 시간 표시

begin;

create extension if not exists pgcrypto;

alter table public.terms_acceptances
  add column if not exists app_version_snapshot text;

alter table public.profiles
  add column if not exists latest_app_version text;

-- V4.5.0 운영 배포 이후 생성된 기존 동의 기록은 당시 실제 앱 버전으로 보정한다.
-- 이 구간은 V4.5.0 운영 배포 시각부터 이번 수정 요청 직전까지이다.
update public.terms_acceptances
set app_version_snapshot = '4.5.0'
where app_version_snapshot is null
  and accepted_at >= timestamptz '2026-07-29 09:00:00+09'
  and accepted_at <  timestamptz '2026-07-29 14:00:00+09';

update public.profiles p
set latest_app_version = latest.app_version_snapshot
from lateral (
  select a.app_version_snapshot
  from public.terms_acceptances a
  where a.user_id = p.id
    and a.app_version_snapshot is not null
  order by a.accepted_at desc
  limit 1
) latest
where p.latest_app_version is null;

-- 기존 동의 RPC를 그대로 사용하되, 성공 후 실제 앱 버전 스냅샷을 기록한다.
create or replace function public.complete_user_identity_and_consent_v2(
  p_entered_name text,
  p_new_pin text,
  p_pin_confirm text,
  p_final_pin text,
  p_terms_checked boolean,
  p_privacy_checked boolean,
  p_app_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_result jsonb;
  v_app_version text;
  v_confirmation text;
begin
  v_app_version := nullif(btrim(coalesce(p_app_version, '')), '');

  if v_app_version is null or v_app_version !~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'APP_VERSION_REQUIRED',
      'message', '현재 SAN WMS 앱 버전을 확인할 수 없습니다.'
    );
  end if;

  v_result := public.complete_user_identity_and_consent(
    p_entered_name,
    p_new_pin,
    p_pin_confirm,
    p_final_pin,
    p_terms_checked,
    p_privacy_checked
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    v_confirmation := nullif(v_result ->> 'confirmation_no', '');

    if v_confirmation is not null then
      update public.terms_acceptances
      set app_version_snapshot = v_app_version
      where confirmation_no = v_confirmation
        and user_id = auth.uid();
    end if;

    update public.profiles
    set latest_app_version = v_app_version,
        updated_at = now()
    where id = auth.uid();

    v_result := v_result || jsonb_build_object('app_version', v_app_version);
  end if;

  return v_result;
end;
$$;

-- PIN 검증을 한 곳에서 처리한다.
-- 일부 기존 bcrypt 구현이 저장한 $2b$/$2y$ 해시도 pgcrypto의 $2a$ 방식으로 검증한다.
create or replace function private.verify_user_pin_hash(
  p_pin text,
  p_pin_hash text
)
returns boolean
language plpgsql
stable
security definer
set search_path = private, public, extensions
as $$
declare
  v_pin text := btrim(coalesce(p_pin, ''));
  v_hash text := nullif(btrim(coalesce(p_pin_hash, '')), '');
  v_compat_hash text;
begin
  if v_pin !~ '^[0-9]{6}$' or v_hash is null then
    return false;
  end if;

  begin
    if crypt(v_pin, v_hash) = v_hash then
      return true;
    end if;
  exception when others then
    null;
  end;

  if v_hash ~ '^\$2[by]\$' then
    v_compat_hash := regexp_replace(v_hash, '^\$2[by]\$', '$2a$');
    begin
      return crypt(v_pin, v_compat_hash) = v_compat_hash;
    exception when others then
      return false;
    end;
  end if;

  return false;
end;
$$;

create or replace function public.verify_current_user_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_profile public.profiles%rowtype;
  v_pin private.user_pin_credentials%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_locked_until timestamptz;
  v_normalized_pin text := btrim(coalesce(p_pin, ''));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok',false,'error_code','NOT_AUTHENTICATED','message','로그인이 필요합니다.');
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid();

  if not found or not v_profile.active then
    return jsonb_build_object('ok',false,'error_code','ACCOUNT_INACTIVE','message','사용할 수 없는 계정입니다.');
  end if;

  if v_profile.is_service_account or v_profile.account_type <> 'HUMAN' then
    return jsonb_build_object('ok',false,'error_code','PIN_NOT_REQUIRED','message','개인 PIN 잠금 대상 계정이 아닙니다.');
  end if;

  if not public.user_access_ready(auth.uid()) then
    return jsonb_build_object('ok',false,'error_code','ACCESS_NOT_READY','message','본인확인, PIN 설정 또는 최신 이용조건 동의 상태를 확인하세요.');
  end if;

  select * into v_pin
  from private.user_pin_credentials
  where user_id = auth.uid()
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error_code','PIN_NOT_CONFIGURED','message','등록된 개인 PIN이 없습니다. 관리자에게 PIN 초기화를 요청하세요.');
  end if;

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
      'ok',false,
      'error_code','PIN_LOCKED',
      'message','PIN 입력 실패로 잠금 상태입니다. 잠시 후 다시 시도하세요.',
      'locked_until',v_pin.locked_until,
      'remaining_attempts',0
    );
  end if;

  if not private.verify_user_pin_hash(v_normalized_pin, v_pin.pin_hash) then
    v_attempts := coalesce(v_pin.failed_attempts, 0) + 1;
    v_locked_until := case when v_attempts >= 5 then v_now + interval '15 minutes' else null end;

    update private.user_pin_credentials
    set failed_attempts = v_attempts,
        locked_until = v_locked_until,
        updated_at = v_now
    where user_id = auth.uid();

    return jsonb_build_object(
      'ok',false,
      'error_code',case when v_attempts >= 5 then 'PIN_LOCKED' else 'INVALID_PIN' end,
      'message',case when v_attempts >= 5 then 'PIN을 5회 잘못 입력하여 15분간 잠겼습니다.' else '개인 PIN이 일치하지 않습니다.' end,
      'locked_until',v_locked_until,
      'remaining_attempts',greatest(0,5-v_attempts)
    );
  end if;

  -- 레거시 $2b$/$2y$ 해시는 검증 성공 시 pgcrypto 기본 bcrypt 해시로 교체한다.
  update private.user_pin_credentials
  set pin_hash = case
        when pin_hash ~ '^\$2[by]\$' then crypt(v_normalized_pin, gen_salt('bf', 12))
        else pin_hash
      end,
      failed_attempts = 0,
      locked_until = null,
      updated_at = v_now
  where user_id = auth.uid();

  return jsonb_build_object('ok',true,'verified_at',v_now);
end;
$$;

create or replace function public.get_my_terms_acceptances_v2()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,
    'confirmation_no',a.confirmation_no,
    'app_version',a.app_version_snapshot,
    'terms_version',a.terms_version,
    'terms_hash',a.terms_hash,
    'terms_title',a.terms_title,
    'terms_content',a.terms_content_snapshot,
    'privacy_notice_version',a.privacy_notice_version,
    'privacy_notice_hash',a.privacy_notice_hash,
    'privacy_notice_title',a.privacy_notice_title,
    'privacy_notice_content',a.privacy_notice_content_snapshot,
    'accepted_at',a.accepted_at,
    'authentication_method',a.authentication_method
  ) order by a.accepted_at desc),'[]'::jsonb)
  from public.terms_acceptances a
  where a.user_id=auth.uid();
$$;

drop function if exists public.admin_list_user_security_status();
create function public.admin_list_user_security_status()
returns table(
  id uuid,
  email text,
  display_name text,
  assigned_name text,
  legal_name text,
  role text,
  active boolean,
  account_type text,
  is_service_account boolean,
  pin_configured boolean,
  pin_set_at timestamptz,
  pin_reset_required boolean,
  latest_terms_accepted boolean,
  latest_terms_version text,
  latest_app_version text,
  latest_terms_accepted_at timestamptz,
  terms_acceptance_required boolean,
  last_sign_in_at timestamptz,
  disabled_at timestamptz,
  disable_reason text,
  deleted_at timestamptz,
  deletion_reason text
)
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  v_active_version text;
begin
  perform public.require_role(array['admin']);
  select version into v_active_version from public.terms_versions where is_active limit 1;

  return query
  select
    p.id,
    p.email,
    p.display_name,
    p.assigned_name,
    p.legal_name,
    p.role,
    p.active,
    p.account_type,
    p.is_service_account,
    (c.user_id is not null and p.pin_set_at is not null and not p.pin_reset_required),
    p.pin_set_at,
    p.pin_reset_required,
    (not p.terms_acceptance_required and p.latest_terms_version=v_active_version),
    p.latest_terms_version,
    p.latest_app_version,
    p.latest_terms_accepted_at,
    p.terms_acceptance_required,
    au.last_sign_in_at,
    p.disabled_at,
    p.disable_reason,
    p.deleted_at,
    p.deletion_reason
  from public.profiles p
  left join private.user_pin_credentials c on c.user_id=p.id
  left join auth.users au on au.id=p.id
  order by (p.deleted_at is not null),coalesce(p.legal_name,p.assigned_name,p.display_name,p.email);
end;
$$;

revoke all on function private.verify_user_pin_hash(text,text) from public,anon,authenticated;
revoke all on function public.complete_user_identity_and_consent_v2(text,text,text,text,boolean,boolean,text) from public,anon;
revoke all on function public.verify_current_user_pin(text) from public,anon;
revoke all on function public.get_my_terms_acceptances_v2() from public,anon;
revoke all on function public.admin_list_user_security_status() from public,anon;

grant execute on function public.complete_user_identity_and_consent_v2(text,text,text,text,boolean,boolean,text) to authenticated;
grant execute on function public.verify_current_user_pin(text) to authenticated;
grant execute on function public.get_my_terms_acceptances_v2() to authenticated;
grant execute on function public.admin_list_user_security_status() to authenticated;

notify pgrst, 'reload schema';
commit;

select 'SAN WMS V4.5.1 consent app version, PIN compatibility, and last login migration completed' as result;
