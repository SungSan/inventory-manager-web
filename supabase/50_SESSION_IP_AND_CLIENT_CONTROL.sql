-- SAN WMS V5.0.8: server-observed session IP and admin client control
begin;

alter table public.profiles
  add column if not exists last_access_ip inet,
  add column if not exists last_access_at timestamptz;

create table if not exists public.client_control_events (
  id bigint generated always as identity primary key,
  action text not null check(action in ('RELOAD','SIGN_OUT')),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references public.profiles(id)
);

alter table public.client_control_events enable row level security;
revoke all on table public.client_control_events from public,anon,authenticated;

create or replace function public.record_my_session_ip()
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_headers jsonb;
  v_raw text;
  v_ip inet;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  begin
    v_headers := nullif(current_setting('request.headers',true),'')::jsonb;
  exception when others then
    v_headers := '{}'::jsonb;
  end;
  v_raw := nullif(trim(split_part(coalesce(
    v_headers->>'cf-connecting-ip',
    v_headers->>'x-forwarded-for',
    v_headers->>'x-real-ip',
    ''
  ),',',1)),'');
  if v_raw is not null then
    begin v_ip := v_raw::inet; exception when others then v_ip := null; end;
  end if;
  update public.profiles
  set last_access_ip=v_ip,last_access_at=clock_timestamp()
  where id=auth.uid();
  return host(v_ip);
end;
$$;

create or replace function public.admin_issue_client_control(p_action text)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare v_action text:=upper(trim(coalesce(p_action,''))); v_id bigint;
begin
  perform public.require_role(array['admin']);
  if v_action not in ('RELOAD','SIGN_OUT') then raise exception '지원하지 않는 제어 명령입니다.'; end if;
  insert into public.client_control_events(action,created_by) values(v_action,auth.uid()) returning id into v_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,entity_label,note)
  values(auth.uid(),'ADMIN_CLIENT_'||v_action,'SYSTEM',v_id::text,
    case v_action when 'RELOAD' then '전체 강제 새로고침' else '전체 강제 로그아웃' end,
    '관리자가 현재 접속 세션 전체에 명령을 실행했습니다.');
  return v_id;
end;
$$;

drop function if exists public.admin_list_user_security_status();
create function public.admin_list_user_security_status()
returns table(
  id uuid,email text,display_name text,assigned_name text,legal_name text,role text,active boolean,
  account_type text,is_service_account boolean,pin_configured boolean,pin_set_at timestamptz,pin_reset_required boolean,
  latest_terms_accepted boolean,latest_terms_version text,latest_app_version text,latest_terms_accepted_at timestamptz,
  terms_acceptance_required boolean,last_sign_in_at timestamptz,last_access_ip text,last_access_at timestamptz,
  disabled_at timestamptz,disable_reason text,deleted_at timestamptz,deletion_reason text
)
language plpgsql
security definer
set search_path=public,private,auth
as $$
declare v_active_version text;
begin
  perform public.require_role(array['admin']);
  select version into v_active_version from public.terms_versions where is_active limit 1;
  return query select
    p.id,p.email,p.display_name,p.assigned_name,p.legal_name,p.role,p.active,p.account_type,p.is_service_account,
    (c.user_id is not null and p.pin_set_at is not null and not p.pin_reset_required),p.pin_set_at,p.pin_reset_required,
    (not p.terms_acceptance_required and p.latest_terms_version=v_active_version),p.latest_terms_version,p.latest_app_version,
    p.latest_terms_accepted_at,p.terms_acceptance_required,au.last_sign_in_at,host(p.last_access_ip),p.last_access_at,
    p.disabled_at,p.disable_reason,p.deleted_at,p.deletion_reason
  from public.profiles p
  left join private.user_pin_credentials c on c.user_id=p.id
  left join auth.users au on au.id=p.id
  order by (p.deleted_at is not null),coalesce(p.legal_name,p.assigned_name,p.display_name,p.email);
end;
$$;

revoke all on function public.record_my_session_ip() from public,anon;
revoke all on function public.admin_issue_client_control(text) from public,anon,authenticated;
revoke all on function public.admin_list_user_security_status() from public,anon;
grant execute on function public.record_my_session_ip() to authenticated;
grant execute on function public.admin_issue_client_control(text) to authenticated;
grant execute on function public.admin_list_user_security_status() to authenticated;

notify pgrst,'reload schema';
commit;

select 'SAN WMS V5.0.8 session IP and client control migration completed' as result;
