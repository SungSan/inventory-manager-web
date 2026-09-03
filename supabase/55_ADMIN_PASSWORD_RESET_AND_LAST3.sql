-- SAN WMS V5.1.8: per-user admin password reset and last-three reuse policy
begin;

-- Reuse is blocked only for the latest three entries; older fingerprints may recur.
alter table public.password_history
  drop constraint if exists password_history_user_id_password_fingerprint_key;

-- Includes the SQL54 hotfix: auth.users.updated_at is not a password-only timestamp.
create or replace function public.password_access_ready(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select case
    when p.role='admin' or p.is_service_account or p.account_type<>'HUMAN' then true
    else p.password_changed_at is not null and p.password_expires_at is not null
      and p.password_expires_at>clock_timestamp() end
    from public.profiles p where p.id=p_user_id),false);
$$;

create or replace function public.admin_mark_password_reset_required(p_actor_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor public.profiles%rowtype; v_target public.profiles%rowtype;
begin
  if current_user not in ('service_role','postgres') then raise exception '서버 전용 기능입니다.'; end if;
  select * into v_actor from public.profiles where id=p_actor_id;
  if not found or v_actor.role<>'admin' or not v_actor.active or v_actor.deleted_at is not null then raise exception '관리자 권한이 필요합니다.'; end if;
  select * into v_target from public.profiles where id=p_user_id for update;
  if not found or not v_target.active or v_target.deleted_at is not null then raise exception '활성 사용자를 찾을 수 없습니다.'; end if;
  if v_target.id=v_actor.id or v_target.role='admin' or v_target.account_type<>'HUMAN' or v_target.is_service_account then raise exception '일반 사용자 계정만 초기화할 수 있습니다.'; end if;
  update public.profiles set password_changed_at=null,password_expires_at=null,password_auth_updated_at=null,updated_at=clock_timestamp() where id=p_user_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,entity_label,note)
  values(p_actor_id,'ADMIN_PASSWORD_RESET','USER',p_user_id::text,public.user_label(p_user_id),'관리자가 사용자 1명의 비밀번호를 초기화하고 다음 로그인 변경을 요구했습니다.');
end; $$;

revoke all on function public.password_access_ready(uuid),public.admin_mark_password_reset_required(uuid,uuid) from public,anon,authenticated;
grant execute on function public.password_access_ready(uuid) to authenticated;
grant execute on function public.admin_mark_password_reset_required(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
select 'SAN WMS V5.1.8 admin password reset and last-three policy completed' as result;
