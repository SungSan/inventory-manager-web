-- SAN WMS V5.1.5: self-service password changes, 90-day expiry and no reuse
begin;

alter table public.profiles
  add column if not exists password_changed_at timestamptz,
  add column if not exists password_expires_at timestamptz,
  add column if not exists password_auth_updated_at timestamptz;

create table if not exists public.password_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  password_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(user_id,password_fingerprint)
);
create index if not exists password_history_user_created_idx on public.password_history(user_id,created_at desc);
alter table public.password_history enable row level security;
revoke all on table public.password_history from public,anon,authenticated;

-- Administrators and non-human accounts are exempt from forced rotation. Every existing
-- non-admin human account remains NULL and must change once on its next login.
update public.profiles p
set password_changed_at=coalesce(p.password_changed_at,clock_timestamp()),
    password_expires_at=coalesce(p.password_expires_at,clock_timestamp()+interval '90 days'),
    password_auth_updated_at=coalesce(p.password_auth_updated_at,u.updated_at)
from auth.users u where u.id=p.id
  and (p.role='admin' or p.is_service_account or p.account_type<>'HUMAN');

create or replace function public.identity_access_ready(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,private as $$
  select coalesce((select case
    when not p.active or p.deleted_at is not null then false
    when p.is_service_account or p.account_type<>'HUMAN' then true
    else c.user_id is not null and p.pin_set_at is not null and not p.pin_reset_required
      and not p.terms_acceptance_required and exists(
        select 1 from public.terms_acceptances a where a.user_id=p.id
          and public.semantic_version_major(coalesce(a.app_version_snapshot,a.terms_version))=
              public.semantic_version_major((select t.version from public.terms_versions t where t.is_active limit 1))
      ) end
    from public.profiles p left join private.user_pin_credentials c on c.user_id=p.id where p.id=p_user_id),false);
$$;

create or replace function public.password_access_ready(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public,auth as $$
  select coalesce((select case when p.role='admin' or p.is_service_account or p.account_type<>'HUMAN' then true else
    p.password_changed_at is not null and p.password_expires_at>clock_timestamp()
    and p.password_auth_updated_at is not distinct from u.updated_at end
    from public.profiles p join auth.users u on u.id=p.id where p.id=p_user_id),false);
$$;

create or replace function public.user_access_ready(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select public.identity_access_ready(p_user_id) and public.password_access_ready(p_user_id);
$$;

create or replace function public.get_user_access_status()
returns jsonb language plpgsql security definer set search_path=public,private as $$
declare v_profile public.profiles%rowtype; v_terms public.terms_versions%rowtype;
  v_privacy public.privacy_notice_versions%rowtype; v_pin private.user_pin_credentials%rowtype;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select * into v_profile from public.profiles where id=auth.uid();
  if not found then raise exception '사용자 프로필을 찾을 수 없습니다.'; end if;
  select * into v_terms from public.terms_versions where is_active limit 1;
  select * into v_privacy from public.privacy_notice_versions where is_active limit 1;
  select * into v_pin from private.user_pin_credentials where user_id=auth.uid();
  return jsonb_build_object(
    'user_id',v_profile.id,'login_id',v_profile.email,
    'assigned_name',coalesce(v_profile.assigned_name,v_profile.display_name,v_profile.email),'legal_name',v_profile.legal_name,
    'active',v_profile.active,'disabled_at',v_profile.disabled_at,'disable_reason',v_profile.disable_reason,
    'deleted_at',v_profile.deleted_at,'deletion_reason',v_profile.deletion_reason,
    'account_type',v_profile.account_type,'is_service_account',v_profile.is_service_account,
    'pin_configured',v_pin.user_id is not null and v_profile.pin_set_at is not null,
    'pin_reset_required',v_profile.pin_reset_required,'terms_acceptance_required',v_profile.terms_acceptance_required,
    'latest_terms_version',v_profile.latest_terms_version,'latest_app_version',v_profile.latest_app_version,
    'latest_terms_accepted_at',v_profile.latest_terms_accepted_at,
    'identity_ready',public.identity_access_ready(auth.uid()),
    'password_change_required',not public.password_access_ready(auth.uid()),
    'password_changed_at',v_profile.password_changed_at,'password_expires_at',v_profile.password_expires_at,
    'access_ready',public.user_access_ready(auth.uid()),
    'terms',jsonb_build_object('version',v_terms.version,'title',v_terms.title,'content',v_terms.content,'content_hash',v_terms.content_hash,'effective_at',v_terms.effective_at),
    'privacy_notice',jsonb_build_object('version',v_privacy.version,'title',v_privacy.title,'content',v_privacy.content,'content_hash',v_privacy.content_hash,'effective_at',v_privacy.effective_at));
end; $$;

-- Service-role-only completion called after Supabase Auth has changed the password.
create or replace function public.complete_my_password_change(p_user_id uuid,p_auth_updated_at timestamptz)
returns void language plpgsql security definer set search_path=public,auth as $$
declare v_actual timestamptz;
begin
  if current_user not in ('service_role','postgres') then raise exception '서버 전용 기능입니다.'; end if;
  select updated_at into v_actual from auth.users where id=p_user_id;
  if v_actual is null or v_actual is distinct from p_auth_updated_at then raise exception '인증 변경 시각이 일치하지 않습니다.'; end if;
  update public.profiles set password_changed_at=clock_timestamp(),password_expires_at=clock_timestamp()+interval '90 days',
    password_auth_updated_at=v_actual,updated_at=clock_timestamp() where id=p_user_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,entity_label,note)
  values(p_user_id,'PASSWORD_CHANGED','USER',p_user_id::text,public.user_label(p_user_id),'사용자가 비밀번호를 직접 변경했습니다.');
end; $$;

revoke all on function public.identity_access_ready(uuid),public.password_access_ready(uuid),public.complete_my_password_change(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.identity_access_ready(uuid),public.password_access_ready(uuid) to authenticated;
grant execute on function public.complete_my_password_change(uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
select 'SAN WMS V5.1.5 password lifecycle migration completed' as result;
