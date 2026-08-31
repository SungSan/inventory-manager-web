-- SAN WMS V5.0.0: activate V5 legal documents and require one-time V5 re-consent
-- Existing V4 documents and acceptance records are preserved.

begin;

create extension if not exists pgcrypto;

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
  if not found then raise exception '활성 이용조건 문서를 찾을 수 없습니다.'; end if;

  select * into v_privacy
  from public.privacy_notice_versions
  where is_active
  order by effective_at desc
  limit 1;
  if not found then raise exception '활성 개인정보 안내 문서를 찾을 수 없습니다.'; end if;

  v_terms_content := regexp_replace(v_terms.content,'버전\s*:\s*\[[^]]+\]','버전: [5.0.0]');
  if v_terms_content=v_terms.content then
    v_terms_content := '버전: [5.0.0]' || E'\n\n' || v_terms.content;
  end if;

  v_privacy_content := regexp_replace(v_privacy.content,'버전\s*:\s*\[[^]]+\]','버전: [5.0.0]');
  if v_privacy_content=v_privacy.content then
    v_privacy_content := '버전: [5.0.0]' || E'\n\n' || v_privacy.content;
  end if;

  update public.terms_versions set is_active=false where is_active;
  insert into public.terms_versions(version,title,content,content_hash,effective_at,is_active)
  values('5.0.0',v_terms.title,v_terms_content,encode(digest(v_terms_content,'sha256'),'hex'),v_effective_at,true)
  on conflict(version) do update set
    title=excluded.title,
    content=excluded.content,
    content_hash=excluded.content_hash,
    effective_at=excluded.effective_at,
    is_active=true;

  update public.privacy_notice_versions set is_active=false where is_active;
  insert into public.privacy_notice_versions(version,title,content,content_hash,effective_at,is_active)
  values('5.0.0',v_privacy.title,v_privacy_content,encode(digest(v_privacy_content,'sha256'),'hex'),v_effective_at,true)
  on conflict(version) do update set
    title=excluded.title,
    content=excluded.content,
    content_hash=excluded.content_hash,
    effective_at=excluded.effective_at,
    is_active=true;
end;
$$;

-- Human accounts must accept V5 once. Service accounts remain exempt.
update public.profiles p
set terms_acceptance_required = not exists(
      select 1
      from public.terms_acceptances a
      where a.user_id=p.id
        and public.semantic_version_major(coalesce(a.app_version_snapshot,a.terms_version))=5
        and public.semantic_version_major(a.terms_version)=5
    ),
    updated_at=now()
where p.active=true
  and p.account_type='HUMAN'
  and not p.is_service_account
  and p.deleted_at is null;

notify pgrst,'reload schema';
commit;

select
  (select version from public.terms_versions where is_active limit 1) active_terms_version,
  (select version from public.privacy_notice_versions where is_active limit 1) active_privacy_version,
  count(*) filter(where terms_acceptance_required) users_requiring_v5_consent,
  'SAN WMS V5 legal documents activated' result
from public.profiles
where active=true and account_type='HUMAN' and not is_service_account and deleted_at is null;
