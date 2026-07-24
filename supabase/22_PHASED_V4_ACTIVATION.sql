-- SAN WMS V4.0.0
-- 무중단 단계적 활성화
-- 20, 21 마이그레이션 설치 직후 실행하면 본인확인 강제 차단을 잠시 비활성화한다.
-- V4 프런트 배포가 완료된 후 admin_activate_identity_enforcement()를 1회 실행한다.

begin;

create table if not exists public.system_feature_flags (
  feature_key text primary key,
  enabled boolean not null default false,
  initialized boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.system_feature_flags(feature_key,enabled,initialized,updated_at)
values('IDENTITY_ENFORCEMENT',false,true,now())
on conflict(feature_key) do update
set enabled=false,
    initialized=true,
    updated_at=now();

create or replace function public.identity_enforcement_enabled()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce((select f.enabled from public.system_feature_flags f where f.feature_key='IDENTITY_ENFORCEMENT'),false);
$$;

create or replace function public.user_access_ready(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce((
    select case
      when not p.active then false
      when not public.identity_enforcement_enabled() then true
      when p.is_service_account or p.account_type <> 'HUMAN' then true
      else
        c.user_id is not null
        and p.pin_set_at is not null
        and not p.pin_reset_required
        and not p.terms_acceptance_required
        and p.latest_terms_version = (select t.version from public.terms_versions t where t.is_active limit 1)
        and exists (
          select 1 from public.terms_acceptances a
          where a.user_id = p.id
            and a.terms_version = (select t2.version from public.terms_versions t2 where t2.is_active limit 1)
        )
    end
    from public.profiles p
    left join private.user_pin_credentials c on c.user_id=p.id
    where p.id=p_user_id
  ),false);
$$;

create or replace function public.admin_activate_identity_enforcement()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_affected integer;
begin
  perform public.require_role(array['admin']);

  update public.system_feature_flags
  set enabled=true,
      initialized=true,
      updated_by=auth.uid(),
      updated_at=now()
  where feature_key='IDENTITY_ENFORCEMENT';

  select count(*) into v_affected
  from public.profiles p
  where p.active
    and p.account_type='HUMAN'
    and not p.is_service_account
    and not public.user_access_ready(p.id);

  perform public.write_audit(
    'IDENTITY_ENFORCEMENT_ACTIVATED',
    'system_feature',
    'IDENTITY_ENFORCEMENT',
    '본인확인·PIN·이용조건 동의 강제 적용',
    jsonb_build_object('enabled',false),
    jsonb_build_object('enabled',true,'pending_human_accounts',v_affected),
    'V4 프런트 배포 후 관리자 활성화'
  );

  return jsonb_build_object(
    'ok',true,
    'enabled',true,
    'pending_human_accounts',v_affected,
    'message','기존 및 신규 HUMAN 계정에 본인확인·PIN·최신 이용조건 동의를 강제 적용했습니다.'
  );
end;
$$;

create or replace function public.admin_deactivate_identity_enforcement(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.require_role(array['admin']);

  if nullif(btrim(p_reason),'') is null then
    raise exception '긴급 비활성화 사유를 입력하세요.';
  end if;

  update public.system_feature_flags
  set enabled=false,
      updated_by=auth.uid(),
      updated_at=now()
  where feature_key='IDENTITY_ENFORCEMENT';

  perform public.write_audit(
    'IDENTITY_ENFORCEMENT_DEACTIVATED',
    'system_feature',
    'IDENTITY_ENFORCEMENT',
    '본인확인 강제 차단 긴급 해제',
    jsonb_build_object('enabled',true),
    jsonb_build_object('enabled',false),
    p_reason
  );

  return jsonb_build_object(
    'ok',true,
    'enabled',false,
    'message','본인확인 강제 차단을 긴급 해제했습니다. 저장된 PIN·동의 기록과 요구 상태는 삭제하지 않았습니다.'
  );
end;
$$;

create or replace function public.get_identity_enforcement_status()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  v_role:=public.current_role();
  return jsonb_build_object(
    'enabled',public.identity_enforcement_enabled(),
    'is_admin',v_role='admin',
    'updated_at',(select updated_at from public.system_feature_flags where feature_key='IDENTITY_ENFORCEMENT')
  );
end;
$$;

alter table public.system_feature_flags enable row level security;

drop policy if exists system_feature_admin_read on public.system_feature_flags;
create policy system_feature_admin_read on public.system_feature_flags
for select to authenticated
using(public.current_role()='admin');

revoke insert,update,delete on public.system_feature_flags from public,anon,authenticated;
grant select on public.system_feature_flags to authenticated;
grant execute on function public.identity_enforcement_enabled() to authenticated;
grant execute on function public.admin_activate_identity_enforcement() to authenticated;
grant execute on function public.admin_deactivate_identity_enforcement(text) to authenticated;
grant execute on function public.get_identity_enforcement_status() to authenticated;

notify pgrst, 'reload schema';
commit;

select 'SAN WMS V4.0.0 phased activation installed; identity enforcement is currently OFF' as result;
