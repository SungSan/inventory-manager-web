-- SAN WMS V4.7.0
-- 특전 자동계산 독립 모듈
--
-- 핵심 원칙
--   * inventory_balances / inventory_transactions / products / locations / barcodes 를 조회·수정하지 않는다.
--   * 역할(role)과 무관하게 admin이 BENEFIT_AUTOMATION을 계정별 승인한 사용자만 접근한다.
--   * viewer라도 승인되면 사용 가능하고 manager/admin도 미승인이면 접근할 수 없다.
--   * 본인확인/PIN/이용조건 준비 상태까지 DB에서 강제한다.
--   * 주문/당첨자 업로드는 STAGING -> 검증 -> IMPORTED 전환 전까지 기존 정상 버전을 대체하지 않는다.
--   * 원본/계산 이력은 물리 삭제하지 않는다.

begin;

create table if not exists public.user_feature_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  granted_by uuid references auth.users(id),
  granted_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  reason text,
  updated_at timestamptz not null default now(),
  primary key (user_id, feature_key)
);
alter table public.user_feature_grants enable row level security;
revoke all on public.user_feature_grants from public, anon, authenticated;

create or replace function public.has_user_feature_access(p_feature_key text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select auth.uid() is not null
    and public.user_access_ready(auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id=auth.uid()
        and coalesce(p.active,true)=true
        and p.deleted_at is null
    )
    and exists (
      select 1 from public.user_feature_grants g
      where g.user_id=auth.uid()
        and g.feature_key=upper(btrim(coalesce(p_feature_key,'')))
        and g.enabled=true
    );
$$;

create or replace function public.require_user_feature_access(p_feature_key text)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.require_user_ready();
  if not public.has_user_feature_access(p_feature_key) then
    raise exception '관리자가 별도로 승인한 계정만 이 기능을 사용할 수 있습니다.';
  end if;
end;
$$;

create or replace function public.get_my_feature_access(p_feature_key text)
returns boolean
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  perform public.require_user_ready();
  return public.has_user_feature_access(p_feature_key);
end;
$$;

create or replace function public.admin_set_user_feature_grant(
  p_user_id uuid,
  p_feature_key text,
  p_enabled boolean,
  p_reason text default ''
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_key text:=upper(btrim(coalesce(p_feature_key,'')));
  v_before jsonb;
  v_after jsonb;
begin
  perform public.require_role(array['admin']);
  if v_key='' then raise exception '기능 키가 필요합니다.'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and deleted_at is null) then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;

  select to_jsonb(g) into v_before
  from public.user_feature_grants g
  where g.user_id=p_user_id and g.feature_key=v_key;

  insert into public.user_feature_grants(
    user_id,feature_key,enabled,granted_by,granted_at,revoked_by,revoked_at,reason,updated_at
  ) values (
    p_user_id,v_key,p_enabled,
    case when p_enabled then auth.uid() else null end,
    case when p_enabled then now() else null end,
    case when not p_enabled then auth.uid() else null end,
    case when not p_enabled then now() else null end,
    nullif(btrim(coalesce(p_reason,'')),''),now()
  )
  on conflict(user_id,feature_key) do update
  set enabled=excluded.enabled,
      granted_by=case when excluded.enabled then auth.uid() else public.user_feature_grants.granted_by end,
      granted_at=case when excluded.enabled then now() else public.user_feature_grants.granted_at end,
      revoked_by=case when not excluded.enabled then auth.uid() else null end,
      revoked_at=case when not excluded.enabled then now() else null end,
      reason=excluded.reason,
      updated_at=now();

  select to_jsonb(g) into v_after
  from public.user_feature_grants g
  where g.user_id=p_user_id and g.feature_key=v_key;

  perform public.write_audit(
    case when p_enabled then 'USER_FEATURE_GRANTED' else 'USER_FEATURE_REVOKED' end,
    'user_feature_grant',p_user_id::text,v_key,v_before,v_after,
    nullif(btrim(coalesce(p_reason,'')),'')
  );
end;
$$;

create or replace function public.admin_list_user_feature_grants(p_feature_key text default null)
returns table(user_id uuid, feature_key text, enabled boolean, reason text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  perform public.require_role(array['admin']);
  return query
  select p.id,
         coalesce(g.feature_key,upper(btrim(coalesce(p_feature_key,'BENEFIT_AUTOMATION')))),
         coalesce(g.enabled,false),
         g.reason,
         g.updated_at
  from public.profiles p
  left join public.user_feature_grants g
    on g.user_id=p.id
   and g.feature_key=upper(btrim(coalesce(p_feature_key,'BENEFIT_AUTOMATION')))
  where p.deleted_at is null
  order by coalesce(p.display_name,p.email,p.id::text),p.id;
end;
$$;

create table if not exists public.benefit_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sales_start_at date not null,
  sales_end_at date not null,
  sales_channel text not null,
  is_fansign boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ENDED')),
  cancel_normal_values text[] not null default array['','N','정상']::text[],
  cancel_exclude_values text[] not null default array[]::text[],
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check (sales_end_at >= sales_start_at)
);

create table if not exists public.benefit_event_classes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.benefit_events(id) on delete restrict,
  classification_raw text not null,
  event_marker text not null default '',
  event_type text not null,
  is_selected boolean not null default true,
  source_row_count integer not null default 0 check (source_row_count>=0),
  source_qty_sum numeric not null default 0 check (source_qty_sum>=0),
  manual_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,classification_raw)
);

create table if not exists public.benefit_rules (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.benefit_events(id) on delete restrict,
  name text not null,
  rule_type text not null check (rule_type in ('QUANTITY','AMOUNT','PER_ORDER','PER_SHIPMENT')),
  threshold_value numeric not null default 1 check (threshold_value>0),
  reward_quantity numeric not null default 1 check (reward_quantity>0),
  reward_unit text not null default '장',
  repeat_enabled boolean not null default true,
  one_time_only boolean not null default false,
  maximum_reward_quantity numeric,
  is_active boolean not null default true,
  version integer not null default 1 check (version>0),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique(event_id,name),
  check (maximum_reward_quantity is null or maximum_reward_quantity>=0)
);

create table if not exists public.benefit_rule_classes (
  rule_id uuid not null references public.benefit_rules(id) on delete cascade,
  event_class_id uuid not null references public.benefit_event_classes(id) on delete restrict,
  primary key(rule_id,event_class_id)
);

create table if not exists public.benefit_order_imports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.benefit_events(id) on delete restrict,
  original_file_name text not null,
  file_hash text not null,
  import_version integer not null,
  row_count integer not null check (row_count>=0),
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'STAGING',
  unique(event_id,import_version)
);
alter table public.benefit_order_imports drop constraint if exists benefit_order_imports_status_check;
alter table public.benefit_order_imports add constraint benefit_order_imports_status_check
  check (status in ('STAGING','IMPORTED','SUPERSEDED','INVALID'));
create index if not exists benefit_order_import_hash_idx on public.benefit_order_imports(event_id,file_hash);
create index if not exists benefit_order_import_active_idx on public.benefit_order_imports(event_id,import_version desc) where status='IMPORTED';

create table if not exists public.benefit_order_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.benefit_order_imports(id) on delete restrict,
  source_row_number integer not null check (source_row_number>0),
  shipping_no text not null default '',
  order_no text not null default '',
  line_order_no text not null default '',
  original_product_name text not null default '',
  quantity numeric not null default 0,
  item_amount numeric not null default 0,
  total_payment_amount numeric not null default 0,
  cancel_status text not null default '',
  mall text not null default '',
  orderer_name text not null default '',
  orderer_phone text not null default '',
  recipient_name text not null default '',
  classification_raw text,
  event_marker text,
  event_type text,
  classification_status text not null default 'AUTO' check (classification_status in ('AUTO','REVIEW','MANUAL')),
  calculation_included boolean not null default true,
  review_message text,
  original_row jsonb not null,
  manual_classified_by uuid references auth.users(id),
  manual_classified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(import_id,source_row_number)
);
create index if not exists benefit_order_rows_import_idx on public.benefit_order_rows(import_id,mall,order_no,event_type,shipping_no);

create table if not exists public.benefit_winner_imports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.benefit_events(id) on delete restrict,
  original_file_name text not null,
  file_hash text not null,
  import_version integer not null,
  row_count integer not null check (row_count>=0),
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'STAGING',
  unique(event_id,import_version)
);
alter table public.benefit_winner_imports drop constraint if exists benefit_winner_imports_status_check;
alter table public.benefit_winner_imports add constraint benefit_winner_imports_status_check
  check (status in ('STAGING','IMPORTED','SUPERSEDED','INVALID'));
create index if not exists benefit_winner_import_hash_idx on public.benefit_winner_imports(event_id,file_hash);
create index if not exists benefit_winner_import_active_idx on public.benefit_winner_imports(event_id,import_version desc) where status='IMPORTED';

create table if not exists public.benefit_winner_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.benefit_winner_imports(id) on delete restrict,
  source_row_number integer not null check (source_row_number>0),
  mall text not null default '',
  order_no text not null default '',
  orderer_name text not null default '',
  orderer_phone text not null default '',
  product_name text not null default '',
  applicant_name text not null default '',
  quantity numeric not null default 0,
  event_type text,
  classification_raw text,
  photo_benefit_raw text not null default '',
  is_photo_benefit boolean not null default false,
  match_status text not null default 'PENDING',
  match_message text,
  matched_order_row_id uuid references public.benefit_order_rows(id) on delete restrict,
  original_row jsonb not null,
  created_at timestamptz not null default now(),
  unique(import_id,source_row_number)
);
create index if not exists benefit_winner_rows_import_idx on public.benefit_winner_rows(import_id,mall,order_no,event_type);

create table if not exists public.benefit_calculation_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.benefit_events(id) on delete restrict,
  order_import_id uuid not null references public.benefit_order_imports(id) on delete restrict,
  winner_import_id uuid references public.benefit_winner_imports(id) on delete restrict,
  rule_version_snapshot jsonb not null default '[]'::jsonb,
  selected_classes_snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'RUNNING',
  started_by uuid not null default auth.uid() references auth.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result_hash text,
  summary jsonb not null default '{}'::jsonb
);
alter table public.benefit_calculation_runs drop constraint if exists benefit_calculation_runs_status_check;
alter table public.benefit_calculation_runs add constraint benefit_calculation_runs_status_check
  check (status in ('RUNNING','COMPLETED','REVIEW_REQUIRED','INVALIDATED'));

create table if not exists public.benefit_calculation_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.benefit_calculation_runs(id) on delete restrict,
  shipping_no text not null default '',
  order_no text not null default '',
  event_type text not null default '',
  purchase_qty numeric not null default 0,
  benefit_basis_qty numeric not null default 0,
  onsite_pickup_qty numeric not null default 0,
  warehouse_ship_qty numeric not null default 0,
  is_winner boolean not null default false,
  is_photo_benefit boolean not null default false,
  benefits jsonb not null default '[]'::jsonb,
  calculation_status text not null default 'OK',
  review_message text,
  representative_source_row_id uuid references public.benefit_order_rows(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists benefit_calculation_results_run_idx on public.benefit_calculation_results(run_id,shipping_no,order_no,event_type);

create table if not exists public.benefit_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.benefit_events(id) on delete restrict,
  entity_type text not null,
  entity_id text,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  actor_id uuid default auth.uid() references auth.users(id),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists benefit_audit_events_event_idx on public.benefit_audit_events(event_id,created_at desc);

create or replace function public.benefit_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  new.updated_at=now();
  if tg_table_name in ('benefit_events','benefit_rules') then new.updated_by=auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists trg_benefit_events_touch on public.benefit_events;
create trigger trg_benefit_events_touch before update on public.benefit_events
for each row execute function public.benefit_touch_updated_at();
drop trigger if exists trg_benefit_event_classes_touch on public.benefit_event_classes;
create trigger trg_benefit_event_classes_touch before update on public.benefit_event_classes
for each row execute function public.benefit_touch_updated_at();
drop trigger if exists trg_benefit_rules_touch on public.benefit_rules;
create trigger trg_benefit_rules_touch before update on public.benefit_rules
for each row execute function public.benefit_touch_updated_at();

create or replace function public.benefit_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_event_id uuid;
  v_entity_id text;
begin
  v_entity_id:=case when tg_op='DELETE' then old.id::text else new.id::text end;
  if tg_table_name='benefit_events' then
    v_event_id:=case when tg_op='DELETE' then old.id else new.id end;
  elsif tg_table_name in ('benefit_event_classes','benefit_rules','benefit_order_imports','benefit_winner_imports','benefit_calculation_runs') then
    v_event_id:=case when tg_op='DELETE' then old.event_id else new.event_id end;
  elsif tg_table_name='benefit_order_rows' then
    select i.event_id into v_event_id from public.benefit_order_imports i
    where i.id=case when tg_op='DELETE' then old.import_id else new.import_id end;
  elsif tg_table_name='benefit_winner_rows' then
    select i.event_id into v_event_id from public.benefit_winner_imports i
    where i.id=case when tg_op='DELETE' then old.import_id else new.import_id end;
  end if;
  insert into public.benefit_audit_events(event_id,entity_type,entity_id,action,before_data,after_data,actor_id)
  values(
    v_event_id,tg_table_name,v_entity_id,tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    auth.uid()
  );
  return case when tg_op='DELETE' then old else new end;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['benefit_events','benefit_event_classes','benefit_rules','benefit_order_imports','benefit_winner_imports','benefit_calculation_runs']
  loop
    execute format('drop trigger if exists trg_%I_audit on public.%I',t,t);
    execute format('create trigger trg_%I_audit after insert or update on public.%I for each row execute function public.benefit_audit_trigger()',t,t);
  end loop;
end $$;
drop trigger if exists trg_benefit_order_rows_audit on public.benefit_order_rows;
create trigger trg_benefit_order_rows_audit after update on public.benefit_order_rows
for each row execute function public.benefit_audit_trigger();
drop trigger if exists trg_benefit_winner_rows_audit on public.benefit_winner_rows;
create trigger trg_benefit_winner_rows_audit after update on public.benefit_winner_rows
for each row execute function public.benefit_audit_trigger();

-- 최신 정상 주문버전의 분류를 정확히 동기화한다. stale 분류는 삭제하지 않고 수량만 0으로 남겨 이력을 보존한다.
create or replace function public.benefit_sync_event_classes_internal(p_event_id uuid,p_import_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.benefit_event_classes
  set source_row_count=0,source_qty_sum=0,manual_override=false,updated_at=now()
  where event_id=p_event_id;

  insert into public.benefit_event_classes(
    event_id,classification_raw,event_marker,event_type,is_selected,source_row_count,source_qty_sum,manual_override
  )
  select p_event_id,
         r.classification_raw,
         max(coalesce(r.event_marker,'')),
         max(coalesce(r.event_type,'')),
         true,
         count(*)::integer,
         coalesce(sum(r.quantity),0),
         bool_or(r.classification_status='MANUAL')
  from public.benefit_order_rows r
  where r.import_id=p_import_id
    and nullif(btrim(coalesce(r.classification_raw,'')),'') is not null
    and nullif(btrim(coalesce(r.event_type,'')),'') is not null
  group by r.classification_raw
  on conflict(event_id,classification_raw) do update
  set event_marker=excluded.event_marker,
      event_type=excluded.event_type,
      source_row_count=excluded.source_row_count,
      source_qty_sum=excluded.source_qty_sum,
      manual_override=excluded.manual_override,
      updated_at=now();
end;
$$;

create or replace function public.sync_benefit_event_classes(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_import_id uuid;
begin
  perform public.require_user_feature_access('BENEFIT_AUTOMATION');
  select id into v_import_id
  from public.benefit_order_imports
  where event_id=p_event_id and status='IMPORTED'
  order by import_version desc
  limit 1;
  if v_import_id is null then return; end if;
  perform public.benefit_sync_event_classes_internal(p_event_id,v_import_id);
end;
$$;

create or replace function public.begin_benefit_order_import(
  p_event_id uuid,p_file_name text,p_file_hash text,p_row_count integer
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_version integer; v_row public.benefit_order_imports%rowtype;
begin
  perform public.require_user_feature_access('BENEFIT_AUTOMATION');
  if p_row_count<1 then raise exception '주문자료가 비어 있습니다.'; end if;
  perform 1 from public.benefit_events where id=p_event_id for update;
  if not found then raise exception '행사를 찾을 수 없습니다.'; end if;
  select coalesce(max(import_version),0)+1 into v_version
  from public.benefit_order_imports where event_id=p_event_id;
  insert into public.benefit_order_imports(event_id,original_file_name,file_hash,import_version,row_count,status)
  values(p_event_id,btrim(p_file_name),btrim(p_file_hash),v_version,p_row_count,'STAGING')
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.finalize_benefit_order_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_row public.benefit_order_imports%rowtype; v_count integer;
begin
  perform public.require_user_feature_access('BENEFIT_AUTOMATION');
  select * into v_row from public.benefit_order_imports where id=p_import_id for update;
  if not found then raise exception '주문 업로드 버전을 찾을 수 없습니다.'; end if;
  if v_row.status<>'STAGING' then raise exception 'STAGING 상태의 주문 업로드만 확정할 수 있습니다.'; end if;
  if v_row.uploaded_by<>auth.uid() then raise exception '본인이 시작한 주문 업로드만 확정할 수 있습니다.'; end if;
  select count(*) into v_count from public.benefit_order_rows where import_id=p_import_id;
  if v_count<>v_row.row_count then
    raise exception '주문 업로드 행 수 검증 실패: 예상 %행 / 저장 %행',v_row.row_count,v_count;
  end if;
  update public.benefit_order_imports
  set status='SUPERSEDED'
  where event_id=v_row.event_id and status='IMPORTED' and id<>v_row.id;
  update public.benefit_order_imports set status='IMPORTED' where id=v_row.id returning * into v_row;
  perform public.benefit_sync_event_classes_internal(v_row.event_id,v_row.id);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.invalidate_benefit_order_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.require_user_feature_access('BENEFIT_AUTOMATION');
  update public.benefit_order_imports set status='INVALID'
  where id=p_import_id and status='STAGING' and uploaded_by=auth.uid();
end;
$$;

create or replace function public.begin_benefit_winner_import(
  p_event_id uuid,p_file_name text,p_file_hash text,p_row_count integer
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_version integer; v_row public.benefit_winner_imports%rowtype;
begin
  perform public.require_user_feature_access('BENEFIT_AUTOMATION');
  if p_row_count<1 then raise exception '당첨자자료가 비어 있습니다.'; end if;
  perform 1 from public.benefit_events where id=p_event_id and is_fansign=true for update;
  if not found then raise exception '사인회 행사를 찾을 수 없습니다.'; end if;
  select coalesce(max(import_version),0)+1 into v_version
  from public.benefit_winner_imports where event_id=p_event_id;
  insert into public.benefit_winner_imports(event_id,original_file_name,file_hash,import_version,row_count,status)
  values(p_event_id,btrim(p_file_name),btrim(p_file_hash),v_version,p_row_count,'STAGING')
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.finalize_benefit_winner_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_row public.benefit_winner_imports%rowtype; v_count integer;
begin
  perform public.require_user_feature_access('BENEFIT_AUTOMATION');
  select * into v_row from public.benefit_winner_imports where id=p_import_id for update;
  if not found then raise exception '당첨자 업로드 버전을 찾을 수 없습니다.'; end if;
  if v_row.status<>'STAGING' then raise exception 'STAGING 상태의 당첨자 업로드만 확정할 수 있습니다.'; end if;
  if v_row.uploaded_by<>auth.uid() then raise exception '본인이 시작한 당첨자 업로드만 확정할 수 있습니다.'; end if;
  select count(*) into v_count from public.benefit_winner_rows where import_id=p_import_id;
  if v_count<>v_row.row_count then
    raise exception '당첨자 업로드 행 수 검증 실패: 예상 %행 / 저장 %행',v_row.row_count,v_count;
  end if;
  update public.benefit_winner_imports
  set status='SUPERSEDED'
  where event_id=v_row.event_id and status='IMPORTED' and id<>v_row.id;
  update public.benefit_winner_imports set status='IMPORTED' where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.invalidate_benefit_winner_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.require_user_feature_access('BENEFIT_AUTOMATION');
  update public.benefit_winner_imports set status='INVALID'
  where id=p_import_id and status='STAGING' and uploaded_by=auth.uid();
end;
$$;

create or replace function public.save_benefit_rule(
  p_rule_id uuid,
  p_event_id uuid,
  p_name text,
  p_rule_type text,
  p_threshold_value numeric,
  p_reward_quantity numeric,
  p_reward_unit text,
  p_repeat_enabled boolean,
  p_one_time_only boolean,
  p_maximum_reward_quantity numeric,
  p_class_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_rule_id uuid; v_expected integer; v_actual integer;
begin
  perform public.require_user_feature_access('BENEFIT_AUTOMATION');
  if nullif(btrim(coalesce(p_name,'')),'') is null then raise exception '특전명을 입력하세요.'; end if;
  if p_rule_type not in ('QUANTITY','AMOUNT','PER_ORDER','PER_SHIPMENT') then raise exception '지원되지 않는 특전 기준입니다.'; end if;
  if coalesce(p_threshold_value,0)<=0 or coalesce(p_reward_quantity,0)<=0 then raise exception '기준값과 지급수량은 0보다 커야 합니다.'; end if;
  if p_maximum_reward_quantity is not null and p_maximum_reward_quantity<0 then raise exception '최대 지급수량은 0 이상이어야 합니다.'; end if;
  v_expected:=coalesce(cardinality(p_class_ids),0);
  if v_expected=0 then raise exception '적용할 행사 유형을 하나 이상 선택하세요.'; end if;
  select count(distinct c.id)::integer into v_actual
  from public.benefit_event_classes c
  where c.event_id=p_event_id and c.id=any(p_class_ids);
  if v_actual<>v_expected then raise exception '다른 행사에 속한 분류가 포함되어 있습니다.'; end if;

  if p_rule_id is null then
    insert into public.benefit_rules(
      event_id,name,rule_type,threshold_value,reward_quantity,reward_unit,
      repeat_enabled,one_time_only,maximum_reward_quantity,is_active
    ) values (
      p_event_id,btrim(p_name),p_rule_type,p_threshold_value,p_reward_quantity,
      coalesce(nullif(btrim(p_reward_unit),''),'장'),coalesce(p_repeat_enabled,true),
      coalesce(p_one_time_only,false),p_maximum_reward_quantity,true
    ) returning id into v_rule_id;
  else
    update public.benefit_rules
    set name=btrim(p_name),rule_type=p_rule_type,threshold_value=p_threshold_value,
        reward_quantity=p_reward_quantity,reward_unit=coalesce(nullif(btrim(p_reward_unit),''),'장'),
        repeat_enabled=coalesce(p_repeat_enabled,true),one_time_only=coalesce(p_one_time_only,false),
        maximum_reward_quantity=p_maximum_reward_quantity,is_active=true,version=version+1
    where id=p_rule_id and event_id=p_event_id
    returning id into v_rule_id;
    if v_rule_id is null then raise exception '수정할 특전 규칙을 찾을 수 없습니다.'; end if;
  end if;

  delete from public.benefit_rule_classes where rule_id=v_rule_id;
  insert into public.benefit_rule_classes(rule_id,event_class_id)
  select v_rule_id,id from unnest(p_class_ids) as id;
  return v_rule_id;
end;
$$;

create or replace function public.deactivate_benefit_rule(p_rule_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.require_user_feature_access('BENEFIT_AUTOMATION');
  update public.benefit_rules
  set is_active=false,version=version+1
  where id=p_rule_id and is_active=true;
  if not found then raise exception '활성 특전 규칙을 찾을 수 없습니다.'; end if;
end;
$$;

-- RLS: 역할이 아니라 사용자 준비상태 + BENEFIT_AUTOMATION 계정 승인만 본다.
do $$
declare t text;
begin
  foreach t in array array[
    'benefit_events','benefit_event_classes','benefit_rules','benefit_rule_classes',
    'benefit_order_imports','benefit_order_rows','benefit_winner_imports','benefit_winner_rows',
    'benefit_calculation_runs','benefit_calculation_results','benefit_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I','benefit_feature_select_'||t,t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_user_feature_access(''BENEFIT_AUTOMATION''))','benefit_feature_select_'||t,t);
    execute format('drop policy if exists %I on public.%I','benefit_feature_insert_'||t,t);
    execute format('drop policy if exists %I on public.%I','benefit_feature_update_'||t,t);
    execute format('drop policy if exists %I on public.%I','benefit_feature_delete_'||t,t);
  end loop;
end $$;

create policy benefit_feature_insert_events on public.benefit_events
for insert to authenticated with check (public.has_user_feature_access('BENEFIT_AUTOMATION'));
create policy benefit_feature_update_events on public.benefit_events
for update to authenticated using (public.has_user_feature_access('BENEFIT_AUTOMATION')) with check (public.has_user_feature_access('BENEFIT_AUTOMATION'));
create policy benefit_feature_update_classes on public.benefit_event_classes
for update to authenticated using (public.has_user_feature_access('BENEFIT_AUTOMATION')) with check (public.has_user_feature_access('BENEFIT_AUTOMATION'));
create policy benefit_feature_insert_order_rows on public.benefit_order_rows
for insert to authenticated with check (public.has_user_feature_access('BENEFIT_AUTOMATION'));
create policy benefit_feature_update_order_rows on public.benefit_order_rows
for update to authenticated using (public.has_user_feature_access('BENEFIT_AUTOMATION')) with check (public.has_user_feature_access('BENEFIT_AUTOMATION'));
create policy benefit_feature_insert_winner_rows on public.benefit_winner_rows
for insert to authenticated with check (public.has_user_feature_access('BENEFIT_AUTOMATION'));
create policy benefit_feature_update_winner_rows on public.benefit_winner_rows
for update to authenticated using (public.has_user_feature_access('BENEFIT_AUTOMATION')) with check (public.has_user_feature_access('BENEFIT_AUTOMATION'));
create policy benefit_feature_insert_calculation_runs on public.benefit_calculation_runs
for insert to authenticated with check (public.has_user_feature_access('BENEFIT_AUTOMATION'));
create policy benefit_feature_update_calculation_runs on public.benefit_calculation_runs
for update to authenticated using (public.has_user_feature_access('BENEFIT_AUTOMATION')) with check (public.has_user_feature_access('BENEFIT_AUTOMATION'));
create policy benefit_feature_insert_calculation_results on public.benefit_calculation_results
for insert to authenticated with check (public.has_user_feature_access('BENEFIT_AUTOMATION'));

revoke all on public.benefit_events,public.benefit_event_classes,public.benefit_rules,public.benefit_rule_classes,
  public.benefit_order_imports,public.benefit_order_rows,public.benefit_winner_imports,public.benefit_winner_rows,
  public.benefit_calculation_runs,public.benefit_calculation_results,public.benefit_audit_events
from public,anon,authenticated;

grant select,insert,update on public.benefit_events to authenticated;
grant select,update on public.benefit_event_classes to authenticated;
grant select on public.benefit_rules,public.benefit_rule_classes,public.benefit_order_imports,public.benefit_winner_imports to authenticated;
grant select,insert,update on public.benefit_order_rows,public.benefit_winner_rows to authenticated;
grant select,insert,update on public.benefit_calculation_runs to authenticated;
grant select,insert on public.benefit_calculation_results to authenticated;
grant select on public.benefit_audit_events to authenticated;

revoke all on function public.benefit_touch_updated_at() from public,anon,authenticated;
revoke all on function public.benefit_audit_trigger() from public,anon,authenticated;
revoke all on function public.benefit_sync_event_classes_internal(uuid,uuid) from public,anon,authenticated;

revoke all on function public.get_my_feature_access(text) from public,anon;
grant execute on function public.get_my_feature_access(text) to authenticated;
revoke all on function public.has_user_feature_access(text) from public,anon;
grant execute on function public.has_user_feature_access(text) to authenticated;
revoke all on function public.require_user_feature_access(text) from public,anon;
grant execute on function public.require_user_feature_access(text) to authenticated;
revoke all on function public.admin_set_user_feature_grant(uuid,text,boolean,text) from public,anon;
grant execute on function public.admin_set_user_feature_grant(uuid,text,boolean,text) to authenticated;
revoke all on function public.admin_list_user_feature_grants(text) from public,anon;
grant execute on function public.admin_list_user_feature_grants(text) to authenticated;
revoke all on function public.sync_benefit_event_classes(uuid) from public,anon;
grant execute on function public.sync_benefit_event_classes(uuid) to authenticated;
revoke all on function public.begin_benefit_order_import(uuid,text,text,integer) from public,anon;
grant execute on function public.begin_benefit_order_import(uuid,text,text,integer) to authenticated;
revoke all on function public.finalize_benefit_order_import(uuid) from public,anon;
grant execute on function public.finalize_benefit_order_import(uuid) to authenticated;
revoke all on function public.invalidate_benefit_order_import(uuid) from public,anon;
grant execute on function public.invalidate_benefit_order_import(uuid) to authenticated;
revoke all on function public.begin_benefit_winner_import(uuid,text,text,integer) from public,anon;
grant execute on function public.begin_benefit_winner_import(uuid,text,text,integer) to authenticated;
revoke all on function public.finalize_benefit_winner_import(uuid) from public,anon;
grant execute on function public.finalize_benefit_winner_import(uuid) to authenticated;
revoke all on function public.invalidate_benefit_winner_import(uuid) from public,anon;
grant execute on function public.invalidate_benefit_winner_import(uuid) to authenticated;
revoke all on function public.save_benefit_rule(uuid,uuid,text,text,numeric,numeric,text,boolean,boolean,numeric,uuid[]) from public,anon;
grant execute on function public.save_benefit_rule(uuid,uuid,text,text,numeric,numeric,text,boolean,boolean,numeric,uuid[]) to authenticated;
revoke all on function public.deactivate_benefit_rule(uuid) from public,anon;
grant execute on function public.deactivate_benefit_rule(uuid) to authenticated;

notify pgrst,'reload schema';
commit;

select 'SAN WMS V4.7.0 benefit automation migration completed' as result;
