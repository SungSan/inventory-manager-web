-- SAN WMS v1.5 - dynamic location map administration
-- DATA-PRESERVING MIGRATION: does not delete existing locations, inventory, transfers, or logs.
-- Run this entire file once in Supabase SQL Editor after 03_ZONE_UTILIZATION.sql.

create or replace function public.admin_upsert_map_location(
  p_location_code text,
  p_barcode_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_code text;
  v_zone text;
  v_barcode text;
  v_target uuid;
  v_location public.locations%rowtype;
  v_conflict uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if public.current_role() <> 'admin' then raise exception '관리자만 LOC MAP 로케이션을 추가할 수 있습니다.'; end if;

  v_code := upper(regexp_replace(trim(coalesce(p_location_code,'')), '\s+', '', 'g'));
  if v_code = '' or position('-' in v_code) = 0 then
    raise exception '로케이션 코드를 확인하세요. 예: D1B-01-01-04';
  end if;
  v_zone := split_part(v_code,'-',1);
  v_barcode := coalesce(nullif(trim(p_barcode_value),''),v_code);

  select * into v_location
  from public.locations
  where upper(location_code)=v_code
  for update;

  if found then
    if v_location.active then raise exception '이미 사용 중인 로케이션입니다.'; end if;

    update public.locations
    set active=true, zone=v_zone, updated_at=now()
    where id=v_location.id
    returning * into v_location;

    update public.scan_targets set active=true where id=v_location.scan_target_id;
    update public.barcodes set active=true
    where scan_target_id=v_location.scan_target_id and is_primary;

    if nullif(trim(p_barcode_value),'') is not null then
      select b.scan_target_id into v_conflict
      from public.barcodes b
      where b.normalized_value=public.normalize_barcode(v_barcode)
        and b.scan_target_id<>v_location.scan_target_id
      limit 1;
      if v_conflict is not null then raise exception '이미 다른 대상에서 사용하는 바코드입니다.'; end if;

      if not exists(
        select 1 from public.barcodes b
        where b.scan_target_id=v_location.scan_target_id
          and b.normalized_value=public.normalize_barcode(v_barcode)
      ) then
        insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary,active,created_by)
        values(v_location.scan_target_id,v_barcode,'internal','CODE-128',false,true,auth.uid());
      end if;
    end if;

    perform public.write_audit(
      'MAP_LOCATION_RESTORED','location',v_location.id::text,v_location.location_code,
      jsonb_build_object('active',false),jsonb_build_object('active',true,'zone',v_zone),null
    );
  else
    select b.scan_target_id into v_conflict
    from public.barcodes b
    where b.normalized_value=public.normalize_barcode(v_barcode)
    limit 1;
    if v_conflict is not null then raise exception '이미 등록된 바코드입니다.'; end if;

    insert into public.scan_targets(target_type,active)
    values('location',true)
    returning id into v_target;

    insert into public.locations(scan_target_id,location_code,zone,active)
    values(v_target,v_code,v_zone,true)
    returning * into v_location;

    insert into public.barcodes(scan_target_id,barcode_value,source,symbology,is_primary,active,created_by)
    values(v_target,v_barcode,'internal','CODE-128',true,true,auth.uid());

    perform public.write_audit(
      'MAP_LOCATION_CREATED','location',v_location.id::text,v_location.location_code,
      null,jsonb_build_object('location_code',v_code,'zone',v_zone,'barcode',v_barcode),null
    );
  end if;

  return jsonb_build_object(
    'id',v_location.id,
    'scan_target_id',v_location.scan_target_id,
    'location_code',v_location.location_code,
    'zone',v_location.zone,
    'active',v_location.active,
    'created_at',v_location.created_at,
    'updated_at',v_location.updated_at
  );
end;
$$;

create or replace function public.admin_set_map_location_active(
  p_location_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_location public.locations%rowtype;
  v_stock bigint;
  v_jobs integer:=0;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if public.current_role() <> 'admin' then raise exception '관리자만 LOC MAP 로케이션을 제외하거나 복구할 수 있습니다.'; end if;

  select * into v_location from public.locations where id=p_location_id for update;
  if not found then raise exception '로케이션을 찾을 수 없습니다.'; end if;

  if not coalesce(p_active,false) then
    select coalesce(sum(qty),0) into v_stock
    from public.inventory_balances
    where location_id=p_location_id and qty>0;
    if v_stock>0 then raise exception '재고가 남아 있는 로케이션은 제외할 수 없습니다. 먼저 재고를 이관하세요.'; end if;

    if to_regclass('public.transfer_jobs') is not null then
      execute 'select count(*) from public.transfer_jobs where status in (''DRAFT'',''READY'') and (source_location_id=$1 or destination_location_id=$1)'
      into v_jobs using p_location_id;
    end if;
    if v_jobs>0 then raise exception '진행 중인 이관 업무에 사용 중인 로케이션은 제외할 수 없습니다.'; end if;
  end if;

  update public.locations
  set active=coalesce(p_active,false),updated_at=now()
  where id=p_location_id
  returning * into v_location;

  update public.scan_targets set active=v_location.active where id=v_location.scan_target_id;
  if v_location.active then
    update public.barcodes set active=true
    where scan_target_id=v_location.scan_target_id and is_primary;
  end if;

  perform public.write_audit(
    case when v_location.active then 'MAP_LOCATION_RESTORED' else 'MAP_LOCATION_REMOVED' end,
    'location',v_location.id::text,v_location.location_code,
    jsonb_build_object('active',not v_location.active),jsonb_build_object('active',v_location.active),null
  );

  return jsonb_build_object(
    'id',v_location.id,
    'scan_target_id',v_location.scan_target_id,
    'location_code',v_location.location_code,
    'zone',v_location.zone,
    'active',v_location.active,
    'created_at',v_location.created_at,
    'updated_at',v_location.updated_at
  );
end;
$$;

-- 기존 로케이션 관리 화면에서도 재고 또는 진행 중 이관이 있는 LOC를 비활성화하지 못하도록 보호한다.
create or replace function public.update_location(
  p_location_id uuid,
  p_new_location_code text default null,
  p_new_zone text default null,
  p_new_active boolean default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_before public.locations%rowtype;
  v_after public.locations%rowtype;
  v_stock bigint;
  v_jobs integer:=0;
begin
  perform public.require_role(array['admin','manager','operator']);
  select * into v_before from public.locations where id=p_location_id for update;
  if not found then raise exception '로케이션을 찾을 수 없습니다.'; end if;

  if p_new_active is false and v_before.active then
    select coalesce(sum(qty),0) into v_stock
    from public.inventory_balances
    where location_id=p_location_id and qty>0;
    if v_stock>0 then raise exception '재고가 남아 있는 로케이션은 비활성화할 수 없습니다. 먼저 재고를 이관하세요.'; end if;

    if to_regclass('public.transfer_jobs') is not null then
      execute 'select count(*) from public.transfer_jobs where status in (''DRAFT'',''READY'') and (source_location_id=$1 or destination_location_id=$1)'
      into v_jobs using p_location_id;
    end if;
    if v_jobs>0 then raise exception '진행 중인 이관 업무에 사용 중인 로케이션은 비활성화할 수 없습니다.'; end if;
  end if;

  update public.locations l set
    location_code=coalesce(upper(trim(p_new_location_code)),l.location_code),
    zone=coalesce(upper(trim(p_new_zone)),l.zone),
    active=coalesce(p_new_active,l.active),
    updated_at=now()
  where l.id=p_location_id returning l.* into v_after;

  update public.scan_targets set active=v_after.active where id=v_after.scan_target_id;
  perform public.write_audit('LOCATION_UPDATED','location',p_location_id::text,v_after.location_code,to_jsonb(v_before),to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$$;

revoke all on function public.admin_upsert_map_location(text,text) from public;
revoke all on function public.admin_set_map_location_active(uuid,boolean) from public;
grant execute on function public.admin_upsert_map_location(text,text) to authenticated;
grant execute on function public.admin_set_map_location_active(uuid,boolean) to authenticated;

notify pgrst, 'reload schema';
select 'SAN WMS location map migration completed' as result;
