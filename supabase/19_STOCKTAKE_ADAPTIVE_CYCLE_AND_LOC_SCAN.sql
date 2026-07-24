-- SAN WMS V3.9.0
-- 이동 빈도 기반 적응형 재고실사 주기
--
-- 기본 정책
--   HIGH   : 14일 (최근 90일 이동 12건 이상 또는 출고 100개 이상)
--   MEDIUM : 30일 (최근 90일 이동 4건 이상 또는 출고 20개 이상)
--   LOW    : 90일 (최근 180일 내 이동은 있으나 위 기준 미만)
--   DORMANT: 최근 180일 무이동 SKU만 있는 LOC. 최초 실사 후 자동 사이클 중지
--
-- 혼재 LOC는 활동 SKU가 하나라도 있으면 LOC 자동 실사를 유지한다.
-- 무이동 SKU는 자동 주기를 유발하지 않지만 같은 LOC의 활동 SKU 실사에는 함께 포함된다.

begin;

create table if not exists public.inventory_cycle_settings (
  id smallint primary key default 1 check (id = 1),
  lookback_days integer not null default 90 check (lookback_days > 0),
  dormant_days integer not null default 180 check (dormant_days > 0),
  high_event_threshold integer not null default 12 check (high_event_threshold > 0),
  high_outbound_qty_threshold numeric not null default 100 check (high_outbound_qty_threshold >= 0),
  high_cycle_days integer not null default 14 check (high_cycle_days > 0),
  medium_event_threshold integer not null default 4 check (medium_event_threshold > 0),
  medium_outbound_qty_threshold numeric not null default 20 check (medium_outbound_qty_threshold >= 0),
  medium_cycle_days integer not null default 30 check (medium_cycle_days > 0),
  low_cycle_days integer not null default 90 check (low_cycle_days > 0),
  updated_at timestamptz not null default now()
);

insert into public.inventory_cycle_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.inventory_cycle_item_profiles (
  product_id uuid not null,
  location_id uuid not null,
  last_movement_at timestamptz,
  movement_events_90d integer not null default 0,
  movement_events_180d integer not null default 0,
  outbound_qty_90d numeric not null default 0,
  cycle_state text not null default 'DORMANT' check (cycle_state in ('ACTIVE','DORMANT')),
  evaluated_at timestamptz not null default now(),
  primary key (product_id, location_id)
);

create index if not exists idx_inventory_cycle_item_profiles_location
  on public.inventory_cycle_item_profiles (location_id);

create table if not exists public.inventory_cycle_location_profiles (
  location_id uuid primary key,
  cycle_class text not null default 'BASELINE' check (cycle_class in ('BASELINE','HIGH','MEDIUM','LOW','DORMANT')),
  auto_cycle_enabled boolean not null default true,
  cycle_days integer,
  movement_events_90d integer not null default 0,
  outbound_qty_90d numeric not null default 0,
  last_movement_at timestamptz,
  active_sku_count integer not null default 0,
  dormant_sku_count integer not null default 0,
  last_counted_at timestamptz,
  next_due_at timestamptz,
  evaluated_at timestamptz not null default now()
);

create table if not exists public.inventory_cycle_dirty_locations (
  location_id uuid primary key,
  changed_at timestamptz not null default now()
);

-- 기존 트랜잭션 테이블이 존재하는 경우 프로필 집계용 인덱스를 보강한다.
do $$
begin
  if to_regclass('public.inventory_transactions') is not null then
    execute 'create index if not exists idx_inventory_transactions_location_created on public.inventory_transactions (location_id, created_at desc)';
    execute 'create index if not exists idx_inventory_transactions_product_location_created on public.inventory_transactions (product_id, location_id, created_at desc)';
  end if;
end;
$$;

create or replace function public.refresh_inventory_cycle_profile(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.inventory_cycle_settings%rowtype;
  v_last_counted_at timestamptz;
  v_last_movement_at timestamptz;
  v_movement_events_90d integer := 0;
  v_outbound_qty_90d numeric := 0;
  v_active_sku_count integer := 0;
  v_dormant_sku_count integer := 0;
  v_cycle_class text := 'BASELINE';
  v_auto_cycle_enabled boolean := true;
  v_cycle_days integer;
  v_next_due_at timestamptz;
begin
  select * into v_cfg
  from public.inventory_cycle_settings
  where id = 1;

  if not found then
    raise exception '재고실사 사이클 설정을 찾을 수 없습니다.';
  end if;

  -- 현재 해당 LOC에 존재하지 않는 품목 프로필은 제거한다.
  delete from public.inventory_cycle_item_profiles p
  where p.location_id = p_location_id
    and not exists (
      select 1
      from public.inventory_stock_view s
      where s.location_id = p.location_id
        and s.product_id = p.product_id
        and coalesce(s.qty, 0) > 0
    );

  -- 현재 적치된 SKU별 이동 이력을 갱신한다.
  insert into public.inventory_cycle_item_profiles (
    product_id,
    location_id,
    last_movement_at,
    movement_events_90d,
    movement_events_180d,
    outbound_qty_90d,
    cycle_state,
    evaluated_at
  )
  select
    s.product_id,
    s.location_id,
    max(t.created_at) as last_movement_at,
    count(t.product_id) filter (
      where t.created_at >= now() - make_interval(days => v_cfg.lookback_days)
    )::integer as movement_events_90d,
    count(t.product_id) filter (
      where t.created_at >= now() - make_interval(days => v_cfg.dormant_days)
    )::integer as movement_events_180d,
    coalesce(sum(t.qty) filter (
      where t.operation = 'OB'
        and t.created_at >= now() - make_interval(days => v_cfg.lookback_days)
    ), 0) as outbound_qty_90d,
    case
      when max(t.created_at) >= now() - make_interval(days => v_cfg.dormant_days) then 'ACTIVE'
      else 'DORMANT'
    end as cycle_state,
    now()
  from public.inventory_stock_view s
  left join public.inventory_transaction_view t
    on t.product_id = s.product_id
   and t.location_id = s.location_id
   and coalesce(t.status, 'ACTIVE') = 'ACTIVE'
  where s.location_id = p_location_id
    and coalesce(s.qty, 0) > 0
  group by s.product_id, s.location_id
  on conflict (product_id, location_id) do update
  set last_movement_at = excluded.last_movement_at,
      movement_events_90d = excluded.movement_events_90d,
      movement_events_180d = excluded.movement_events_180d,
      outbound_qty_90d = excluded.outbound_qty_90d,
      cycle_state = excluded.cycle_state,
      evaluated_at = excluded.evaluated_at;

  select
    coalesce(sum(p.movement_events_90d), 0)::integer,
    coalesce(sum(p.outbound_qty_90d), 0),
    max(p.last_movement_at),
    count(*) filter (where p.cycle_state = 'ACTIVE')::integer,
    count(*) filter (where p.cycle_state = 'DORMANT')::integer
  into
    v_movement_events_90d,
    v_outbound_qty_90d,
    v_last_movement_at,
    v_active_sku_count,
    v_dormant_sku_count
  from public.inventory_cycle_item_profiles p
  where p.location_id = p_location_id;

  select max(icl.completed_at)
    into v_last_counted_at
  from public.inventory_count_locations icl
  where icl.location_id = p_location_id
    and icl.status = 'COMPLETED';

  if v_last_counted_at is null then
    v_cycle_class := 'BASELINE';
    v_auto_cycle_enabled := true;
    v_cycle_days := null;
    v_next_due_at := null;
  elsif v_active_sku_count = 0 then
    v_cycle_class := 'DORMANT';
    v_auto_cycle_enabled := false;
    v_cycle_days := null;
    v_next_due_at := null;
  elsif v_movement_events_90d >= v_cfg.high_event_threshold
     or v_outbound_qty_90d >= v_cfg.high_outbound_qty_threshold then
    v_cycle_class := 'HIGH';
    v_auto_cycle_enabled := true;
    v_cycle_days := v_cfg.high_cycle_days;
    v_next_due_at := v_last_counted_at + make_interval(days => v_cycle_days);
  elsif v_movement_events_90d >= v_cfg.medium_event_threshold
     or v_outbound_qty_90d >= v_cfg.medium_outbound_qty_threshold then
    v_cycle_class := 'MEDIUM';
    v_auto_cycle_enabled := true;
    v_cycle_days := v_cfg.medium_cycle_days;
    v_next_due_at := v_last_counted_at + make_interval(days => v_cycle_days);
  else
    v_cycle_class := 'LOW';
    v_auto_cycle_enabled := true;
    v_cycle_days := v_cfg.low_cycle_days;
    v_next_due_at := v_last_counted_at + make_interval(days => v_cycle_days);
  end if;

  insert into public.inventory_cycle_location_profiles (
    location_id,
    cycle_class,
    auto_cycle_enabled,
    cycle_days,
    movement_events_90d,
    outbound_qty_90d,
    last_movement_at,
    active_sku_count,
    dormant_sku_count,
    last_counted_at,
    next_due_at,
    evaluated_at
  ) values (
    p_location_id,
    v_cycle_class,
    v_auto_cycle_enabled,
    v_cycle_days,
    v_movement_events_90d,
    v_outbound_qty_90d,
    v_last_movement_at,
    v_active_sku_count,
    v_dormant_sku_count,
    v_last_counted_at,
    v_next_due_at,
    now()
  )
  on conflict (location_id) do update
  set cycle_class = excluded.cycle_class,
      auto_cycle_enabled = excluded.auto_cycle_enabled,
      cycle_days = excluded.cycle_days,
      movement_events_90d = excluded.movement_events_90d,
      outbound_qty_90d = excluded.outbound_qty_90d,
      last_movement_at = excluded.last_movement_at,
      active_sku_count = excluded.active_sku_count,
      dormant_sku_count = excluded.dormant_sku_count,
      last_counted_at = excluded.last_counted_at,
      next_due_at = excluded.next_due_at,
      evaluated_at = excluded.evaluated_at;

  -- 기존 DUE 생성 로직이 그대로 동작하도록 최신 완료 LOC의 next_due_at을 동기화한다.
  update public.inventory_count_locations icl
  set next_due_at = v_next_due_at
  where icl.location_id = p_location_id
    and icl.status = 'COMPLETED'
    and icl.completed_at = v_last_counted_at;
end;
$$;

create or replace function public.refresh_dirty_inventory_cycle_profiles()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select d.location_id
    from public.inventory_cycle_dirty_locations d
    order by d.changed_at
  loop
    perform public.refresh_inventory_cycle_profile(v_row.location_id);
    delete from public.inventory_cycle_dirty_locations
    where location_id = v_row.location_id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.mark_inventory_cycle_location_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.location_id is not null then
    insert into public.inventory_cycle_dirty_locations (location_id, changed_at)
    values (new.location_id, now())
    on conflict (location_id) do update set changed_at = excluded.changed_at;
  end if;

  if tg_op = 'UPDATE' and old.location_id is distinct from new.location_id and old.location_id is not null then
    insert into public.inventory_cycle_dirty_locations (location_id, changed_at)
    values (old.location_id, now())
    on conflict (location_id) do update set changed_at = excluded.changed_at;
  end if;

  return new;
end;
$$;

-- 입고·출고·이관 트랜잭션에서는 무거운 집계를 하지 않고 dirty 표시만 남긴다.
do $$
begin
  if to_regclass('public.inventory_transactions') is not null then
    execute 'drop trigger if exists trg_mark_inventory_cycle_dirty on public.inventory_transactions';
    execute 'create trigger trg_mark_inventory_cycle_dirty after insert or update on public.inventory_transactions for each row execute function public.mark_inventory_cycle_location_dirty()';
  end if;
end;
$$;

create or replace function public.refresh_inventory_cycle_after_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'COMPLETED' and old.status is distinct from new.status then
    perform public.refresh_inventory_cycle_profile(new.location_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_refresh_inventory_cycle_after_count
  on public.inventory_count_locations;

create trigger trg_refresh_inventory_cycle_after_count
after update of status on public.inventory_count_locations
for each row
when (new.status = 'COMPLETED' and old.status is distinct from new.status)
execute function public.refresh_inventory_cycle_after_count();

create or replace function public.get_inventory_cycle_profiles()
returns table (
  location_id uuid,
  cycle_class text,
  auto_cycle_enabled boolean,
  cycle_days integer,
  movement_events_90d integer,
  outbound_qty_90d numeric,
  last_movement_at timestamptz,
  active_sku_count integer,
  dormant_sku_count integer,
  last_counted_at timestamptz,
  next_due_at timestamptz,
  evaluated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_role(array['admin','manager','operator']);
  perform public.refresh_dirty_inventory_cycle_profiles();

  return query
  select
    p.location_id,
    p.cycle_class,
    p.auto_cycle_enabled,
    p.cycle_days,
    p.movement_events_90d,
    p.outbound_qty_90d,
    p.last_movement_at,
    p.active_sku_count,
    p.dormant_sku_count,
    p.last_counted_at,
    p.next_due_at,
    p.evaluated_at
  from public.inventory_cycle_location_profiles p
  order by p.location_id;
end;
$$;

-- 최초 적용 시 현재 모든 사용 가능 LOC의 프로필을 생성한다.
do $$
declare
  v_location record;
begin
  for v_location in
    select l.id
    from public.locations l
    where coalesce(l.active, true) = true
      and coalesce(l.unavailable, false) = false
  loop
    perform public.refresh_inventory_cycle_profile(v_location.id);
  end loop;
end;
$$;

grant execute on function public.get_inventory_cycle_profiles() to authenticated;
grant execute on function public.refresh_dirty_inventory_cycle_profiles() to authenticated;

notify pgrst, 'reload schema';
commit;

select 'SAN WMS V3.9.0 adaptive stocktake cycle migration completed' as result;
