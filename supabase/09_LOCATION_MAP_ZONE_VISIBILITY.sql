-- SAN WMS v1.5.4 - LOC MAP 대분류 표시 설정
-- DATA-PRESERVING MIGRATION: 기존 상품, 재고, 로케이션, 로그를 삭제하지 않습니다.
-- 08_LOCATION_OPERATIONAL_STATES.sql 이후 한 번 실행하세요.

create table if not exists public.location_map_zone_settings (
  zone_code text primary key,
  visible boolean not null default true,
  sort_order integer not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.location_map_zone_settings enable row level security;

drop policy if exists location_map_zone_settings_read on public.location_map_zone_settings;
create policy location_map_zone_settings_read
on public.location_map_zone_settings
for select
to authenticated
using (true);

create or replace function public.list_location_map_zone_settings()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;

  with zone_source as (
    select
      upper(coalesce(nullif(trim(l.zone),''),split_part(l.location_code,'-',1))) as zone_code,
      count(*) filter (where l.active)::integer as active_location_count,
      count(*) filter (where not l.active)::integer as excluded_location_count
    from public.locations l
    group by upper(coalesce(nullif(trim(l.zone),''),split_part(l.location_code,'-',1)))
  ), ranked as (
    select
      z.zone_code,
      z.active_location_count,
      z.excluded_location_count,
      row_number() over(order by z.zone_code)::integer as default_sort_order
    from zone_source z
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'zone_code',r.zone_code,
      'visible',coalesce(s.visible,true),
      'sort_order',coalesce(s.sort_order,r.default_sort_order),
      'active_location_count',r.active_location_count,
      'excluded_location_count',r.excluded_location_count
    ) order by coalesce(s.sort_order,r.default_sort_order),r.zone_code
  ),'[]'::jsonb)
  into v_result
  from ranked r
  left join public.location_map_zone_settings s on s.zone_code=r.zone_code;

  return v_result;
end;
$$;

create or replace function public.admin_save_location_map_zone_settings(
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_item jsonb;
  v_zone text;
  v_visible boolean;
  v_sort_order integer;
  v_count integer:=0;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if public.current_role()<>'admin' then raise exception '관리자만 로케이션맵 대분류 표시를 설정할 수 있습니다.'; end if;
  if p_settings is null or jsonb_typeof(p_settings)<>'array' then raise exception '대분류 설정 형식이 올바르지 않습니다.'; end if;

  for v_item in select * from jsonb_array_elements(p_settings)
  loop
    v_zone:=upper(trim(coalesce(v_item->>'zoneCode',v_item->>'zone_code','')));
    if v_zone='' then continue; end if;

    v_visible:=coalesce((v_item->>'visible')::boolean,true);
    v_sort_order:=coalesce(nullif(v_item->>'sortOrder','')::integer,nullif(v_item->>'sort_order','')::integer,0);

    insert into public.location_map_zone_settings(zone_code,visible,sort_order,updated_by,updated_at)
    values(v_zone,v_visible,v_sort_order,auth.uid(),now())
    on conflict(zone_code) do update set
      visible=excluded.visible,
      sort_order=excluded.sort_order,
      updated_by=auth.uid(),
      updated_at=now();

    v_count:=v_count+1;
  end loop;

  perform public.write_audit(
    'LOCATION_MAP_ZONE_VISIBILITY_UPDATED','location_map',null,'로케이션맵 대분류 표시 설정',
    null,jsonb_build_object('saved_zone_count',v_count,'settings',p_settings),null
  );

  return public.list_location_map_zone_settings();
end;
$$;

revoke all on function public.list_location_map_zone_settings() from public;
revoke all on function public.admin_save_location_map_zone_settings(jsonb) from public;
grant execute on function public.list_location_map_zone_settings() to authenticated;
grant execute on function public.admin_save_location_map_zone_settings(jsonb) to authenticated;

notify pgrst, 'reload schema';
select 'SAN WMS location map zone visibility migration completed' as result;
