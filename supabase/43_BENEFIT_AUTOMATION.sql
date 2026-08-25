-- SAN WMS V4.7.0
-- 특전 자동계산 독립 모듈
--
-- 핵심 원칙
--   * 본 기능은 inventory_balances / inventory_transactions / products / locations 를 조회·수정하지 않는다.
--   * 역할(role)과 별개로 관리자에게 BENEFIT_AUTOMATION 기능 승인을 받은 계정만 접근한다.
--   * viewer라도 승인되면 사용 가능하며 manager/admin이라도 승인되지 않으면 접근할 수 없다.
--   * 기능 승인/회수만 admin 역할이 수행한다.
--   * 주문/당첨자 원본, 규칙, 수동 분류, 계산 결과는 별도 테이블에 보존한다.

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

create or replace function public.has_user_feature_access(p_feature_key text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.profiles p
      where p.id=auth.uid()
        and coalesce(p.active,true)=true
    )
    and exists (
      select 1
      from public.user_feature_grants g
      where g.user_id=auth.uid()
        and g.feature_key=upper(btrim(p_feature_key))
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
  if not exists(select 1 from public.profiles where id=p_user_id) then
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
    'user_feature_grant',p_user_id::text,v_key,
    v_before,v_after,nullif(btrim(coalesce(p_reason,'')),'')
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
  order by p.id;
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
  event_id uuid not null references public.benefit_events(id) on delete cascade,
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
  event_id uuid not null references public.benefit_events(id) on delete cascade,
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
  event_class_id uuid not null references public.benefit_event_classes(id) on delete cascade,
  primary key(rule_id,event_class_id)
);

create table if not exists public.benefit_order_imports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.benefit_events(id) on delete cascade,
  original_file_name text not null,
  file_hash text not null,
  import_version integer not null,
  row_count integer not null check (row_count>=0),
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'IMPORTED' check (status in ('IMPORTED','SUPERSEDED','INVALID')),
  unique(event_id,import_version)
);
create index if not exists benefit_order_import_hash_idx on public.benefit_order_imports(event_id,file_hash);

create table if not exists public.benefit_order_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.benefit_order_imports(id) on delete cascade,
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
create index if not exists benefit_order_rows_import_idx on public.benefit_order_rows(import_id,shipping_no,order_no,event_type);

create table if not exists public.benefit_winner_imports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.benefit_events(id) on delete cascade,
  original_file_name text not null,
  file_hash text not null,
  import_version integer not null,
  row_count integer not null check (row_count>=0),
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'IMPORTED' check (status in ('IMPORTED','SUPERSEDED','INVALID')),
  unique(event_id,import_version)
);
create index if not exists benefit_winner_import_hash_idx on public.benefit_winner_imports(event_id,file_hash);

create table if not exists public.benefit_winner_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.benefit_winner_imports(id) on delete cascade,
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
  matched_order_row_id uuid references public.benefit_order_rows(id),
  original_row jsonb not null,
  created_at timestamptz not null default now(),
  unique(import_id,source_row_number)
);
create index if not exists benefit_winner_rows_import_idx on public.benefit_winner_rows(import_id,mall,order_no,event_type);

create table if not exists public.benefit_calculation_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.benefit_events(id) on delete cascade,
  order_import_id uuid not null references public.benefit_order_imports(id),
  winner_import_id uuid references public.benefit_winner_imports(id),
  rule_version_snapshot jsonb not null default '[]'::jsonb,
  selected_classes_snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'COMPLETED' check (status in ('RUNNING','COMPLETED','REVIEW_REQUIRED','INVALIDATED')),
  started_by uuid not null default auth.uid() references auth.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result_hash text,
  summary jsonb not null default '{}'::jsonb
);

create table if not exists public.benefit_calculation_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.benefit_calculation_runs(id) on delete cascade,
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
  representative_source_row_id uuid references public.benefit_order_rows(id),
  created_at timestamptz not null default now()
);
create index if not exists benefit_calculation_results_run_idx on public.benefit_calculation_results(run_id,shipping_no,order_no,event_type);

create table if not exists public.benefit_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.benefit_events(id) on delete cascade,
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
  if tg_table_name in ('benefit_events','benefit_rules') then
    new.updated_by=auth.uid();
  end if;
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
  if tg_op='DELETE' then
    v_entity_id:=old.id::text;
  else
    v_entity_id:=new.id::text;
  end if;

  if tg_table_name='benefit_events' then
    v_event_id:=case when tg_op='DELETE' then old.id else new.id end;
  elsif tg_table_name in ('benefit_event_classes','benefit_rules','benefit_order_imports','benefit_winner_imports','benefit_calculation_runs') then
    v_event_id:=case when tg_op='DELETE' then old.event_id else new.event_id end;
  elsif tg_table_name='benefit_order_rows' then
    select i.event_id into v_event_id from public.benefit_order_imports i where i.id=case when tg_op='DELETE' then old.import_id else new.import_id end;
  elsif tg_table_name='benefit_winner_rows' then
    select i.event_id into v_event_id from public.benefit_winner_imports i where i.id=case when tg_op='DELETE' then old.import_id else new.import_id end;
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

-- 원본 업로드 행 INSERT 자체는 import 원본 JSONB가 증빙이므로 대량 감사 이벤트를 만들지 않는다.
-- 수동 분류/당첨자 매칭 수정은 UPDATE만 감사한다.
do $$
declare
  t text;
begin
  foreach t in array array['benefit_events','benefit_event_classes','benefit_rules','benefit_order_imports','benefit_winner_imports','benefit_calculation_runs']
  loop
    execute format('drop trigger if exists trg_%I_audit on public.%I',t,t);
    execute format('create trigger trg_%I_audit after insert or update or delete on public.%I for each row execute function public.benefit_audit_trigger()',t,t);
  end loop;
end $$;

drop trigger if exists trg_benefit_order_rows_audit on public.benefit_order_rows;
create trigger trg_benefit_order_rows_audit after update on public.benefit_order_rows
for each row execute function public.benefit_audit_trigger();

drop trigger if exists trg_benefit_winner_rows_audit on public.benefit_winner_rows;
create trigger trg_benefit_winner_rows_audit after update on public.benefit_winner_rows
for each row execute function public.benefit_audit_trigger();

-- RLS: 역할이 아니라 계정별 BENEFIT_AUTOMATION 승인만 본다.
do $$
declare
  t text;
begin
  foreach t in array array[
    'benefit_events','benefit_event_classes','benefit_rules','benefit_rule_classes',
    'benefit_order_imports','benefit_order_rows','benefit_winner_imports','benefit_winner_rows',
    'benefit_calculation_runs','benefit_calculation_results','benefit_audit_events'
  ]
  loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I','benefit_feature_select_'||t,t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_user_feature_access(''BENEFIT_AUTOMATION''))','benefit_feature_select_'||t,t);
    if t <> 'benefit_audit_events' then
      execute format('drop policy if exists %I on public.%I','benefit_feature_insert_'||t,t);
      execute format('drop policy if exists %I on public.%I','benefit_feature_update_'||t,t);
      execute format('drop policy if exists %I on public.%I','benefit_feature_delete_'||t,t);
      execute format('create policy %I on public.%I for insert to authenticated with check (public.has_user_feature_access(''BENEFIT_AUTOMATION''))','benefit_feature_insert_'||t,t);
      execute format('create policy %I on public.%I for update to authenticated using (public.has_user_feature_access(''BENEFIT_AUTOMATION'')) with check (public.has_user_feature_access(''BENEFIT_AUTOMATION''))','benefit_feature_update_'||t,t);
      execute format('create policy %I on public.%I for delete to authenticated using (public.has_user_feature_access(''BENEFIT_AUTOMATION''))','benefit_feature_delete_'||t,t);
    end if;
  end loop;
end $$;

-- 감사 이벤트는 trigger에서만 작성한다.
revoke insert,update,delete on public.benefit_audit_events from authenticated;

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

notify pgrst,'reload schema';
commit;

select 'SAN WMS V4.7.0 benefit automation migration completed' as result;
