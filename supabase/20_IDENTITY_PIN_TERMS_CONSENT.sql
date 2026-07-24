-- SAN WMS V4.0.0
-- 최초 본인확인 · 개인 PIN · 이용조건/개인정보 안내 동의
-- 기존 Auth 비밀번호와 역할은 변경하지 않는다.

begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.profiles
  add column if not exists assigned_name text,
  add column if not exists legal_name text,
  add column if not exists account_type text not null default 'HUMAN',
  add column if not exists is_service_account boolean not null default false,
  add column if not exists pin_set_at timestamptz,
  add column if not exists pin_reset_required boolean not null default true,
  add column if not exists terms_acceptance_required boolean not null default true,
  add column if not exists latest_terms_version text,
  add column if not exists latest_terms_accepted_at timestamptz;

alter table public.profiles drop constraint if exists profiles_account_type_check;
alter table public.profiles add constraint profiles_account_type_check
  check (account_type in ('HUMAN','SERVICE','API','AUTOMATION','SYSTEM'));

create table if not exists private.user_pin_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  pin_set_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.terms_versions (
  version text primary key,
  title text not null,
  content text not null,
  content_hash text not null,
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  is_active boolean not null default false
);

create unique index if not exists one_active_terms_version
  on public.terms_versions ((is_active)) where is_active;

create table if not exists public.privacy_notice_versions (
  version text primary key,
  title text not null,
  content text not null,
  content_hash text not null,
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  is_active boolean not null default false
);

create unique index if not exists one_active_privacy_notice
  on public.privacy_notice_versions ((is_active)) where is_active;

create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  confirmation_no text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  login_id_snapshot text not null,
  assigned_name_snapshot text not null,
  entered_name_snapshot text not null,
  terms_version text not null,
  terms_hash text not null,
  terms_title text not null,
  terms_content_snapshot text not null,
  privacy_notice_version text not null,
  privacy_notice_hash text not null,
  privacy_notice_title text not null,
  privacy_notice_content_snapshot text not null,
  accepted_at timestamptz not null default now(),
  authentication_method text not null default 'PASSWORD_NAME_AND_PERSONAL_PIN',
  consent_text_snapshot text not null,
  correction_of uuid references public.terms_acceptances(id),
  created_at timestamptz not null default now(),
  constraint terms_acceptances_auth_method_check
    check (authentication_method = 'PASSWORD_NAME_AND_PERSONAL_PIN')
);

create index if not exists idx_terms_acceptances_user_time
  on public.terms_acceptances (user_id, accepted_at desc);

create table if not exists public.profile_name_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  previous_assigned_name text,
  new_assigned_name text not null,
  changed_by uuid references auth.users(id),
  reason text,
  changed_at timestamptz not null default now()
);

-- 이용조건 원문: 기존 버전을 덮어쓰지 않고 신규 버전 행으로 보존한다.
update public.terms_versions set is_active = false where is_active;
insert into public.terms_versions(version,title,content,content_hash,effective_at,is_active)
values (
  '3.9.0',
  'SAN WMS 프로그램 이용조건 및 권리 안내',
$terms$# SAN WMS 프로그램 이용조건 및 권리 안내

시행일: [2026년 07월 24일]
버전: [3.9.0]
개발자: [성 산]
업무 데이터 관리주체: [(주)사운드웨이브]

## 제1조 목적

본 이용조건은 SAN WMS의 이용에 필요한 사항, 프로그램에 관한 권리, 업무 데이터의 관리 및 사용자 준수사항을 안내하는 것을 목적으로 합니다.

## 제2조 프로그램에 관한 권리 안내

SAN WMS의 소스코드, 프로그램 구조, 데이터 처리 로직, 화면 구성, 설계 문서 및 개발자가 직접 창작한 프로그램 저작물에 관한 권리는 별도의 서면 양도계약이 없는 한 개발자 [성 산]에게 귀속됨을 고지합니다.

다만 일반적인 업무 아이디어, 법령상 보호되지 않는 추상적 아이디어·절차·해법 및 제3자 오픈소스나 외부 서비스에 관한 권리는 각 권리자와 관계 법령 또는 해당 라이선스에 따릅니다.

본 안내에 대한 일반 사용자의 동의는 프로그램의 권리관계를 결정하거나 회사를 대리하여 권리를 처분하는 행위가 아니라, 위 권리 안내와 이용조건을 고지받고 확인하였다는 사실을 의미합니다.

## 제3조 회사의 이용 범위

[(주)사운드웨이브]와 그 소속 사용자는 SAN WMS를 회사의 입고, 출고, 재고, 로케이션 및 관련 물류업무를 처리하기 위한 내부 업무 목적으로 이용할 수 있습니다.

별도의 서면 허락 없이 다음 행위를 할 수 없습니다.

1. 소스코드 또는 프로그램의 무단 복제
2. 프로그램 또는 계정의 제3자 제공
3. 프로그램의 판매, 재배포 또는 외부 서비스 제공
4. 기술적 보호조치의 우회 또는 무력화
5. 소스코드, 데이터베이스 구조 또는 비공개 기술정보의 무단 추출
6. 승인받지 않은 방식으로 프로그램을 수정하거나 파생 프로그램을 제작하는 행위

## 제4조 업무 데이터

SAN WMS에 입력·생성·저장되는 입고, 출고, 재고, 상품, 로케이션, 작업내역 및 기타 회사 업무 데이터의 관리·이용 권한은 [(주)사운드웨이브]에 있습니다.

개발자는 회사 업무 데이터를 개인적인 목적으로 이용하거나 회사의 승인 없이 제3자에게 제공하지 않습니다.

프로그램 자체에 관한 권리와 프로그램을 이용하여 생성·관리되는 회사 업무 데이터에 관한 권리는 서로 구분됩니다.

## 제5조 계정 관리

1. 각 계정은 지정된 사용자 한 명에게만 부여됩니다.
2. 사용자는 자신의 계정과 개인 PIN을 다른 사람에게 알려주거나 공동으로 사용해서는 안 됩니다.
3. 다른 사용자의 계정을 이용하거나 본인의 계정을 다른 사람이 이용하도록 해서는 안 됩니다.
4. 계정 또는 PIN의 유출이 의심되는 경우 즉시 관리자에게 알려야 합니다.
5. 사용자 본인이 아닌 사람이 계정을 이용하여 발생한 작업은 사실관계 확인 및 권한에 따라 처리됩니다.

## 제6조 본인확인과 동의 기록

사용자는 최초 이용 또는 이용조건 변경 시 다음 절차를 완료해야 합니다.

1. 본인에게 개별 배정된 계정으로 로그인
2. 본인의 이름 직접 입력
3. 개인 PIN 설정 또는 확인
4. 본 이용조건 전문 확인
5. 필수 동의 항목 선택
6. 최종 동의 확인

동의가 완료되면 사용자 계정, 계정에 배정된 이름, 사용자가 입력한 이름, 이용조건 버전, 이용조건 원문 확인값, 동의 일시 및 인증 방식이 기록될 수 있습니다.

해당 기록은 이용조건의 고지와 동의 사실, 계정 이용 사실 및 관련 분쟁의 사실관계를 확인하기 위한 증빙자료로 제출되거나 사용될 수 있습니다.

## 제7조 시스템 이용기록

SAN WMS에서 수행된 입고, 출고, 재고수정, 로케이션 이동, 승인 및 기타 업무처리는 해당 계정의 작업이력으로 기록될 수 있습니다.

사용자는 본인에게 부여된 계정을 사용하고, 작업내용이 정확하게 입력되도록 주의해야 합니다.

## 제8조 이용 제한

다음 사유가 있는 경우 시스템 이용이 제한될 수 있습니다.

1. 본 이용조건에 동의하지 않은 경우
2. 본인확인 또는 개인 PIN 설정을 완료하지 않은 경우
3. 다른 사용자의 계정을 이용한 경우
4. 프로그램 또는 업무 데이터를 무단으로 복제·변경·삭제한 경우
5. 보안 또는 시스템 운영에 중대한 위험을 발생시킨 경우
6. 회사의 계정 이용권한이 종료된 경우

## 제9조 이용조건의 변경

본 이용조건이 변경되는 경우 변경된 내용과 시행일을 시스템을 통해 고지합니다.

프로그램 권리, 데이터 처리, 사용자 의무 등 중요한 내용이 변경되는 경우 사용자에게 다시 확인과 동의를 요구할 수 있습니다.

기존 이용조건과 동의 기록은 해당 버전별로 보관될 수 있습니다.

## 제10조 확인 및 동의

본인은 본인에게 개별 배정된 계정으로 로그인하였으며, 본 이용조건의 내용을 직접 확인하였습니다.

본인은 SAN WMS 프로그램 이용조건, 프로그램에 관한 권리 안내, 회사 업무 데이터의 관리구조 및 계정 사용의무를 이해하고 이에 동의합니다.

본인은 본인의 이름과 개인 PIN을 이용하여 동의하였으며, 해당 전자적 동의 기록이 이용조건의 고지 및 동의 사실을 확인하는 자료로 보관될 수 있음을 확인합니다.
$terms$,
  encode(digest($terms$# SAN WMS 프로그램 이용조건 및 권리 안내

시행일: [2026년 07월 24일]
버전: [3.9.0]
개발자: [성 산]
업무 데이터 관리주체: [(주)사운드웨이브]

## 제1조 목적

본 이용조건은 SAN WMS의 이용에 필요한 사항, 프로그램에 관한 권리, 업무 데이터의 관리 및 사용자 준수사항을 안내하는 것을 목적으로 합니다.

## 제2조 프로그램에 관한 권리 안내

SAN WMS의 소스코드, 프로그램 구조, 데이터 처리 로직, 화면 구성, 설계 문서 및 개발자가 직접 창작한 프로그램 저작물에 관한 권리는 별도의 서면 양도계약이 없는 한 개발자 [성 산]에게 귀속됨을 고지합니다.

다만 일반적인 업무 아이디어, 법령상 보호되지 않는 추상적 아이디어·절차·해법 및 제3자 오픈소스나 외부 서비스에 관한 권리는 각 권리자와 관계 법령 또는 해당 라이선스에 따릅니다.

본 안내에 대한 일반 사용자의 동의는 프로그램의 권리관계를 결정하거나 회사를 대리하여 권리를 처분하는 행위가 아니라, 위 권리 안내와 이용조건을 고지받고 확인하였다는 사실을 의미합니다.

## 제3조 회사의 이용 범위

[(주)사운드웨이브]와 그 소속 사용자는 SAN WMS를 회사의 입고, 출고, 재고, 로케이션 및 관련 물류업무를 처리하기 위한 내부 업무 목적으로 이용할 수 있습니다.

별도의 서면 허락 없이 다음 행위를 할 수 없습니다.

1. 소스코드 또는 프로그램의 무단 복제
2. 프로그램 또는 계정의 제3자 제공
3. 프로그램의 판매, 재배포 또는 외부 서비스 제공
4. 기술적 보호조치의 우회 또는 무력화
5. 소스코드, 데이터베이스 구조 또는 비공개 기술정보의 무단 추출
6. 승인받지 않은 방식으로 프로그램을 수정하거나 파생 프로그램을 제작하는 행위

## 제4조 업무 데이터

SAN WMS에 입력·생성·저장되는 입고, 출고, 재고, 상품, 로케이션, 작업내역 및 기타 회사 업무 데이터의 관리·이용 권한은 [(주)사운드웨이브]에 있습니다.

개발자는 회사 업무 데이터를 개인적인 목적으로 이용하거나 회사의 승인 없이 제3자에게 제공하지 않습니다.

프로그램 자체에 관한 권리와 프로그램을 이용하여 생성·관리되는 회사 업무 데이터에 관한 권리는 서로 구분됩니다.

## 제5조 계정 관리

1. 각 계정은 지정된 사용자 한 명에게만 부여됩니다.
2. 사용자는 자신의 계정과 개인 PIN을 다른 사람에게 알려주거나 공동으로 사용해서는 안 됩니다.
3. 다른 사용자의 계정을 이용하거나 본인의 계정을 다른 사람이 이용하도록 해서는 안 됩니다.
4. 계정 또는 PIN의 유출이 의심되는 경우 즉시 관리자에게 알려야 합니다.
5. 사용자 본인이 아닌 사람이 계정을 이용하여 발생한 작업은 사실관계 확인 및 권한에 따라 처리됩니다.

## 제6조 본인확인과 동의 기록

사용자는 최초 이용 또는 이용조건 변경 시 다음 절차를 완료해야 합니다.

1. 본인에게 개별 배정된 계정으로 로그인
2. 본인의 이름 직접 입력
3. 개인 PIN 설정 또는 확인
4. 본 이용조건 전문 확인
5. 필수 동의 항목 선택
6. 최종 동의 확인

동의가 완료되면 사용자 계정, 계정에 배정된 이름, 사용자가 입력한 이름, 이용조건 버전, 이용조건 원문 확인값, 동의 일시 및 인증 방식이 기록될 수 있습니다.

해당 기록은 이용조건의 고지와 동의 사실, 계정 이용 사실 및 관련 분쟁의 사실관계를 확인하기 위한 증빙자료로 제출되거나 사용될 수 있습니다.

## 제7조 시스템 이용기록

SAN WMS에서 수행된 입고, 출고, 재고수정, 로케이션 이동, 승인 및 기타 업무처리는 해당 계정의 작업이력으로 기록될 수 있습니다.

사용자는 본인에게 부여된 계정을 사용하고, 작업내용이 정확하게 입력되도록 주의해야 합니다.

## 제8조 이용 제한

다음 사유가 있는 경우 시스템 이용이 제한될 수 있습니다.

1. 본 이용조건에 동의하지 않은 경우
2. 본인확인 또는 개인 PIN 설정을 완료하지 않은 경우
3. 다른 사용자의 계정을 이용한 경우
4. 프로그램 또는 업무 데이터를 무단으로 복제·변경·삭제한 경우
5. 보안 또는 시스템 운영에 중대한 위험을 발생시킨 경우
6. 회사의 계정 이용권한이 종료된 경우

## 제9조 이용조건의 변경

본 이용조건이 변경되는 경우 변경된 내용과 시행일을 시스템을 통해 고지합니다.

프로그램 권리, 데이터 처리, 사용자 의무 등 중요한 내용이 변경되는 경우 사용자에게 다시 확인과 동의를 요구할 수 있습니다.

기존 이용조건과 동의 기록은 해당 버전별로 보관될 수 있습니다.

## 제10조 확인 및 동의

본인은 본인에게 개별 배정된 계정으로 로그인하였으며, 본 이용조건의 내용을 직접 확인하였습니다.

본인은 SAN WMS 프로그램 이용조건, 프로그램에 관한 권리 안내, 회사 업무 데이터의 관리구조 및 계정 사용의무를 이해하고 이에 동의합니다.

본인은 본인의 이름과 개인 PIN을 이용하여 동의하였으며, 해당 전자적 동의 기록이 이용조건의 고지 및 동의 사실을 확인하는 자료로 보관될 수 있음을 확인합니다.
$terms$,'sha256'),'hex'),
  '2026-07-24 00:00:00+09',
  true
)
on conflict (version) do update set is_active = excluded.is_active;

update public.privacy_notice_versions set is_active = false where is_active;
insert into public.privacy_notice_versions(version,title,content,content_hash,effective_at,is_active)
values (
  '3.9.0',
  '본인확인 및 동의 기록의 수집·이용 안내',
$privacy$# 본인확인 및 동의 기록의 수집·이용 안내

SAN WMS는 사용자 본인확인과 이용조건 동의 사실을 기록하기 위하여 다음 개인정보를 수집·이용합니다.

## 수집·이용 목적

* 사용자 본인확인
* 1인 1계정 관리
* SAN WMS 이용조건의 고지 및 동의 사실 확인
* 계정의 부정사용 방지
* 시스템 보안관리
* 관련 문의, 감사 또는 분쟁 발생 시 사실관계 확인

## 수집·이용 항목

* 사용자 계정 ID
* 계정에 배정된 사용자 이름
* 사용자가 직접 입력한 이름
* 개인 PIN의 일방향 암호화값
* 이용조건 제목 및 버전
* 이용조건 원문 확인값
* 동의 여부
* 동의 일시
* 동의 확인번호
* 본인확인 방식

개인 PIN의 원문은 저장하지 않습니다.

## 보유 및 이용 기간

사용자의 SAN WMS 이용기간 동안 보유하며, 이용 종료 후에는 관련 계약, 감사 또는 법적 분쟁에 대응하기 위하여 필요한 기간 동안 보관한 후 안전하게 파기합니다.

구체적인 보유기간은 [5년 또는 회사 정책]에 따릅니다.

## 동의 거부권과 불이익

사용자는 개인정보 수집·이용에 동의하지 않을 권리가 있습니다.

다만 위 정보는 사용자 본인확인, 계정 보안 및 이용조건 동의 확인에 필요한 최소 정보이므로, 동의하지 않는 경우 SAN WMS 이용이 제한될 수 있습니다.

□ [필수] 본인확인 및 동의 기록의 수집·이용에 동의합니다.
$privacy$,
  encode(digest($privacy$# 본인확인 및 동의 기록의 수집·이용 안내

SAN WMS는 사용자 본인확인과 이용조건 동의 사실을 기록하기 위하여 다음 개인정보를 수집·이용합니다.

## 수집·이용 목적

* 사용자 본인확인
* 1인 1계정 관리
* SAN WMS 이용조건의 고지 및 동의 사실 확인
* 계정의 부정사용 방지
* 시스템 보안관리
* 관련 문의, 감사 또는 분쟁 발생 시 사실관계 확인

## 수집·이용 항목

* 사용자 계정 ID
* 계정에 배정된 사용자 이름
* 사용자가 직접 입력한 이름
* 개인 PIN의 일방향 암호화값
* 이용조건 제목 및 버전
* 이용조건 원문 확인값
* 동의 여부
* 동의 일시
* 동의 확인번호
* 본인확인 방식

개인 PIN의 원문은 저장하지 않습니다.

## 보유 및 이용 기간

사용자의 SAN WMS 이용기간 동안 보유하며, 이용 종료 후에는 관련 계약, 감사 또는 법적 분쟁에 대응하기 위하여 필요한 기간 동안 보관한 후 안전하게 파기합니다.

구체적인 보유기간은 [5년 또는 회사 정책]에 따릅니다.

## 동의 거부권과 불이익

사용자는 개인정보 수집·이용에 동의하지 않을 권리가 있습니다.

다만 위 정보는 사용자 본인확인, 계정 보안 및 이용조건 동의 확인에 필요한 최소 정보이므로, 동의하지 않는 경우 SAN WMS 이용이 제한될 수 있습니다.

□ [필수] 본인확인 및 동의 기록의 수집·이용에 동의합니다.
$privacy$,'sha256'),'hex'),
  '2026-07-24 00:00:00+09',
  true
)
on conflict (version) do update set is_active = excluded.is_active;

create or replace function public.user_label(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(p.legal_name),''),nullif(trim(p.assigned_name),''),nullif(trim(p.display_name),''),p.email,'사용자')
  from public.profiles p where p.id = p_user_id;
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
    left join private.user_pin_credentials c on c.user_id = p.id
    where p.id = p_user_id
  ), false);
$$;

create or replace function public.require_user_ready()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.user_access_ready(auth.uid()) then
    raise exception '본인 확인, 개인 PIN 설정 및 최신 이용조건 동의가 필요합니다.';
  end if;
end;
$$;

-- 기존 모든 업무 RPC가 사용하는 역할 검사에 준비상태 검사를 추가한다.
create or replace function public.require_role(p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_user_ready();
  if not (public.current_role() = any(p_roles)) then
    raise exception '권한이 없습니다.';
  end if;
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
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then raise exception '사용자 프로필을 찾을 수 없습니다.'; end if;
  select * into v_terms from public.terms_versions where is_active limit 1;
  select * into v_privacy from public.privacy_notice_versions where is_active limit 1;
  select * into v_pin from private.user_pin_credentials where user_id = auth.uid();

  return jsonb_build_object(
    'user_id',v_profile.id,
    'login_id',v_profile.email,
    'assigned_name',coalesce(v_profile.assigned_name,v_profile.display_name,v_profile.email),
    'legal_name',v_profile.legal_name,
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

create or replace function public.complete_user_identity_and_consent(
  p_entered_name text,
  p_new_pin text,
  p_pin_confirm text,
  p_final_pin text,
  p_terms_checked boolean,
  p_privacy_checked boolean
)
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
  v_now timestamptz := clock_timestamp();
  v_confirmation text;
  v_attempts integer;
  v_need_new_pin boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error_code','NOT_AUTHENTICATED','message','로그인이 필요합니다.'); end if;
  select * into v_profile from public.profiles where id = auth.uid() for update;
  if not found or not v_profile.active then return jsonb_build_object('ok',false,'error_code','ACCOUNT_INACTIVE','message','사용할 수 없는 계정입니다.'); end if;
  if v_profile.is_service_account or v_profile.account_type <> 'HUMAN' then
    update public.profiles set pin_reset_required=false,terms_acceptance_required=false,updated_at=v_now where id=auth.uid();
    return jsonb_build_object('ok',true,'access_ready',true,'service_account',true);
  end if;

  if nullif(btrim(v_profile.assigned_name),'') is null then
    return jsonb_build_object('ok',false,'error_code','ASSIGNED_NAME_REQUIRED','message','관리자가 계정의 배정 사용자 이름을 먼저 등록해야 합니다.');
  end if;
  if btrim(coalesce(p_entered_name,'')) <> btrim(v_profile.assigned_name) then
    return jsonb_build_object('ok',false,'error_code','NAME_MISMATCH','message','입력한 이름이 계정에 배정된 이름과 일치하지 않습니다.');
  end if;
  if not coalesce(p_terms_checked,false) or not coalesce(p_privacy_checked,false) then
    return jsonb_build_object('ok',false,'error_code','CONSENT_REQUIRED','message','두 필수 동의 항목을 모두 선택해야 합니다.');
  end if;

  select * into v_terms from public.terms_versions where is_active limit 1;
  select * into v_privacy from public.privacy_notice_versions where is_active limit 1;
  if v_terms.version is null or v_privacy.version is null then
    return jsonb_build_object('ok',false,'error_code','ACTIVE_DOCUMENT_MISSING','message','활성 이용조건 또는 개인정보 안내가 없습니다.');
  end if;

  select * into v_pin from private.user_pin_credentials where user_id=auth.uid() for update;
  v_need_new_pin := v_pin.user_id is null or v_profile.pin_reset_required or v_profile.pin_set_at is null;

  if v_need_new_pin then
    if coalesce(p_new_pin,'') !~ '^[0-9]{6}$' then
      return jsonb_build_object('ok',false,'error_code','PIN_FORMAT','message','개인 PIN은 숫자 6자리로 설정해야 합니다.');
    end if;
    if p_new_pin is distinct from p_pin_confirm or p_new_pin is distinct from p_final_pin then
      return jsonb_build_object('ok',false,'error_code','PIN_MISMATCH','message','PIN 입력, 확인 입력 및 최종 PIN이 일치하지 않습니다.');
    end if;
    insert into private.user_pin_credentials(user_id,pin_hash,failed_attempts,locked_until,pin_set_at,updated_at)
    values(auth.uid(),crypt(p_new_pin,gen_salt('bf',12)),0,null,v_now,v_now)
    on conflict(user_id) do update set pin_hash=excluded.pin_hash,failed_attempts=0,locked_until=null,pin_set_at=v_now,updated_at=v_now;
  else
    if v_pin.locked_until is not null and v_pin.locked_until > v_now then
      return jsonb_build_object('ok',false,'error_code','PIN_LOCKED','message','PIN 입력 실패로 잠금 상태입니다. 잠시 후 다시 시도하세요.','locked_until',v_pin.locked_until);
    end if;
    if coalesce(p_final_pin,'') !~ '^[0-9]{6}$' or crypt(p_final_pin,v_pin.pin_hash) <> v_pin.pin_hash then
      v_attempts := v_pin.failed_attempts + 1;
      update private.user_pin_credentials
      set failed_attempts=v_attempts,
          locked_until=case when v_attempts >= 5 then v_now + interval '15 minutes' else null end,
          updated_at=v_now
      where user_id=auth.uid();
      return jsonb_build_object('ok',false,'error_code',case when v_attempts >= 5 then 'PIN_LOCKED' else 'INVALID_PIN' end,'message',case when v_attempts >= 5 then 'PIN을 5회 잘못 입력하여 15분간 잠겼습니다.' else '개인 PIN이 일치하지 않습니다.' end,'remaining_attempts',greatest(0,5-v_attempts));
    end if;
    update private.user_pin_credentials set failed_attempts=0,locked_until=null,updated_at=v_now where user_id=auth.uid();
  end if;

  v_confirmation := 'SAN-'||to_char(v_now at time zone 'Asia/Seoul','YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.terms_acceptances(
    confirmation_no,user_id,login_id_snapshot,assigned_name_snapshot,entered_name_snapshot,
    terms_version,terms_hash,terms_title,terms_content_snapshot,
    privacy_notice_version,privacy_notice_hash,privacy_notice_title,privacy_notice_content_snapshot,
    accepted_at,authentication_method,consent_text_snapshot
  ) values (
    v_confirmation,auth.uid(),coalesce(v_profile.email,''),v_profile.assigned_name,btrim(p_entered_name),
    v_terms.version,v_terms.content_hash,v_terms.title,v_terms.content,
    v_privacy.version,v_privacy.content_hash,v_privacy.title,v_privacy.content,
    v_now,'PASSWORD_NAME_AND_PERSONAL_PIN',
    '[필수] SAN WMS 프로그램 이용조건 및 권리 안내를 확인하였으며 이에 동의합니다.\n[필수] 본인확인 및 동의 기록 처리 안내를 확인하였으며 이에 동의합니다.\n본인은 본인에게 개별 배정된 계정으로 로그인하였으며, 아래 이용조건을 직접 확인하고 동의합니다.'
  );

  update public.profiles
  set legal_name=btrim(p_entered_name),
      display_name=btrim(p_entered_name),
      pin_set_at=v_now,
      pin_reset_required=false,
      terms_acceptance_required=false,
      latest_terms_version=v_terms.version,
      latest_terms_accepted_at=v_now,
      updated_at=v_now
  where id=auth.uid();

  perform public.write_audit('IDENTITY_TERMS_ACCEPTED','user',auth.uid()::text,btrim(p_entered_name),null,jsonb_build_object('terms_version',v_terms.version,'confirmation_no',v_confirmation),'본인확인·PIN·이용조건 동의 완료');

  return jsonb_build_object('ok',true,'access_ready',true,'confirmation_no',v_confirmation,'accepted_at',v_now,'terms_version',v_terms.version);
end;
$$;

create or replace function public.get_my_terms_acceptances()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'confirmation_no',a.confirmation_no,'terms_version',a.terms_version,'terms_hash',a.terms_hash,
    'terms_title',a.terms_title,'terms_content',a.terms_content_snapshot,
    'privacy_notice_version',a.privacy_notice_version,'privacy_notice_hash',a.privacy_notice_hash,
    'privacy_notice_title',a.privacy_notice_title,'privacy_notice_content',a.privacy_notice_content_snapshot,
    'accepted_at',a.accepted_at,'authentication_method',a.authentication_method
  ) order by a.accepted_at desc),'[]'::jsonb)
  from public.terms_acceptances a where a.user_id=auth.uid();
$$;

create or replace function public.admin_list_user_security_status()
returns table(
  id uuid,email text,display_name text,assigned_name text,legal_name text,role text,active boolean,
  account_type text,is_service_account boolean,pin_configured boolean,pin_set_at timestamptz,pin_reset_required boolean,
  latest_terms_accepted boolean,latest_terms_version text,latest_terms_accepted_at timestamptz,terms_acceptance_required boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
declare v_active_version text;
begin
  perform public.require_role(array['admin']);
  select version into v_active_version from public.terms_versions where is_active limit 1;
  return query select p.id,p.email,p.display_name,p.assigned_name,p.legal_name,p.role,p.active,p.account_type,p.is_service_account,
    (c.user_id is not null and p.pin_set_at is not null and not p.pin_reset_required),p.pin_set_at,p.pin_reset_required,
    (not p.terms_acceptance_required and p.latest_terms_version=v_active_version),p.latest_terms_version,p.latest_terms_accepted_at,p.terms_acceptance_required
  from public.profiles p left join private.user_pin_credentials c on c.user_id=p.id order by coalesce(p.legal_name,p.assigned_name,p.display_name,p.email);
end;
$$;

create or replace function public.admin_update_assigned_name(p_user_id uuid,p_assigned_name text,p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_before text; v_after text;
begin
  perform public.require_role(array['admin']);
  v_after:=btrim(coalesce(p_assigned_name,''));
  if v_after='' then raise exception '배정 사용자 이름은 비워둘 수 없습니다.'; end if;
  select assigned_name into v_before from public.profiles where id=p_user_id for update;
  if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;
  if v_before is distinct from v_after then
    insert into public.profile_name_history(user_id,previous_assigned_name,new_assigned_name,changed_by,reason)
    values(p_user_id,v_before,v_after,auth.uid(),nullif(btrim(p_reason),''));
    update public.profiles set assigned_name=v_after,display_name=v_after,legal_name=null,terms_acceptance_required=true,updated_at=now() where id=p_user_id;
    perform public.write_audit('USER_ASSIGNED_NAME_CHANGED','user',p_user_id::text,v_after,jsonb_build_object('assigned_name',v_before),jsonb_build_object('assigned_name',v_after),p_reason);
  end if;
end;
$$;

create or replace function public.admin_reset_user_pin(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_role(array['admin']);
  update public.profiles set pin_reset_required=true,pin_set_at=null,updated_at=now() where id=p_user_id;
  if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;
  perform public.write_audit('USER_PIN_RESET_REQUIRED','user',p_user_id::text,public.user_label(p_user_id),null,jsonb_build_object('pin_reset_required',true),'관리자 PIN 초기화 요구');
end; $$;

create or replace function public.admin_require_user_reconsent(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_role(array['admin']);
  update public.profiles set terms_acceptance_required=true,updated_at=now() where id=p_user_id;
  if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;
  perform public.write_audit('USER_RECONSENT_REQUIRED','user',p_user_id::text,public.user_label(p_user_id),null,jsonb_build_object('terms_acceptance_required',true),'관리자 재동의 요구');
end; $$;

create or replace function public.admin_require_all_reconsent()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  perform public.require_role(array['admin']);
  update public.profiles set terms_acceptance_required=true,updated_at=now()
  where active and account_type='HUMAN' and not is_service_account;
  get diagnostics v_count = row_count;
  perform public.write_audit('ALL_USERS_RECONSENT_REQUIRED','user_group','ALL','전체 사용자',null,jsonb_build_object('affected',v_count),'관리자 전체 재동의 요구');
  return v_count;
end; $$;

create or replace function public.admin_set_account_type(p_user_id uuid,p_account_type text,p_is_service_account boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.require_role(array['admin']);
  if p_account_type not in ('HUMAN','SERVICE','API','AUTOMATION','SYSTEM') then raise exception '계정 유형 오류'; end if;
  update public.profiles set account_type=p_account_type,is_service_account=coalesce(p_is_service_account,false),
    pin_reset_required=case when p_account_type='HUMAN' and not coalesce(p_is_service_account,false) then pin_reset_required else false end,
    terms_acceptance_required=case when p_account_type='HUMAN' and not coalesce(p_is_service_account,false) then terms_acceptance_required else false end,
    updated_at=now() where id=p_user_id;
  if not found then raise exception '사용자를 찾을 수 없습니다.'; end if;
  perform public.write_audit('USER_ACCOUNT_TYPE_CHANGED','user',p_user_id::text,public.user_label(p_user_id),null,jsonb_build_object('account_type',p_account_type,'is_service_account',p_is_service_account));
end; $$;

-- 신규 Auth 사용자는 HUMAN 계정이면 최초 절차가 자동 요구된다.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_role text; v_type text; v_service boolean; v_name text;
begin
  v_role := case when exists(select 1 from public.profiles where role='admin' and active) then 'viewer' else 'admin' end;
  v_service := coalesce((new.raw_user_meta_data->>'is_service_account')::boolean,false);
  v_type := upper(coalesce(nullif(new.raw_user_meta_data->>'account_type',''),case when v_service then 'SERVICE' else 'HUMAN' end));
  if v_type not in ('HUMAN','SERVICE','API','AUTOMATION','SYSTEM') then v_type:='HUMAN'; end if;
  v_name := coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'),''),nullif(btrim(new.raw_user_meta_data->>'full_name'),''),nullif(btrim(new.raw_user_meta_data->>'name'),''),new.email);
  insert into public.profiles(id,email,display_name,assigned_name,role,account_type,is_service_account,pin_reset_required,terms_acceptance_required)
  values(new.id,new.email,v_name,v_name,v_role,v_type,v_service,(v_type='HUMAN' and not v_service),(v_type='HUMAN' and not v_service))
  on conflict(id) do update set email=excluded.email,display_name=coalesce(public.profiles.display_name,excluded.display_name),assigned_name=coalesce(public.profiles.assigned_name,excluded.assigned_name);
  return new;
end; $$;

-- 기존 활성 HUMAN 계정 일괄 적용. 비밀번호와 역할은 건드리지 않는다.
update public.profiles p
set assigned_name=coalesce(nullif(btrim(p.assigned_name),''),nullif(btrim(p.display_name),''),p.email),
    pin_set_at=null,
    pin_reset_required=true,
    terms_acceptance_required=true,
    latest_terms_version=null,
    latest_terms_accepted_at=null,
    updated_at=now()
where p.active and p.account_type='HUMAN' and not p.is_service_account;

-- 실명 우선 표시로 기존 작업자 로그를 보강한다.
create or replace view public.inventory_transaction_view with (security_invoker=true) as
select t.*,concat_ws(' ',p.artist,p.name_ver) product_label,l.location_code,public.user_label(t.actor_id) actor_label,
  upper(concat_ws(' ',p.artist,p.name_ver,l.location_code,t.product_barcode_value,t.location_barcode_value,public.user_label(t.actor_id),t.note)) search_text
from public.inventory_transactions t join public.products p on p.id=t.product_id join public.locations l on l.id=t.location_id;

create or replace view public.scan_event_view with (security_invoker=true) as
select s.*,public.user_label(s.actor_id) actor_label,upper(concat_ws(' ',s.raw_value,s.target_label,s.context,public.user_label(s.actor_id))) search_text from public.scan_events s;

create or replace view public.audit_log_view with (security_invoker=true) as
select a.*,public.user_label(a.actor_id) actor_label,upper(concat_ws(' ',a.action,a.entity_type,a.entity_label,a.note,public.user_label(a.actor_id))) search_text from public.audit_logs a;

alter table public.terms_versions enable row level security;
alter table public.privacy_notice_versions enable row level security;
alter table public.terms_acceptances enable row level security;
alter table public.profile_name_history enable row level security;

drop policy if exists active_terms_read on public.terms_versions;
create policy active_terms_read on public.terms_versions for select to authenticated using (is_active);
drop policy if exists active_privacy_read on public.privacy_notice_versions;
create policy active_privacy_read on public.privacy_notice_versions for select to authenticated using (is_active);
drop policy if exists own_terms_acceptances_read on public.terms_acceptances;
create policy own_terms_acceptances_read on public.terms_acceptances for select to authenticated using (user_id=auth.uid());
drop policy if exists admin_name_history_read on public.profile_name_history;
create policy admin_name_history_read on public.profile_name_history for select to authenticated using (public.user_access_ready() and public.current_role()='admin');

-- profiles: 본인은 최초 절차 중에도 조회 가능, 다른 사용자 목록은 준비 완료 관리자만 가능.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (id=auth.uid() or (public.user_access_ready() and public.current_role()='admin'));

-- 기존 공개 업무 테이블 전부에 RESTRICTIVE 정책을 추가해 미동의 사용자의 직접 API 호출을 차단한다.
do $$
declare r record;
begin
  for r in select schemaname,tablename from pg_tables
    where schemaname='public'
      and tablename not in ('profiles','terms_versions','privacy_notice_versions','terms_acceptances','profile_name_history')
  loop
    execute format('alter table public.%I enable row level security',r.tablename);
    execute format('drop policy if exists user_ready_restrictive on public.%I',r.tablename);
    execute format('create policy user_ready_restrictive on public.%I as restrictive for all to authenticated using (public.user_access_ready()) with check (public.user_access_ready())',r.tablename);
  end loop;
end $$;

revoke insert,update,delete on public.terms_acceptances from public,anon,authenticated;
revoke all on private.user_pin_credentials from public,anon,authenticated;

grant select on public.terms_versions,public.privacy_notice_versions,public.terms_acceptances to authenticated;
grant execute on function public.user_label(uuid) to authenticated;
grant execute on function public.user_access_ready(uuid) to authenticated;
grant execute on function public.get_user_access_status() to authenticated;
grant execute on function public.complete_user_identity_and_consent(text,text,text,text,boolean,boolean) to authenticated;
grant execute on function public.get_my_terms_acceptances() to authenticated;
grant execute on function public.admin_list_user_security_status() to authenticated;
grant execute on function public.admin_update_assigned_name(uuid,text,text) to authenticated;
grant execute on function public.admin_reset_user_pin(uuid) to authenticated;
grant execute on function public.admin_require_user_reconsent(uuid) to authenticated;
grant execute on function public.admin_require_all_reconsent() to authenticated;
grant execute on function public.admin_set_account_type(uuid,text,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;

select 'SAN WMS V4.0.0 identity, PIN and terms consent migration completed' as result;
