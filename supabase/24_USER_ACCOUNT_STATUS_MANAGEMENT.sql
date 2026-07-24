-- SAN WMS V4.1.0
-- 관리자 사용자 사용금지 · 사용허용 · 논리 삭제 · 삭제 복구
--
-- 물리 DELETE를 사용하지 않는다.
-- 작업·동의·감사·출고요청 이력을 보존하면서 일반 목록에서는 삭제 상태로 처리한다.

begin;

alter table public.profiles
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid references auth.users(id) on delete set null,
  add column if not exists disable_reason text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null,
  add column if not exists deletion_reason text;

create index if not exists idx_profiles_account_status
  on public.profiles(active, deleted_at, role);

create or replace function public.assert_user_account_status_change_allowed(
  p_user_id uuid,
  p_action text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles%rowtype;
  v_active_admins integer;
begin
  perform public.require_role(array['admin']);

  if p_user_id is null then
    raise exception '대상 사용자를 선택하세요.';
  end if;

  if p_user_id = auth.uid() then
    raise exception '현재 로그인한 관리자 본인 계정은 % 처리할 수 없습니다.', p_action;
  end if;

  select * into v_target
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;

  if v_target.role = 'admin' and v_target.active and v_target.deleted_at is null then
    select count(*) into v_active_admins
    from public.profiles
    where role = 'admin'
      and active = true
      and deleted_at is null;

    if v_active_admins <= 1 then
      raise exception '마지막 활성 관리자 계정은 % 처리할 수 없습니다.', p_action;
    end if;
  end if;

  if to_regclass('public.work_requests') is not null and exists (
    select 1
    from public.work_requests w
    where w.status in ('SCHEDULED','IN_PROGRESS','PARTIAL')
      and (w.assigned_to = p_user_id or w.reserved_user_id = p_user_id)
  ) then
    raise exception '진행 또는 예약된 업무요청이 있습니다. 다른 작업자에게 이관한 뒤 % 처리하세요.', p_action;
  end if;

  return v_target;
end;
$$;

create or replace function public.admin_set_user_active(
  p_user_id uuid,
  p_active boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles%rowtype;
  v_reason text;
begin
  v_reason := nullif(btrim(coalesce(p_reason,'')), '');

  if not coalesce(p_active,false) and v_reason is null then
    raise exception '사용금지 사유를 입력하세요.';
  end if;

  if coalesce(p_active,false) then
    perform public.require_role(array['admin']);
    select * into v_target from public.profiles where id=p_user_id for update;
    if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;
    if v_target.deleted_at is not null then
      raise exception '삭제 처리된 계정입니다. 삭제 복구 기능을 사용하세요.';
    end if;

    update public.profiles
    set active=true,
        disabled_at=null,
        disabled_by=null,
        disable_reason=null,
        updated_at=now()
    where id=p_user_id;

    perform public.write_audit(
      'USER_ACCESS_ENABLED','user',p_user_id::text,public.user_label(p_user_id),
      jsonb_build_object('active',v_target.active,'disabled_at',v_target.disabled_at,'disable_reason',v_target.disable_reason),
      jsonb_build_object('active',true),
      coalesce(v_reason,'관리자 사용 허용')
    );
    return;
  end if;

  v_target := public.assert_user_account_status_change_allowed(p_user_id,'사용금지');
  if v_target.deleted_at is not null then
    raise exception '이미 삭제 처리된 계정입니다.';
  end if;

  update public.profiles
  set active=false,
      disabled_at=clock_timestamp(),
      disabled_by=auth.uid(),
      disable_reason=v_reason,
      updated_at=now()
  where id=p_user_id;

  perform public.write_audit(
    'USER_ACCESS_DISABLED','user',p_user_id::text,public.user_label(p_user_id),
    jsonb_build_object('active',v_target.active),
    jsonb_build_object('active',false,'disable_reason',v_reason),
    v_reason
  );
end;
$$;

create or replace function public.admin_delete_user_account(
  p_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_target public.profiles%rowtype;
  v_reason text;
  v_label text;
begin
  v_reason := nullif(btrim(coalesce(p_reason,'')), '');
  if v_reason is null then raise exception '삭제 사유를 입력하세요.'; end if;

  v_target := public.assert_user_account_status_change_allowed(p_user_id,'삭제');
  if v_target.deleted_at is not null then raise exception '이미 삭제 처리된 계정입니다.'; end if;
  v_label := public.user_label(p_user_id);

  delete from private.user_pin_credentials where user_id=p_user_id;

  update public.profiles
  set active=false,
      disabled_at=coalesce(disabled_at,clock_timestamp()),
      disabled_by=coalesce(disabled_by,auth.uid()),
      disable_reason=coalesce(disable_reason,'계정 삭제 처리'),
      deleted_at=clock_timestamp(),
      deleted_by=auth.uid(),
      deletion_reason=v_reason,
      pin_set_at=null,
      pin_reset_required=false,
      terms_acceptance_required=false,
      updated_at=now()
  where id=p_user_id;

  update public.worker_kpi_settings
  set active=false,updated_by=auth.uid(),updated_at=now()
  where user_id=p_user_id;

  perform public.write_audit(
    'USER_ACCOUNT_DELETED','user',p_user_id::text,v_label,
    jsonb_build_object('active',v_target.active,'deleted_at',v_target.deleted_at),
    jsonb_build_object('active',false,'deleted',true,'deletion_reason',v_reason),
    v_reason
  );
end;
$$;

create or replace function public.admin_restore_deleted_user(
  p_user_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles%rowtype;
  v_reason text;
begin
  perform public.require_role(array['admin']);
  if p_user_id = auth.uid() then raise exception '현재 로그인한 계정에는 적용할 수 없습니다.'; end if;

  select * into v_target from public.profiles where id=p_user_id for update;
  if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;
  if v_target.deleted_at is null then raise exception '삭제 처리된 계정이 아닙니다.'; end if;

  v_reason := coalesce(nullif(btrim(coalesce(p_reason,'')),''),'관리자 삭제 복구');

  update public.profiles
  set active=true,
      disabled_at=null,
      disabled_by=null,
      disable_reason=null,
      deleted_at=null,
      deleted_by=null,
      deletion_reason=null,
      pin_set_at=null,
      pin_reset_required=case when account_type='HUMAN' and not is_service_account then true else false end,
      terms_acceptance_required=case when account_type='HUMAN' and not is_service_account then true else false end,
      updated_at=now()
  where id=p_user_id;

  perform public.write_audit(
    'USER_ACCOUNT_RESTORED','user',p_user_id::text,public.user_label(p_user_id),
    jsonb_build_object('deleted_at',v_target.deleted_at,'deletion_reason',v_target.deletion_reason),
    jsonb_build_object('active',true,'pin_reset_required',true,'terms_acceptance_required',true),
    v_reason
  );
end;
$$;

create or replace function public.get_user_access_status()
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_profile public.profiles%rowtype;
  v_terms public.terms_versions%rowtype;
  v_privacy public.privacy_notice_versions%rowtype;
  v_pin private.user_pin_credentials%rowtype;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select * into v_profile from public.profiles where id=auth.uid();
  if not found then raise exception '사용자 프로필을 찾을 수 없습니다.'; end if;
  select * into v_terms from public.terms_versions where is_active limit 1;
  select * into v_privacy from public.privacy_notice_versions where is_active limit 1;
  select * into v_pin from private.user_pin_credentials where user_id=auth.uid();

  return jsonb_build_object(
    'user_id',v_profile.id,
    'login_id',v_profile.email,
    'assigned_name',coalesce(v_profile.assigned_name,v_profile.display_name,v_profile.email),
    'legal_name',v_profile.legal_name,
    'active',v_profile.active,
    'disabled_at',v_profile.disabled_at,
    'disable_reason',v_profile.disable_reason,
    'deleted_at',v_profile.deleted_at,
    'deletion_reason',v_profile.deletion_reason,
    'account_type',v_profile.account_type,
    'is_service_account',v_profile.is_service_account,
    'pin_configured',v_pin.user_id is not null and v_profile.pin_set_at is not null,
    'pin_reset_required',v_profile.pin_reset_required,
    'terms_acceptance_required',v_profile.terms_acceptance_required,
    'latest_terms_version',v_profile.latest_terms_version,
    'latest_terms_accepted_at',v_profile.latest_terms_accepted_at,
    'access_ready',public.user_access_ready(auth.uid()),
    'terms',jsonb_build_object('version',v_terms.version,'title',v_terms.title,'content',v_terms.content,'content_hash',v_terms.content_hash,'effective_at',v_terms.effective_at),
    'privacy_notice',jsonb_build_object('version',v_privacy.version,'title',v_privacy.title,'content',v_privacy.content,'content_hash',v_privacy.content_hash,'effective_at',v_privacy.effective_at)
  );
end;
$$;

drop function if exists public.admin_list_user_security_status();
create function public.admin_list_user_security_status()
returns table(
  id uuid,email text,display_name text,assigned_name text,legal_name text,role text,active boolean,
  account_type text,is_service_account boolean,pin_configured boolean,pin_set_at timestamptz,pin_reset_required boolean,
  latest_terms_accepted boolean,latest_terms_version text,latest_terms_accepted_at timestamptz,terms_acceptance_required boolean,
  disabled_at timestamptz,disable_reason text,deleted_at timestamptz,deletion_reason text
)
language plpgsql
security definer
set search_path = public, private
as $$
declare v_active_version text;
begin
  perform public.require_role(array['admin']);
  select version into v_active_version from public.terms_versions where is_active limit 1;
  return query
  select p.id,p.email,p.display_name,p.assigned_name,p.legal_name,p.role,p.active,p.account_type,p.is_service_account,
    (c.user_id is not null and p.pin_set_at is not null and not p.pin_reset_required),p.pin_set_at,p.pin_reset_required,
    (not p.terms_acceptance_required and p.latest_terms_version=v_active_version),p.latest_terms_version,p.latest_terms_accepted_at,p.terms_acceptance_required,
    p.disabled_at,p.disable_reason,p.deleted_at,p.deletion_reason
  from public.profiles p
  left join private.user_pin_credentials c on c.user_id=p.id
  order by (p.deleted_at is not null),coalesce(p.legal_name,p.assigned_name,p.display_name,p.email);
end;
$$;

revoke all on function public.assert_user_account_status_change_allowed(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_set_user_active(uuid,boolean,text) to authenticated;
grant execute on function public.admin_delete_user_account(uuid,text) to authenticated;
grant execute on function public.admin_restore_deleted_user(uuid,text) to authenticated;
grant execute on function public.admin_list_user_security_status() to authenticated;

notify pgrst, 'reload schema';
commit;

select 'SAN WMS V4.1.0 user account status management migration completed' as result;
