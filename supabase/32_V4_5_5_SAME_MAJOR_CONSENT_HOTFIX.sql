-- SAN WMS V4.5.5
-- 긴급 수정: 앱과 활성 법적 문서의 patch/minor 버전이 달라도
-- 메이저 버전(첫 번째 숫자)이 같으면 동의를 허용한다.
--
-- 허용 예시: 4.5.5 앱 + 4.5.3 문서
-- 차단 예시: 5.0.0 앱 + 4.9.1 문서
--
-- 기존 동의 기록과 원문 스냅샷은 변경하지 않는다.
-- 현재 활성 원문은 V4.5.5 문서 행으로 복제하며 기존 V4 사용자에게 재동의를 강제하지 않는다.

begin;

create extension if not exists pgcrypto;

alter table public.terms_acceptances
  add column if not exists app_version_snapshot text;

alter table public.profiles
  add column if not exists latest_app_version text;

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

-- 현재 활성 원문을 V4.5.5 문서로 복제한다.
-- 내용은 그대로 유지하고 본문 내 버전 표기와 해시만 새 문서에 맞게 갱신한다.
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
    '버전: [4.5.5]'
  );

  if v_terms_content = v_terms.content then
    v_terms_content := '버전: [4.5.5]' || E'\n\n' || v_terms.content;
  end if;

  v_privacy_content := regexp_replace(
    v_privacy.content,
    '버전\s*:\s*\[[^]]+\]',
    '버전: [4.5.5]'
  );

  if v_privacy_content = v_privacy.content then
    v_privacy_content := '버전: [4.5.5]' || E'\n\n' || v_privacy.content;
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
  ) values (
    '4.5.5',
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
  ) values (
    '4.5.5',
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

-- 앱 버전과 활성 문서의 메이저 버전이 같을 때 동의를 저장한다.
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
  v_existing_hash text;
  v_terms_version text;
  v_privacy_version text;
  v_app_major integer;
  v_terms_major integer;
  v_privacy_major integer;
begin
  v_app_version := nullif(btrim(coalesce(p_app_version, '')), '');

  if v_app_version is null
     or v_app_version !~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$' then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'APP_VERSION_REQUIRED',
      'message', '현재 SAN WMS 앱 버전을 확인할 수 없습니다.'
    );
  end if;

  select version into v_terms_version
  from public.terms_versions
  where is_active
  limit 1;

  select version into v_privacy_version
  from public.privacy_notice_versions
  where is_active
  limit 1;

  v_app_major := public.semantic_version_major(v_app_version);
  v_terms_major := public.semantic_version_major(v_terms_version);
  v_privacy_major := public.semantic_version_major(v_privacy_version);

  if v_app_major is null
     or v_terms_major is null
     or v_privacy_major is null
     or v_terms_major is distinct from v_app_major
     or v_privacy_major is distinct from v_app_major then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'LEGAL_MAJOR_VERSION_MISMATCH',
      'message', format(
        '앱 메이저 버전(%s)과 활성 문서 메이저 버전(이용조건 %s / 개인정보 %s)이 일치하지 않습니다. 관리자에게 문의하세요.',
        coalesce(v_app_major::text, '확인 불가'),
        coalesce(v_terms_major::text, '확인 불가'),
        coalesce(v_privacy_major::text, '확인 불가')
      )
    );
  end if;

  select c.pin_hash into v_existing_hash
  from private.user_pin_credentials c
  where c.user_id = auth.uid();

  if v_existing_hash ~ '^\$2[by]\$'
     and private.verify_user_pin_hash(p_final_pin, v_existing_hash) then
    update private.user_pin_credentials
    set pin_hash = crypt(btrim(p_final_pin), gen_salt('bf', 12)),
        failed_attempts = 0,
        locked_until = null,
        updated_at = clock_timestamp()
    where user_id = auth.uid();
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

    v_result := v_result || jsonb_build_object(
      'app_version', v_app_version,
      'terms_version', v_terms_version,
      'privacy_notice_version', v_privacy_version
    );
  end if;

  return v_result;
end;
$$;

-- 같은 V4 동의 기록이 있는 사용자는 patch/minor 문서 승격으로 재동의를 요구하지 않는다.
update public.profiles p
set terms_acceptance_required = false,
    updated_at = now()
where p.active = true
  and p.account_type = 'HUMAN'
  and not p.is_service_account
  and p.deleted_at is null
  and exists (
    select 1
    from public.terms_acceptances a
    where a.user_id = p.id
      and public.semantic_version_major(
        coalesce(a.app_version_snapshot, a.terms_version)
      ) = 4
  );

revoke all on function public.semantic_version_major(text) from public, anon;
revoke all on function public.complete_user_identity_and_consent_v2(
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  text
) from public, anon;

grant execute on function public.semantic_version_major(text) to authenticated;
grant execute on function public.complete_user_identity_and_consent_v2(
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  text
) to authenticated;

notify pgrst, 'reload schema';

commit;

select
  (select version from public.terms_versions where is_active limit 1) as active_terms_version,
  (select version from public.privacy_notice_versions where is_active limit 1) as active_privacy_version,
  public.semantic_version_major('4.5.5') as app_major,
  public.semantic_version_major(
    (select version from public.terms_versions where is_active limit 1)
  ) as terms_major,
  'SAN WMS V4.5.5 same-major consent hotfix completed' as result;
