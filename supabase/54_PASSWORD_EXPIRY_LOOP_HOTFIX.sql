-- SAN WMS V5.1.6: stop false password-expiry loops.
-- auth.users.updated_at is not a password-only timestamp and can change after authentication,
-- so it must not participate in password expiry decisions.
begin;

create or replace function public.password_access_ready(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce((
    select case
      when p.role='admin' or p.is_service_account or p.account_type<>'HUMAN' then true
      else p.password_changed_at is not null
        and p.password_expires_at is not null
        and p.password_expires_at>clock_timestamp()
    end
    from public.profiles p
    where p.id=p_user_id
  ),false);
$$;

revoke all on function public.password_access_ready(uuid) from public,anon,authenticated;
grant execute on function public.password_access_ready(uuid) to authenticated;

notify pgrst,'reload schema';
commit;

select 'SAN WMS V5.1.6 password expiry loop hotfix completed' as result;
