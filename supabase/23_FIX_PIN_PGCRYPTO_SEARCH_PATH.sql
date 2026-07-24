-- SAN WMS V4.0.1
-- PIN bcrypt 함수 검색 경로 핫픽스
-- 오류: function gen_salt(unknown, integer) does not exist

begin;

-- Supabase는 pgcrypto 함수를 일반적으로 extensions 스키마에 설치한다.
create extension if not exists pgcrypto with schema extensions;

alter function public.complete_user_identity_and_consent(
  text, text, text, text, boolean, boolean
) set search_path = public, private, extensions;

notify pgrst, 'reload schema';

commit;

select
  p.proname as function_name,
  p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'complete_user_identity_and_consent';
