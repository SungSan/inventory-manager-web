-- SAN WMS V4.5.3
-- 이용조건 문서 버전은 앱 버전과 함께 갱신하되,
-- 자동 재동의는 메이저 버전(첫 번째 숫자)이 바뀔 때만 요구한다.
--
-- 예시:
--   4.2.7 -> 4.9.1 : 재동의 없음
--   4.5.2 -> 4.5.3 : 재동의 없음
--   4.x.x -> 5.0.0 : 재동의 필요
--
-- 30번 SQL이 V4.5.2에서 전체 사용자에게 잘못 설정한 재동의 요구도 보정한다.

begin;

create extension if not exists pgcrypto;

alter table public.terms_acceptances
  add column if not exists app_version_snapshot text;

alter table public.profiles
  add column if not exists latest_app_version text;

-- 버전 문자열에서 메이저 숫자만 안전하게 추출한다.
create or replace function public.semantic_version_major(p_version text)
returns integer
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when btrim(coalesce(p_version, '')) ~ '^[0-9]+(\.|$)'
      then split_part(btrim(p_version), '.', 1)::integer
    else null
  end;
$$;

-- 향후 배포 SQL에서 재동의 여부를 동일한 규칙으로 판단할 수 있는 공통 함수.
create or replace function public.legal_reconsent_required(
  p_previous_version text,
  p_next_version text
)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select public.semantic_version_major(p_previous_version)
         is distinct from
         public.semantic_version_major(p_next_version);
$$;

-- 과거 V4 프런트에서 동의했지만 앱 버전 스냅샷이 비어 있는 기록을 제한적으로 보정한다.
-- 2026-07-24 13:30 KST 이후는 V4 프런트 배포 이후 구간이다.
update public.terms_acceptances
set app_version_snapshot = case
  when accepted_at >= timestamptz '2026-07-29 09:00:00+09' then '4.5.0'
  else '4.0.0'
end
where app_version_snapshot is null
  and accepted_at >= timestamptz '2026-07-24 13:30:00+09';

update public.profiles p
set latest_app_version = (
      select a.app_version_snapshot
      from public.terms_acceptances a
      where a.user_id = p.id
        and a.app_version_snapshot is not null
      order by a.accepted_at desc
      limit 1
    ),
    updated_at = now()
where exists (
    select 1
    from public.terms_acceptances a
    where a.user_id = p.id
      and a.app_version_snapshot is not null
  )
  and p.latest_app_version is distinct from (
    select a.app_version_snapshot
    from public.terms_acceptances a
    where a.user_id = p.id
      and a.app_version_snapshot is not null
    order by a.accepted_at desc
    limit 1
  );

-- 현재 활성 원문을 V4.5.3 문서 행으로 복제한다.
-- 기존 문서 행과 기존 동의 스냅샷은 변경하지 않는다.
do $$
declare
  v_terms public.terms_versions%rowtype;
  v_privacy public.privacy_notice_versions%rowtype;
  v_terms_content text;
  v_privacy_content text;
  v_effective_at timestamptz := clock_timestamp();
begin
  select * into v_terms
  from public.terms_versions
  where is_active
  order by effective_at desc
  limit 1;

  if not found then
    raise exception '활성 이용조건 문서를 찾을 수 없습니다.';
  end if;

  select * into v_privacy
  from public.privacy_notice_versions
  where is_active
  order by effective_at desc
  limit 1;

  if not found then
    raise exception '활성 개인정보 안내 문서를 찾을 수 없습니다.';
  end if;

  v_terms_content := regexp_replace(
    v_terms.content,
    '버전\s*:\s*\[[^]]+\]',
    '버전: [4.5.3]'
  );

  if v_terms_content = v_terms.content then
    v_terms_content := '버전: [4.5.3]' || E'\n\n' || v_terms.content;
  end if;

  v_privacy_content := regexp_replace(
    v_privacy.content,
    '버전\s*:\s*\[[^]]+\]',
    '버전: [4.5.3]'
  );

  if v_privacy_content = v_privacy.content then
    v_privacy_content := '버전: [4.5.3]' || E'\n\n' || v_privacy.content;
  end if;

  update public.terms_versions
  set is_active = false
  where is_active;

  insert into public.terms_versions(
    version,
    title,
    content,
    content_hash,
    effective_at,
    is_active
  )
  values (
    '4.5.3',
    v_terms.title,
    v_terms_content,
    encode(digest(v_terms_content, 'sha256'), 'hex'),
    v_effective_at,
    true
  )
  on conflict (version) do update
  set title = excluded.title,
      content = excluded.content,
      content_hash = excluded.content_hash,
      effective_at = excluded.effective_at,
      is_active = true;

  update public.privacy_notice_versions
  set is_active = false
  where is_active;

  insert into public.privacy_notice_versions(
    version,
    title,
    content,
    content_hash,
    effective_at,
    is_active
  )
  values (
    '4.5.3',
    v_privacy.title,
    v_privacy_content,
    encode(digest(v_privacy_content, 'sha256'), 'hex'),
    v_effective_at,
    true
  )
  on conflict (version) do update
  set title = excluded.title,
      content = excluded.content,
      content_hash = excluded.content_hash,
      effective_at = excluded.effective_at,
      is_active = true;
end;
$$;

-- 사용자 준비상태는 정확한 patch/minor 버전이 아니라 메이저 버전 동의 여부로 판단한다.
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
      when p.is_service_account or p.account_type <> 'HUMAN' then true
      else
        c.user_id is not null
        and p.pin_set_at is not null
        and not p.pin_reset_required
        and not p.terms_acceptance_required
        and exists (
          select 1
          from public.terms_acceptances a
          where a.user_id = p.id
            and public.semantic_version_major(
              coalesce(a.app_version_snapshot, a.terms_version)
            ) = public.semantic_version_major(
              (select t.version from public.terms_versions t where t.is_active limit 1)
            )
        )
    end
    from public.profiles p
    left join private.user_pin_credentials c on c.user_id = p.id
    where p.id = p_user_id
  ), false);
$$;

-- 30번 SQL에서 같은 V4 사용자 전체에 잘못 설정한 재동의를 해제한다.
-- V4 동의 기록이 없는 계정은 재동의 요구 상태를 유지한다.
update public.profiles p
set terms_acceptance_required = not exists (
      select 1
      from public.terms_acceptances a
      where a.user_id = p.id
        and public.semantic_version_major(
          coalesce(a.app_version_snapshot, a.terms_version)
        ) = public.semantic_version_major(
          (select t.version from public.terms_versions t where t.is_active limit 1)
        )
    ),
    updated_at = now()
where p.active = true
  and p.account_type = 'HUMAN'
  and not p.is_service_account
  and p.deleted_at is null;

-- 관리자 사용자 목록도 동일한 메이저 버전 기준으로 동의 완료를 판단한다.
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

  select version into v_active_version
  from public.terms_versions
  where is_active
  limit 1;

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
    (
      not p.terms_acceptance_required
      and exists (
        select 1
        from public.terms_acceptances a
        where a.user_id = p.id
          and public.semantic_version_major(
            coalesce(a.app_version_snapshot, a.terms_version)
          ) = public.semantic_version_major(v_active_version)
      )
    ),
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
  left join private.user_pin_credentials c on c.user_id = p.id
  left join auth.users au on au.id = p.id
  order by
    (p.deleted_at is not null),
    coalesce(p.legal_name, p.assigned_name, p.display_name, p.email);
end;
$$;

revoke all on function public.semantic_version_major(text) from public, anon;
revoke all on function public.legal_reconsent_required(text, text) from public, anon;
revoke all on function public.user_access_ready(uuid) from public, anon;
revoke all on function public.admin_list_user_security_status() from public, anon;

grant execute on function public.semantic_version_major(text) to authenticated;
grant execute on function public.legal_reconsent_required(text, text) to authenticated;
grant execute on function public.user_access_ready(uuid) to authenticated;
grant execute on function public.admin_list_user_security_status() to authenticated;

notify pgrst, 'reload schema';

commit;

select
  (select version from public.terms_versions where is_active limit 1) as active_terms_version,
  (select version from public.privacy_notice_versions where is_active limit 1) as active_privacy_version,
  public.legal_reconsent_required('4.2.7', '4.9.1') as same_major_requires_reconsent,
  public.legal_reconsent_required('4.9.1', '5.0.0') as next_major_requires_reconsent,
  count(*) filter (where terms_acceptance_required) as users_requiring_reconsent,
  'SAN WMS V4.5.3 major-version consent policy completed' as result
from public.profiles
where active = true
  and account_type = 'HUMAN'
  and not is_service_account
  and deleted_at is null;
