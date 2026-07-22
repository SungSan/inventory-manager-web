-- Barcode WMS v1.4 - zone utilization settings and live occupancy
-- DATA-PRESERVING MIGRATION: does not delete existing products, locations, balances, transactions, transfers, or logs.
-- Run this entire file once in Supabase SQL Editor after 02_TRANSFER_JOBS.sql.

create table if not exists public.utilization_zones (
  zone_code text primary key,
  display_name text not null,
  capacity_plt integer not null check (capacity_plt > 0),
  warning_percent numeric(5,2) not null default 70 check (warning_percent >= 0 and warning_percent <= 100),
  danger_percent numeric(5,2) not null default 80 check (danger_percent >= 0 and danger_percent <= 100),
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (danger_percent > warning_percent)
);

insert into public.utilization_zones (
  zone_code,
  display_name,
  capacity_plt,
  warning_percent,
  danger_percent,
  active,
  sort_order,
  updated_by
)
select
  zone_code,
  zone_code,
  count(*)::integer,
  70,
  80,
  true,
  row_number() over (order by zone_code)::integer,
  auth.uid()
from (
  select upper(trim(coalesce(nullif(l.zone, ''), split_part(l.location_code, '-', 1), '기타'))) as zone_code
  from public.locations l
  where l.active
) zones
where zone_code <> ''
group by zone_code
on conflict (zone_code) do nothing;

alter table public.utilization_zones enable row level security;

drop policy if exists utilization_zones_read_authenticated on public.utilization_zones;
create policy utilization_zones_read_authenticated
on public.utilization_zones
for select
to authenticated
using (true);

create or replace function public.list_zone_utilization()
returns table (
  zone_code text,
  display_name text,
  capacity_plt integer,
  occupied_plt bigint,
  utilization_percent numeric,
  status text,
  warning_percent numeric,
  danger_percent numeric,
  active boolean,
  sort_order integer,
  total_locations bigint,
  empty_locations bigint,
  sku_count bigint,
  total_qty bigint,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path=public
as $$
  with location_totals as (
    select
      l.id as location_id,
      upper(trim(coalesce(nullif(l.zone, ''), split_part(l.location_code, '-', 1), '기타'))) as zone_code,
      coalesce(sum(ib.qty), 0)::bigint as location_qty,
      count(distinct case when ib.qty > 0 then ib.product_id end)::bigint as location_sku_count
    from public.locations l
    left join public.inventory_balances ib on ib.location_id=l.id
    where l.active
    group by l.id, l.zone, l.location_code
  ),
  zone_aggregates as (
    select
      lt.zone_code,
      count(*)::bigint as total_locations,
      count(*) filter (where lt.location_qty > 0)::bigint as occupied_plt,
      count(*) filter (where lt.location_qty <= 0)::bigint as empty_locations,
      coalesce(sum(lt.location_sku_count), 0)::bigint as sku_count,
      coalesce(sum(lt.location_qty), 0)::bigint as total_qty
    from location_totals lt
    group by lt.zone_code
  ),
  all_zones as (
    select upper(trim(uz.zone_code)) as zone_code from public.utilization_zones uz
    union
    select za.zone_code from zone_aggregates za
  ),
  normalized as (
    select
      az.zone_code,
      coalesce(nullif(trim(uz.display_name), ''), az.zone_code) as display_name,
      coalesce(uz.capacity_plt, nullif(za.total_locations, 0)::integer, 1) as capacity_plt,
      coalesce(za.occupied_plt, 0)::bigint as occupied_plt,
      coalesce(uz.warning_percent, 70)::numeric as warning_percent,
      coalesce(uz.danger_percent, 80)::numeric as danger_percent,
      coalesce(uz.active, true) as active,
      coalesce(uz.sort_order, 9999) as sort_order,
      coalesce(za.total_locations, 0)::bigint as total_locations,
      coalesce(za.empty_locations, 0)::bigint as empty_locations,
      coalesce(za.sku_count, 0)::bigint as sku_count,
      coalesce(za.total_qty, 0)::bigint as total_qty,
      uz.updated_at
    from all_zones az
    left join public.utilization_zones uz on upper(trim(uz.zone_code))=az.zone_code
    left join zone_aggregates za on za.zone_code=az.zone_code
  ),
  calculated as (
    select
      n.*,
      round((n.occupied_plt::numeric * 100) / greatest(n.capacity_plt, 1), 1) as utilization_percent
    from normalized n
  )
  select
    c.zone_code,
    c.display_name,
    c.capacity_plt,
    c.occupied_plt,
    c.utilization_percent,
    case
      when not c.active then 'INACTIVE'
      when c.capacity_plt <= 0 then 'UNCONFIGURED'
      when c.utilization_percent >= c.danger_percent then 'DANGER'
      when c.utilization_percent >= c.warning_percent then 'WARNING'
      else 'SAFE'
    end as status,
    c.warning_percent,
    c.danger_percent,
    c.active,
    c.sort_order,
    c.total_locations,
    c.empty_locations,
    c.sku_count,
    c.total_qty,
    c.updated_at
  from calculated c
  order by c.sort_order, c.zone_code;
$$;

create or replace function public.upsert_zone_utilization_setting(
  p_zone_code text,
  p_display_name text,
  p_capacity_plt integer,
  p_warning_percent numeric,
  p_danger_percent numeric,
  p_active boolean default true,
  p_sort_order integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_zone_code text;
  v_before public.utilization_zones%rowtype;
  v_after public.utilization_zones%rowtype;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if public.current_role() <> 'admin' then raise exception '관리자만 용적률 설정을 변경할 수 있습니다.'; end if;

  v_zone_code := upper(trim(coalesce(p_zone_code, '')));
  if v_zone_code = '' then raise exception '구역 코드를 입력하세요.'; end if;
  if p_capacity_plt is null or p_capacity_plt <= 0 then raise exception '최대 PLT는 1 이상이어야 합니다.'; end if;
  if p_warning_percent is null or p_warning_percent < 0 or p_warning_percent > 100 then raise exception '경고 기준은 0~100 사이여야 합니다.'; end if;
  if p_danger_percent is null or p_danger_percent < 0 or p_danger_percent > 100 then raise exception '위험 기준은 0~100 사이여야 합니다.'; end if;
  if p_danger_percent <= p_warning_percent then raise exception '위험 기준은 경고 기준보다 커야 합니다.'; end if;

  select * into v_before from public.utilization_zones where zone_code=v_zone_code;

  insert into public.utilization_zones (
    zone_code,
    display_name,
    capacity_plt,
    warning_percent,
    danger_percent,
    active,
    sort_order,
    updated_at,
    updated_by
  ) values (
    v_zone_code,
    coalesce(nullif(trim(p_display_name), ''), v_zone_code),
    p_capacity_plt,
    p_warning_percent,
    p_danger_percent,
    coalesce(p_active, true),
    coalesce(p_sort_order, 0),
    now(),
    auth.uid()
  )
  on conflict (zone_code) do update set
    display_name=excluded.display_name,
    capacity_plt=excluded.capacity_plt,
    warning_percent=excluded.warning_percent,
    danger_percent=excluded.danger_percent,
    active=excluded.active,
    sort_order=excluded.sort_order,
    updated_at=now(),
    updated_by=auth.uid()
  returning * into v_after;

  perform public.write_audit(
    'UTILIZATION_SETTING_UPDATED',
    'utilization_zone',
    v_after.zone_code,
    v_after.display_name,
    case when v_before.zone_code is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after),
    null
  );

  return jsonb_build_object(
    'zone_code',v_after.zone_code,
    'display_name',v_after.display_name,
    'capacity_plt',v_after.capacity_plt,
    'warning_percent',v_after.warning_percent,
    'danger_percent',v_after.danger_percent,
    'active',v_after.active,
    'sort_order',v_after.sort_order,
    'updated_at',v_after.updated_at
  );
end;
$$;

revoke all on function public.list_zone_utilization() from public;
revoke all on function public.upsert_zone_utilization_setting(text,text,integer,numeric,numeric,boolean,integer) from public;
grant execute on function public.list_zone_utilization() to authenticated;
grant execute on function public.upsert_zone_utilization_setting(text,text,integer,numeric,numeric,boolean,integer) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.utilization_zones;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

notify pgrst, 'reload schema';
select 'Barcode WMS zone utilization migration completed' as result;
